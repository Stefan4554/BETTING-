/**
 * Risk engine: exposure aggregation and limit checks.
 * Bets are NOT assumed independent: exposures are aggregated per event, per manual
 * correlation group, and per sport/league/market/bookmaker, and the worst case of
 * correlated groups is the sum of their liabilities.
 */
import type { BetRecord } from "./metrics";
import { cents, fromCents } from "./decimal";

export interface RiskLimits {
  maxStakePerBet?: number | null;
  maxBetPctBankroll?: number | null;
  maxEventExposure?: number | null;
  maxTotalExposurePct?: number | null;
  maxDailyLoss?: number | null;
  maxWeeklyLoss?: number | null;
  maxDrawdownPct?: number | null;
  maxCorrelatedExposure?: number | null;
}

export interface OpenTradeExposure { id: string; eventName: string; sport: string; exposure: number }

export interface ExposureRow { key: string; exposure: number; bets: number; share: number }

function aggregate(items: { key: string; exposure: number }[], total: number): ExposureRow[] {
  const m = new Map<string, { c: number; n: number }>();
  for (const i of items) {
    const r = m.get(i.key) ?? { c: 0, n: 0 };
    r.c += cents(i.exposure); r.n++;
    m.set(i.key, r);
  }
  return [...m.entries()]
    .map(([key, r]) => ({ key, exposure: fromCents(r.c), bets: r.n, share: total > 0 ? fromCents(r.c) / total : 0 }))
    .sort((a, b) => b.exposure - a.exposure);
}

export interface RiskState {
  totalExposure: number;
  betExposure: number;
  tradeExposure: number;
  exposurePctOfBankroll: number | null;
  byEvent: ExposureRow[];
  bySport: ExposureRow[];
  byLeague: ExposureRow[];
  byMarket: ExposureRow[];
  byBookmaker: ExposureRow[];
  byCorrelationGroup: ExposureRow[];
  byBankroll: ExposureRow[];
  /** Largest single-event share of total exposure. */
  concentration: number | null;
  /** Herfindahl index over event exposures (1 = everything on one event). */
  hhi: number | null;
  dailyPnl: number;
  weeklyPnl: number;
}

const eventKey = (b: BetRecord) => b.eventId ?? b.eventName.trim().toLowerCase();

export function riskState(bets: BetRecord[], trades: OpenTradeExposure[], equity: number | null, now = new Date()): RiskState {
  const pending = bets.filter((b) => b.status === "pending");
  const betExp = fromCents(pending.reduce((s, b) => s + cents(b.liability), 0));
  const tradeExp = fromCents(trades.reduce((s, t) => s + cents(t.exposure), 0));
  const total = betExp + tradeExp;
  const items = (f: (b: BetRecord) => string | null) => [
    ...pending.map((b) => ({ key: f(b) ?? "—", exposure: b.liability })),
  ];
  const evNames = new Map<string, string>();
  for (const b of pending) if (!evNames.has(eventKey(b))) evNames.set(eventKey(b), b.eventName.trim());
  const byEvent = aggregate(
    [...pending.map((b) => ({ key: eventKey(b), exposure: b.liability })), ...trades.map((t) => ({ key: t.eventName.trim().toLowerCase(), exposure: t.exposure }))],
    total,
  ).map((r) => ({ ...r, key: evNames.get(r.key) ?? trades.find((t) => t.eventName.trim().toLowerCase() === r.key)?.eventName ?? r.key }));
  const hhi = total > 0 ? byEvent.reduce((s, r) => s + r.share ** 2, 0) : null;

  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const weekStart = dayStart - ((now.getUTCDay() + 6) % 7) * 86_400_000;
  const settledSince = (t: number) =>
    fromCents(bets.filter((b) => b.status !== "pending" && b.settledAt && Date.parse(b.settledAt) >= t).reduce((s, b) => s + cents(b.profit ?? 0), 0));

  return {
    totalExposure: total, betExposure: betExp, tradeExposure: tradeExp,
    exposurePctOfBankroll: equity && equity > 0 ? total / equity : null,
    byEvent,
    bySport: aggregate([...items((b) => b.sport), ...trades.map((t) => ({ key: t.sport, exposure: t.exposure }))], total),
    byLeague: aggregate(items((b) => b.league), total),
    byMarket: aggregate(items((b) => b.market), total),
    byBookmaker: aggregate(items((b) => b.bookmaker), total),
    byCorrelationGroup: aggregate(pending.filter((b) => b.correlationGroup).map((b) => ({ key: b.correlationGroup!, exposure: b.liability })), total),
    byBankroll: aggregate(items((b) => b.bankrollId), total),
    concentration: byEvent[0] && total > 0 ? byEvent[0].share : null,
    hhi,
    dailyPnl: settledSince(dayStart),
    weeklyPnl: settledSince(weekStart),
  };
}

