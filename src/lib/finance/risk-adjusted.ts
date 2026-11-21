/**
 * Risk-adjusted performance with an explicit return series.
 *
 * Per bet   r_i = profit_i / stake_i (settled, non-void). Not time-based; never annualised.
 * Daily     r_t = P/L settled on local day t / equity at the start of day t,
 *           equity = capital (net deposits) + cumulative P/L before t. Every calendar day
 *           between the first and last settlement is an observation (no activity = 0 return),
 *           so sparse betting is not inflated into a dense series.
 *           252-day convention: weekend P/L is rolled into the following Monday.
 * Sharpe    = mean(r − rf) / sd(r − rf)        (sample sd, n − 1)
 * Sortino   = mean(r − MAR) / DD, DD = sqrt(mean(min(0, r − MAR)²))
 * Annualised = daily ratio × √P   (P = 365 or 252); rf, MAR converted with (1 + x)^(1/P) − 1.
 * Every ratio returns null with a reason when the sample is insufficient or degenerate.
 */
import type { BetRecord } from "./metrics";
import { localDateKey, zonedYMD } from "./dates";

export interface RiskAdjustedOptions {
  capital: number;
  timeZone?: string;
  riskFreeAnnual?: number;
  marAnnual?: number;
  periodsPerYear?: 365 | 252;
  minBets?: number;
  minDailyObservations?: number;
  minActiveDays?: number;
  minAnnualDays?: number;
}

