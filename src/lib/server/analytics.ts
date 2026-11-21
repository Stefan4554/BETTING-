import "server-only";
import type { AppContext } from "./context";
import { bankrollTotals, loadBets, loadFx, loadTrades, loadTransactions, openTradeExposures, toRecords, type BetRow } from "./data";
import {
  cumulativeCurve, dailyCurve, groupBy, inRange, oddsBucket, pnlByPeriod, previousRange, stakeBucket, stakeBuckets, summarize,
  type BetRecord, type DateRange,
} from "@/lib/finance/metrics";
import { calibrate } from "@/lib/finance/calibration";
import { riskState } from "@/lib/finance/risk";
import { clv } from "@/lib/finance/clv";

export function reservedByBankroll(rows: BetRow[], trades: { status: string; bankroll_id: string; reserved_base: number | string }[] = []) {
  const m = new Map<string, number>();
  for (const t of trades) if (t.status === "open") m.set(t.bankroll_id, (m.get(t.bankroll_id) ?? 0) + Number(t.reserved_base));
  for (const b of rows) if (b.status === "pending") {
    m.set(b.bankroll_id, (m.get(b.bankroll_id) ?? 0) + Number(b.liability) * Number(b.fx_rate) - Number(b.cashout_amount) * Number(b.fx_rate));
  }
  return m;
}

export async function loadAnalyticsBase(ctx: AppContext) {
  const [rows, fx, trades, txs] = await Promise.all([loadBets(ctx), loadFx(ctx), loadTrades(ctx), loadTransactions(ctx)]);
  const conv = toRecords(rows, fx, ctx.displayCurrency);
  // Capital = net external flows (deposits − withdrawals ± adjustments) converted to display ccy.
  let capital = 0;
  for (const t of txs) {
    if (!["deposit", "withdrawal", "adjustment"].includes(t.type)) continue;
    const br = ctx.bankrolls.find((b) => b.id === t.bankroll_id);
    capital += Number(t.amount) * (fx.rate(br?.currency ?? ctx.displayCurrency, ctx.displayCurrency, t.occurred_at.slice(0, 10)) ?? 0);
  }
  const totals = bankrollTotals(ctx, fx, reservedByBankroll(rows, trades));
  const tradeExp = openTradeExposures(trades, fx, ctx);
  const tradePnl = trades.filter((t) => t.status !== "open").reduce((s, t) => s + Number(t.realized_pnl ?? 0) * Number(t.fx_rate), 0);
  return { rows, fx, trades, txs, conv, capital, totals, tradeExp, tradePnl };
}

export type AnalyticsBase = Awaited<ReturnType<typeof loadAnalyticsBase>>;

export function buildAnalytics(ctx: AppContext, base: AnalyticsBase, range: DateRange) {
  const convention = ctx.settings.clv_convention;
  const all = base.conv.records;
  const bets = all.filter((b) => inRange(b, range));
  const prevRange = previousRange(range);
  const prev = prevRange ? all.filter((b) => inRange(b, prevRange)) : null;
  const summary = summarize(bets, { convention, capital: base.capital, bankroll: base.totals.equity });
  const previous = prev ? summarize(prev, { convention, capital: base.capital, bankroll: base.totals.equity }) : null;
  // Equity curve: start from equity before the range's first settled bet.
  const settledBefore = range.from ? all.filter((b) => b.status !== "pending" && Date.parse(b.settledAt ?? b.placedAt) < range.from!.getTime()) : [];
  const priorProfit = settledBefore.reduce((s, b) => s + (b.profit ?? 0), 0);
  const curve = dailyCurve(cumulativeCurve(bets, { convention, startingEquity: base.capital + priorProfit }));
  const edges = stakeBuckets(bets);
  const risk = riskState(all, base.tradeExp, base.totals.equity);
  const clvPoints = bets
    .filter((b) => b.kind === "single" && b.closingOdds != null)
    .map((b) => ({ id: b.id, at: b.placedAt, clv: clv(b.odds, b.closingOdds, convention, b.side)!, sport: b.sport, bookmaker: b.bookmaker, market: b.market }))
    .filter((p) => p.clv != null);
  return {
    convention,
    currency: ctx.displayCurrency,
    unconverted: base.conv.unconverted,
    summary, previous,
    equity: base.totals.equity, balance: base.totals.balance, capital: base.capital,
    curve,
    daily: pnlByPeriod(bets, "day"),
    weekly: pnlByPeriod(bets, "week"),
    monthly: pnlByPeriod(bets, "month"),
    bySport: groupBy(bets, (b) => b.sport, convention),
    byBookmaker: groupBy(bets, (b) => b.bookmaker, convention),
    byStrategy: groupBy(bets, (b) => b.strategy ?? "No strategy", convention),
    byMarket: groupBy(bets, (b) => b.market, convention),
    byLeague: groupBy(bets, (b) => b.league ?? "—", convention),
    byLive: groupBy(bets, (b) => (b.isLive ? "Live" : "Pre-match"), convention),
    byKind: groupBy(bets, (b) => (b.kind === "accumulator" ? "Accumulator" : "Single"), convention),
    byOdds: groupBy(bets, (b) => oddsBucket(b.odds), convention).sort((a, b) => a.key.localeCompare(b.key)),
    byStake: groupBy(bets, (b) => stakeBucket(b.stake, edges), convention).sort((a, b) => parseFloat(a.key) - parseFloat(b.key)),
    calibration: calibrate(bets),
    calibrationBySport: groupCalibration(bets, (b) => b.sport),
    calibrationByMarket: groupCalibration(bets, (b) => b.market),
    risk,
    clvPoints,
    tradePnl: base.tradePnl,
  };
}

function groupCalibration(bets: BetRecord[], key: (b: BetRecord) => string) {
  const m = new Map<string, BetRecord[]>();
  for (const b of bets) (m.get(key(b)) ?? m.set(key(b), []).get(key(b))!).push(b);
  return [...m.entries()].map(([k, list]) => {
    const c = calibrate(list);
    return { key: k, sample: c.sample, brier: c.brier, marketBrier: c.marketBrier, brierSkill: c.brierSkill, logLoss: c.logLoss, meanPredicted: c.meanPredicted, actualRate: c.actualRate };
  }).filter((r) => r.sample > 0).sort((a, b) => b.sample - a.sample);
}

export type Analytics = ReturnType<typeof buildAnalytics>;
