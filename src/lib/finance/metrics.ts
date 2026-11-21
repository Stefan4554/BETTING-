/**
 * Quantitative analytics engine. Pure functions over bet records whose money fields are
 * already expressed in ONE currency (the caller converts with FxTable first).
 *
 * Definitions (also shown in the UI glossary):
 *   ROI = Yield = net profit / total settled stake × 100
 *   Win rate    = winning bets / settled non-void bets × 100
 *                 (won, half_won and profitable cash-outs count as wins)
 *   Profit factor = gross winning profit / |gross losing profit|
 *   Average odds  = mean odds of settled, non-void selections
 *   EV (per bet)  = stake × [p·(odds−1) − (1−p)]  for bets with an estimated probability
 *   Sharpe / Sortino are PER BET (not annualised) on per-bet returns r = profit / stake
 *   Max drawdown is measured on cumulative betting P/L (capital flows excluded)
 *   Risk of ruin ≈ exp(−2·μ·B / σ²)  (diffusion approximation, iid flat-stake bets)
 * Every metric that cannot be computed returns null instead of a misleading number.
 */
import { clv as clvFn, type ClvConvention } from "./clv";
import { cents, fromCents } from "./decimal";
import { basisTime, BASIS_LABEL, inRange, localDateKey, periodKey, PRESET_LABEL, previousRange, resolveRange, type DateBasis, type DateRange, type Granularity, type RangePreset } from "./dates";
import type { BetStatus } from "./settlement";

export interface BetRecord {
  id: string;
  ref?: number;
  placedAt: string;
  settledAt: string | null;
  status: BetStatus;
  side: "back" | "lay";
  kind: "single" | "accumulator";
  odds: number;
  stake: number;            // in analysis currency
  liability: number;        // in analysis currency (reserved amount)
  profit: number | null;    // in analysis currency
  estProbability: number | null;
  openingOdds: number | null;
  closingOdds: number | null;
  isLive: boolean;
  sport: string;
  league: string | null;
  bookmaker: string | null;
  strategy: string | null;
  market: string;
  selection?: string;
  marketCategory: string | null;
  eventName: string;
  eventId: string | null;
  correlationGroup: string | null;
  bankrollId: string;
  tags: string[];
  eventStart?: string | null;
}

export const MIN_SAMPLE = 30;

const isSettled = (b: BetRecord) => b.status !== "pending";
// Wins/losses follow the money: partial wins/losses and cash-outs count by the sign of P/L;
// void and break-even results are neither.
const isWin = (b: BetRecord) => b.status === "won" || b.status === "half_won" || ((b.status === "cashed_out" || b.status === "partial_win") && (b.profit ?? 0) > 0);
const isLoss = (b: BetRecord) => b.status === "lost" || b.status === "half_lost" || ((b.status === "cashed_out" || b.status === "partial_loss") && (b.profit ?? 0) < 0);
const isNeutral = (b: BetRecord) => b.status === "void" || b.status === "break_even";
const settleTime = (b: BetRecord) => Date.parse(b.settledAt ?? b.placedAt);