export interface Ratio { value: number | null; reason: string | null }
export interface RiskAdjusted {
  perBet: { observations: number; mean: number | null; sd: number | null; sharpe: Ratio; sortino: Ratio };
  daily: { observations: number; activeDays: number; firstDay: string | null; lastDay: string | null; mean: number | null; sd: number | null; downsideDeviation: number | null; sharpe: Ratio; sortino: Ratio };
  annualized: { factor: number; sharpe: Ratio; sortino: Ratio };
  assumptions: { riskFreeAnnual: number; riskFreePerPeriod: number; marAnnual: number; marPerPeriod: number; periodsPerYear: number; returnDefinition: string; thresholds: { minBets: number; minDailyObservations: number; minActiveDays: number; minAnnualDays: number } };
  series: { day: string; pnl: number; equityStart: number; ret: number }[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
const downside = (xs: number[], mar: number) => (xs.length ? Math.sqrt(xs.reduce((a, x) => a + Math.min(0, x - mar) ** 2, 0) / xs.length) : null);
const ratio = (num: number | null, den: number | null, zeroReason: string): Ratio =>
  num == null || den == null ? { value: null, reason: "insufficient observations" } : den === 0 || den < 1e-12 ? { value: null, reason: zeroReason } : { value: num / den, reason: null };
const fail = (reason: string): Ratio => ({ value: null, reason });

export function riskAdjusted(bets: BetRecord[], o: RiskAdjustedOptions): RiskAdjusted {
  const tz = o.timeZone ?? "UTC", P = o.periodsPerYear ?? 365;
  const t = { minBets: o.minBets ?? 30, minDailyObservations: o.minDailyObservations ?? 30, minActiveDays: o.minActiveDays ?? 20, minAnnualDays: o.minAnnualDays ?? 90 };
  const rfA = o.riskFreeAnnual ?? 0, marA = o.marAnnual ?? 0;
  const rf = (1 + rfA) ** (1 / P) - 1, mar = (1 + marA) ** (1 / P) - 1;

  // ── per bet
  const settled = bets.filter((b) => b.status !== "pending" && b.status !== "void" && b.stake > 0);
  const rb = settled.map((b) => (b.profit ?? 0) / b.stake);
  const mb = mean(rb), sb = sd(rb);
  const enoughBets = rb.length >= t.minBets;
  const perBet = {
    observations: rb.length, mean: mb, sd: sb,
    sharpe: enoughBets ? ratio(mb, sb, "zero volatility") : fail(`needs ≥ ${t.minBets} settled bets (have ${rb.length})`),
    sortino: enoughBets ? ratio(mb, downside(rb, 0), "no losing bets (downside deviation 0)") : fail(`needs ≥ ${t.minBets} settled bets (have ${rb.length})`),
  };

  // ── daily series
  const pnlByDay = new Map<string, number>();
  for (const b of bets) {
    if (b.status === "pending" || !b.settledAt) continue;
    let at = new Date(b.settledAt);
    if (P === 252) { const { dow } = zonedYMD(at, tz); if (dow >= 5) at = new Date(at.getTime() + (7 - dow) * 86_400_000); }
    const k = localDateKey(at, tz);
    pnlByDay.set(k, (pnlByDay.get(k) ?? 0) + (b.profit ?? 0));
  }
  const days = [...pnlByDay.keys()].sort();
  const series: RiskAdjusted["series"] = [];
  let equityInvalid = false;
  if (days.length) {
    let equity = o.capital;
    const end = Date.parse(days.at(-1)! + "T00:00:00Z");
    for (let d = Date.parse(days[0]! + "T00:00:00Z"); d <= end; d += 86_400_000) {
      const key = new Date(d).toISOString().slice(0, 10);
      const dow = (new Date(d).getUTCDay() + 6) % 7;
      if (P === 252 && dow >= 5) continue;
      const pnl = pnlByDay.get(key) ?? 0;
      if (equity <= 0) { equityInvalid = true; break; }
      series.push({ day: key, pnl, equityStart: equity, ret: pnl / equity });
      equity += pnl;
    }
  }
  const r = series.map((x) => x.ret);
  const active = series.filter((x) => x.pnl !== 0).length;
  const ex = r.map((x) => x - rf);
  const md = mean(r), sdd = sd(ex), dd = downside(r, mar);
  let dailyReason: string | null = null;
  if (o.capital <= 0) dailyReason = "no capital base (deposit funds to define returns)";
  else if (equityInvalid) dailyReason = "equity fell to zero or below; returns undefined";
  else if (r.length < t.minDailyObservations) dailyReason = `needs ≥ ${t.minDailyObservations} daily observations (have ${r.length})`;
  else if (active < t.minActiveDays) dailyReason = `needs ≥ ${t.minActiveDays} days with settled bets (have ${active})`;
  const daily = {
    observations: r.length, activeDays: active, firstDay: series[0]?.day ?? null, lastDay: series.at(-1)?.day ?? null,
    mean: md, sd: sd(r), downsideDeviation: dd,
    sharpe: dailyReason ? fail(dailyReason) : ratio(mean(ex), sdd, "zero volatility"),
    sortino: dailyReason ? fail(dailyReason) : ratio(md == null ? null : md - mar, dd, "no days below MAR (downside deviation 0)"),
  };

  // ── annualised
  const factor = Math.sqrt(P);
  let annReason: string | null = dailyReason;
  if (!annReason && r.length < t.minAnnualDays) annReason = `needs ≥ ${t.minAnnualDays} days of history to annualise (have ${r.length})`;
  if (!annReason && active / r.length < 0.1) annReason = `activity too sparse to annualise (${active} active of ${r.length} days)`;
  const ann = (x: Ratio): Ratio => (annReason ? fail(annReason) : x.value == null ? x : { value: x.value * factor, reason: null });

  return {
    perBet, daily, annualized: { factor, sharpe: ann(daily.sharpe), sortino: ann(daily.sortino) },
    assumptions: {
      riskFreeAnnual: rfA, riskFreePerPeriod: rf, marAnnual: marA, marPerPeriod: mar, periodsPerYear: P, thresholds: t,
      returnDefinition: "daily P/L ÷ equity at start of day (net capital + prior cumulative P/L), every calendar day from first to last settlement",
    },
    series,
  };
}