export type BreachType = "stake_limit" | "exposure" | "daily_loss" | "weekly_loss" | "drawdown";
export interface Breach { type: BreachType; severity: "warning" | "critical"; key: string; message: string; value: number; limit: number }

/** Compare current state with limits. Warning at ≥ 80% of a limit, critical when exceeded. */
export function checkLimits(state: RiskState, limits: RiskLimits, ctx: { equity: number | null; drawdownPct: number | null }): Breach[] {
  const out: Breach[] = [];
  const push = (type: BreachType, key: string, value: number, limit: number, label: string) => {
    if (limit <= 0) return;
    const ratio = value / limit;
    if (ratio >= 0.8) out.push({ type, key, value, limit, severity: ratio > 1 ? "critical" : "warning", message: label });
  };
  if (limits.maxEventExposure) for (const e of state.byEvent) push("exposure", `event:${e.key}`, e.exposure, limits.maxEventExposure, `Exposure on ${e.key}`);
  if (limits.maxCorrelatedExposure) for (const g of state.byCorrelationGroup) push("exposure", `group:${g.key}`, g.exposure, limits.maxCorrelatedExposure, `Correlated exposure in group "${g.key}"`);
  if (limits.maxTotalExposurePct && ctx.equity && ctx.equity > 0) push("exposure", "total", state.totalExposure, limits.maxTotalExposurePct * ctx.equity, "Total open exposure");
  if (limits.maxDailyLoss) push("daily_loss", "daily", Math.max(0, -state.dailyPnl), limits.maxDailyLoss, "Today's loss");
  if (limits.maxWeeklyLoss) push("weekly_loss", "weekly", Math.max(0, -state.weeklyPnl), limits.maxWeeklyLoss, "This week's loss");
  if (limits.maxDrawdownPct && ctx.drawdownPct != null) push("drawdown", "drawdown", ctx.drawdownPct, limits.maxDrawdownPct, "Current drawdown");
  return out;
}

export interface PreTradeInput { stake: number; liability: number; eventKey: string; correlationGroup?: string | null }

/** Check a prospective bet before it is placed. Returns blocking issues as messages. */
export function preTradeCheck(bet: PreTradeInput, state: RiskState, limits: RiskLimits, equity: number | null): string[] {
  const issues: string[] = [];
  if (limits.maxStakePerBet && bet.liability > limits.maxStakePerBet) issues.push(`Stake/liability ${bet.liability} exceeds max per bet ${limits.maxStakePerBet}`);
  if (limits.maxBetPctBankroll && equity && bet.liability > equity * limits.maxBetPctBankroll)
    issues.push(`Exceeds ${(limits.maxBetPctBankroll * 100).toFixed(1)}% of bankroll (${(equity * limits.maxBetPctBankroll).toFixed(2)})`);
  const ev = state.byEvent.find((e) => e.key.trim().toLowerCase() === bet.eventKey.trim().toLowerCase());
  if (limits.maxEventExposure && (ev?.exposure ?? 0) + bet.liability > limits.maxEventExposure)
    issues.push(`Event exposure would be ${((ev?.exposure ?? 0) + bet.liability).toFixed(2)} (max ${limits.maxEventExposure})`);
  if (bet.correlationGroup && limits.maxCorrelatedExposure) {
    const g = state.byCorrelationGroup.find((x) => x.key === bet.correlationGroup);
    if ((g?.exposure ?? 0) + bet.liability > limits.maxCorrelatedExposure) issues.push(`Correlation group "${bet.correlationGroup}" exposure would exceed ${limits.maxCorrelatedExposure}`);
  }
  if (limits.maxTotalExposurePct && equity && state.totalExposure + bet.liability > equity * limits.maxTotalExposurePct)
    issues.push(`Total exposure would exceed ${(limits.maxTotalExposurePct * 100).toFixed(0)}% of bankroll`);
  return issues;
}