export function bySettlement(bets: BetRecord[]): BetRecord[] {
  return bets.filter(isSettled).sort((a, b) => settleTime(a) - settleTime(b) || (a.ref ?? 0) - (b.ref ?? 0));
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}
function variance(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

export interface Drawdown {
  maxAmount: number;
  /** Relative to equity at the peak (capital base + peak P/L); null without a capital base. */
  maxPct: number | null;
  currentAmount: number;
  currentPct: number | null;
  peakAt: string | null;
  troughAt: string | null;
  recovered: boolean;
}

/** Drawdown of a cumulative P/L path. `capital` is the money at risk (net deposits). */
export function drawdown(path: { at: string; cum: number }[], capital = 0): Drawdown {
  let peak = 0, peakAt: string | null = null;
  let max = 0, maxPct: number | null = null, maxPeakAt: string | null = null, troughAt: string | null = null;
  for (const p of path) {
    if (p.cum > peak) { peak = p.cum; peakAt = p.at; }
    const dd = peak - p.cum;
    if (dd > max + 1e-9) {
      max = dd; maxPeakAt = peakAt; troughAt = p.at;
      maxPct = capital + peak > 0 ? dd / (capital + peak) : null;
    }
  }
  const last = path.at(-1)?.cum ?? 0;
  const cur = peak - last;
  return {
    maxAmount: fromCents(cents(max)),
    maxPct: max > 0 ? maxPct : capital > 0 ? 0 : null,
    currentAmount: fromCents(cents(cur)),
    currentPct: capital + peak > 0 ? cur / (capital + peak) : null,
    peakAt: maxPeakAt, troughAt,
    recovered: max > 0 && cur < 1e-9,
  };
}

export function streaks(ordered: BetRecord[]) {
  let w = 0, l = 0, maxW = 0, maxL = 0;
  for (const b of ordered) {
    if (isWin(b)) { w++; l = 0; } else if (isLoss(b)) { l++; w = 0; } else continue; // voids neither extend nor break
    maxW = Math.max(maxW, w); maxL = Math.max(maxL, l);
  }
  const current = w > 0 ? { type: "win" as const, length: w } : l > 0 ? { type: "loss" as const, length: l } : null;
  return { longestWin: maxW, longestLoss: maxL, current };
}

export interface Summary {
  totalBets: number;
  settledBets: number;
  pendingBets: number;
  voidBets: number;
  wins: number;
  losses: number;
  totalStake: number;          // settled turnover
  openExposure: number;        // reserved by pending bets
  pendingStake: number;
  netProfit: number;
  grossWin: number;
  grossLoss: number;
  roi: number | null;
  yield: number | null;
  winRate: number | null;
  profitFactor: number | null; // null = no losses (shown as "∞, no losses") or no wins
  averageOdds: number | null;
  averageStake: number | null;
  averageProfitPerBet: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  stdDevReturn: number | null;
  varianceReturn: number | null;
  stdDevProfit: number | null;
  sharpe: number | null;
  sortino: number | null;
  drawdown: Drawdown;
  recoveryFactor: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: { type: "win" | "loss"; length: number } | null;
  // expectation
  evSample: number;
  expectedProfit: number | null;
  expectedRoi: number | null;
  realizedRoiOnEvSample: number | null;
  averageEdge: number | null;
  // CLV
  clvConvention: ClvConvention;
  clvSample: number;
  averageClv: number | null;
  positiveClvRate: number | null;
  riskOfRuin: number | null;
  lowSample: boolean;
}

export function summarize(bets: BetRecord[], opts: { convention?: ClvConvention; capital?: number; bankroll?: number } = {}): Summary {
  const convention = opts.convention ?? "odds";
  const settled = bySettlement(bets);
  const pending = bets.filter((b) => b.status === "pending");
  const nonVoid = settled.filter((b) => b.status !== "void");
  const decided = settled.filter((b) => !isNeutral(b));
  const wins = settled.filter(isWin);
  const losses = settled.filter(isLoss);

  const stakeC = settled.reduce((s, b) => s + cents(b.stake), 0);
  const profitC = settled.reduce((s, b) => s + cents(b.profit ?? 0), 0);
  const grossWinC = settled.reduce((s, b) => s + Math.max(0, cents(b.profit ?? 0)), 0);
  const grossLossC = settled.reduce((s, b) => s + Math.min(0, cents(b.profit ?? 0)), 0);
  const totalStake = fromCents(stakeC);
  const netProfit = fromCents(profitC);

  const returns = nonVoid.filter((b) => b.stake > 0).map((b) => (b.profit ?? 0) / b.stake);
  const profits = nonVoid.map((b) => b.profit ?? 0);
  const mR = mean(returns);
  const vR = variance(returns);
  const sdR = vR == null ? null : Math.sqrt(vR);
  const downside = returns.length >= 2 ? Math.sqrt(returns.reduce((s, r) => s + Math.min(0, r) ** 2, 0) / returns.length) : null;
  const vP = variance(profits);
  const sdP = vP == null ? null : Math.sqrt(vP);

  let cum = 0;
  const path = settled.map((b) => ({ at: b.settledAt ?? b.placedAt, cum: (cum += b.profit ?? 0) }));
  const dd = drawdown(path, opts.capital ?? 0);
  const st = streaks(settled);

  const evBets = settled.filter((b) => b.estProbability != null && b.status !== "void" && b.side === "back");
  const evProfit = evBets.reduce((s, b) => s + b.stake * (b.estProbability! * (b.odds - 1) - (1 - b.estProbability!)), 0);
  const evStake = evBets.reduce((s, b) => s + b.stake, 0);
  const evRealized = evBets.reduce((s, b) => s + (b.profit ?? 0), 0);
  const edges = bets.filter((b) => b.estProbability != null).map((b) => b.estProbability! - 1 / b.odds);

  const clvBets = bets
    .filter((b) => b.closingOdds != null && b.kind === "single" && b.status !== "void")
    .map((b) => clvFn(b.odds, b.closingOdds, convention, b.side))
    .filter((v): v is number => v != null);

  const muP = mean(profits);
  const B = opts.bankroll ?? null;
  const ror = settled.length >= MIN_SAMPLE && muP != null && vP != null && vP > 0 && B != null && B > 0
    ? (muP <= 0 ? 1 : Math.exp((-2 * muP * B) / vP))
    : null;

  return {
    totalBets: bets.length,
    settledBets: settled.length,
    pendingBets: pending.length,
    voidBets: settled.length - nonVoid.length,
    wins: wins.length,
    losses: losses.length,
    totalStake,
    openExposure: fromCents(pending.reduce((s, b) => s + cents(b.liability), 0)),
    pendingStake: fromCents(pending.reduce((s, b) => s + cents(b.stake), 0)),
    netProfit,
    grossWin: fromCents(grossWinC),
    grossLoss: fromCents(grossLossC),
    roi: stakeC > 0 ? profitC / stakeC : null,
    yield: stakeC > 0 ? profitC / stakeC : null,
    winRate: decided.length ? wins.length / decided.length : null,
    profitFactor: grossLossC < 0 && grossWinC > 0 ? grossWinC / -grossLossC : grossLossC < 0 ? 0 : null,
    averageOdds: mean(nonVoid.map((b) => b.odds)),
    averageStake: settled.length ? totalStake / settled.length : null,
    averageProfitPerBet: settled.length ? netProfit / settled.length : null,
    averageWin: wins.length ? wins.reduce((s, b) => s + (b.profit ?? 0), 0) / wins.length : null,
    averageLoss: losses.length ? losses.reduce((s, b) => s + (b.profit ?? 0), 0) / losses.length : null,
    stdDevReturn: sdR,
    varianceReturn: vR,
    stdDevProfit: sdP,
    sharpe: mR != null && sdR != null && sdR > 0 ? mR / sdR : null,
    sortino: mR != null && downside != null && downside > 0 ? mR / downside : null,
    drawdown: dd,
    recoveryFactor: dd.maxAmount > 0 ? netProfit / dd.maxAmount : null,
    longestWinStreak: st.longestWin,
    longestLossStreak: st.longestLoss,
    currentStreak: st.current,
    evSample: evBets.length,
    expectedProfit: evBets.length ? evProfit : null,
    expectedRoi: evStake > 0 ? evProfit / evStake : null,
    realizedRoiOnEvSample: evStake > 0 ? evRealized / evStake : null,
    averageEdge: mean(edges),
    clvConvention: convention,
    clvSample: clvBets.length,
    averageClv: mean(clvBets),
    positiveClvRate: clvBets.length ? clvBets.filter((v) => v > 0).length / clvBets.length : null,
    riskOfRuin: ror,
    lowSample: settled.length < MIN_SAMPLE,
  };
}

// ── Grouping & distributions ────────────────────────────────────────────────

export interface GroupRow {
  key: string;
  bets: number;
  settled: number;
  stake: number;
  profit: number;
  roi: number | null;
  winRate: number | null;
  averageOdds: number | null;
  averageClv: number | null;
  clvSample: number;
  maxDrawdown: number;
}

export function groupBy(bets: BetRecord[], key: (b: BetRecord) => string | null | undefined, convention: ClvConvention = "odds"): GroupRow[] {
  const groups = new Map<string, BetRecord[]>();
  for (const b of bets) {
    const k = key(b) ?? "—";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(b);
  }
  return [...groups.entries()]
    .map(([k, list]) => {
      const s = summarize(list, { convention });
      return {
        key: k, bets: s.totalBets, settled: s.settledBets, stake: s.totalStake, profit: s.netProfit, roi: s.roi,
        winRate: s.winRate, averageOdds: s.averageOdds, averageClv: s.averageClv, clvSample: s.clvSample, maxDrawdown: s.drawdown.maxAmount,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

export const ODDS_BUCKETS: [number, number, string][] = [
  [1, 1.5, "1.01–1.49"], [1.5, 2, "1.50–1.99"], [2, 2.5, "2.00–2.49"], [2.5, 3.5, "2.50–3.49"],
  [3.5, 5, "3.50–4.99"], [5, 10, "5.00–9.99"], [10, Infinity, "10.00+"],
];

export function oddsBucket(odds: number): string {
  return ODDS_BUCKETS.find(([lo, hi]) => odds >= lo && odds < hi)?.[2] ?? "—";
}

export function stakeBuckets(bets: BetRecord[]): number[] {
  const stakes = bets.map((b) => b.stake).sort((a, b) => a - b);
  if (!stakes.length) return [];
  const q = (p: number) => stakes[Math.min(stakes.length - 1, Math.floor(p * stakes.length))]!;
  return [...new Set([q(0.25), q(0.5), q(0.75)].map((x) => Math.round(x)))];
}

export function stakeBucket(stake: number, edges: number[]): string {
  const sorted = [...edges].sort((a, b) => a - b);
  let lo = 0;
  for (const e of sorted) {
    if (stake < e) return `${lo}–${e}`;
    lo = e;
  }
  return `${lo}+`;
}

// ── Time series ─────────────────────────────────────────────────────────────

export interface SeriesOptions { basis?: DateBasis; timeZone?: string }

/** Settled bets ordered by their basis date (settlement by default). */
export function orderedSettled(bets: BetRecord[], basis: DateBasis = "settled"): BetRecord[] {
  return bets.filter((b) => b.status !== "pending")
    .sort((a, b) => Date.parse(basisTime(a, basis)) - Date.parse(basisTime(b, basis)) || (a.ref ?? 0) - (b.ref ?? 0));
}

export interface PeriodRow { period: string; bets: number; stake: number; profit: number; roi: number | null; wins: number; winRate: number | null }

/** P/L per local day / ISO week / month, keyed by the selected date basis. */
export function pnlByPeriod(bets: BetRecord[], g: Granularity, opts: SeriesOptions = {}): PeriodRow[] {
  const basis = opts.basis ?? "settled", tz = opts.timeZone ?? "UTC";
  const m = new Map<string, { bets: number; stakeC: number; profitC: number; wins: number; decided: number }>();
  for (const b of orderedSettled(bets, basis)) {
    const k = periodKey(basisTime(b, basis), g, tz);
    const r = m.get(k) ?? { bets: 0, stakeC: 0, profitC: 0, wins: 0, decided: 0 };
    r.bets++; r.stakeC += cents(b.stake); r.profitC += cents(b.profit ?? 0);
    if (!isNeutral(b)) r.decided++;
    if (isWin(b)) r.wins++;
    m.set(k, r);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, r]) => ({
    period, bets: r.bets, stake: fromCents(r.stakeC), profit: fromCents(r.profitC),
    roi: r.stakeC ? r.profitC / r.stakeC : null, wins: r.wins, winRate: r.decided ? r.wins / r.decided : null,
  }));
}

export interface CurvePoint { at: string; ref?: number; profit: number; cumProfit: number; cumStake: number; roi: number | null; winRate: number | null; clv: number | null; equity: number | null }

/** Cumulative curve ordered by the basis date; equity = startingEquity + cumulative profit. */
export function cumulativeCurve(bets: BetRecord[], opts: { convention?: ClvConvention; startingEquity?: number | null } & SeriesOptions = {}): CurvePoint[] {
  const conv = opts.convention ?? "odds", basis = opts.basis ?? "settled";
  let p = 0, s = 0, w = 0, n = 0, clvSum = 0, clvN = 0;
  return orderedSettled(bets, basis).map((b) => {
    p += cents(b.profit ?? 0); s += cents(b.stake);
    if (!isNeutral(b)) { n++; if (isWin(b)) w++; }
    const c = b.kind === "single" ? clvFn(b.odds, b.closingOdds, conv, b.side) : null;
    if (c != null) { clvSum += c; clvN++; }
    return {
      at: basisTime(b, basis), ref: b.ref, profit: b.profit ?? 0, cumProfit: fromCents(p), cumStake: fromCents(s),
      roi: s ? p / s : null, winRate: n ? w / n : null, clv: clvN ? clvSum / clvN : null,
      equity: opts.startingEquity != null ? opts.startingEquity + fromCents(p) : null,
    };
  });
}

/** Down-sample a curve to one point per local day (last value of the day). */
export function dailyCurve(curve: CurvePoint[], timeZone = "UTC"): CurvePoint[] {
  const m = new Map<string, CurvePoint>();
  for (const c of curve) { const k = localDateKey(c.at, timeZone); m.set(k, { ...c, at: k }); }
  return [...m.values()];
}

// ── Date ranges (see dates.ts) ──────────────────────────────────────────────
export { resolveRange, previousRange, inRange, periodKey, BASIS_LABEL, PRESET_LABEL };
export type { DateRange, RangePreset, DateBasis, Granularity };

/** Relative change for period comparison; null when the base is zero or missing. */
export function change(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
