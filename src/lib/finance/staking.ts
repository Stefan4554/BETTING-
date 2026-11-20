/**
 * Staking engine: Kelly criterion for decimal odds and the common staking systems.
 *   f* = (b·p − q) / b,  b = odds − 1, q = 1 − p.  Negative f* → no bet (never a negative stake).
 */
import { assertProbability, assertValidOdds, impliedProbability } from "./odds";
import { money } from "./decimal";

export function fullKellyFraction(p: number, odds: number): number {
  assertProbability(p);
  assertValidOdds(odds);
  const b = odds - 1;
  return Math.max(0, (b * p - (1 - p)) / b);
}

/** EV per unit stake at decimal odds, before commission: p·(odds − 1) − (1 − p). */
export function expectedValuePerUnit(p: number, odds: number): number {
  assertProbability(p);
  assertValidOdds(odds);
  return p * (odds - 1) - (1 - p);
}

/** Edge in probability points: estimated − implied. */
export function probabilityEdge(p: number, odds: number): number {
  return p - impliedProbability(odds);
}

export type StakingSystem =
  | { type: "flat"; amount: number }
  | { type: "percentage"; pct: number }          // of bankroll, e.g. 0.02
  | { type: "units"; units: number; unitSize: number }
  | { type: "kelly"; fraction: number }          // 1 = full Kelly
  | { type: "custom"; formula: "fixed_profit"; target: number }; // stake to win a fixed amount

export interface StakeLimits {
  maxStake?: number | null;
  /** Max share of bankroll per bet, e.g. 0.05. */
  maxStakePct?: number | null;
  /** Remaining exposure headroom (currency). */
  maxExposureRemaining?: number | null;
  minStake?: number;
  roundTo?: number;
}

export interface StakeRecommendation {
  rawStake: number;
  stake: number;
  cappedBy: ("max_stake" | "max_pct" | "exposure" | "negative_edge" | "min_stake")[];
  kellyFraction: number | null;
}

export function recommendStake(
  system: StakingSystem,
  ctx: { bankroll: number; odds: number; probability?: number | null },
  limits: StakeLimits = {},
): StakeRecommendation {
  const capped: StakeRecommendation["cappedBy"] = [];
  let raw: number;
  let kf: number | null = null;
  switch (system.type) {
    case "flat": raw = system.amount; break;
    case "percentage": raw = ctx.bankroll * system.pct; break;
    case "units": raw = system.units * system.unitSize; break;
    case "custom": raw = system.target / (ctx.odds - 1); break;
    case "kelly": {
      if (ctx.probability == null) throw new Error("Kelly staking needs an estimated probability");
      if (system.fraction <= 0 || system.fraction > 1) throw new Error("Kelly fraction must be in (0, 1]");
      kf = fullKellyFraction(ctx.probability, ctx.odds);
      if (kf === 0) capped.push("negative_edge");
      raw = ctx.bankroll * kf * system.fraction;
      break;
    }
  }
  raw = Math.max(0, raw);
  let stake = raw;
  if (limits.maxStake != null && stake > limits.maxStake) { stake = limits.maxStake; capped.push("max_stake"); }
  if (limits.maxStakePct != null && stake > ctx.bankroll * limits.maxStakePct) { stake = ctx.bankroll * limits.maxStakePct; capped.push("max_pct"); }
  if (limits.maxExposureRemaining != null && stake > Math.max(0, limits.maxExposureRemaining)) {
    stake = Math.max(0, limits.maxExposureRemaining); capped.push("exposure");
  }
  const roundTo = limits.roundTo ?? 0.01;
  stake = Math.floor(stake / roundTo + 1e-9) * roundTo;
  if (limits.minStake != null && stake > 0 && stake < limits.minStake) { stake = 0; capped.push("min_stake"); }
  return { rawStake: money(raw).toNumber(), stake: money(stake).toNumber(), cappedBy: capped, kellyFraction: kf };
}

export interface KellyTable {
  implied: number;
  edge: number;
  ev: number;
  fullKelly: number;
  rows: { label: string; fraction: number; stakePct: number; stake: number; expectedProfit: number }[];
}

/** The staking calculator's output table: full, ½, ¼ and 1/10 Kelly. */
export function kellyTable(bankroll: number, odds: number, p: number, limits: StakeLimits = {}): KellyTable {
  const fk = fullKellyFraction(p, odds);
  const ev = expectedValuePerUnit(p, odds);
  const rows = ([["Full Kelly", 1], ["Half Kelly", 0.5], ["Quarter Kelly", 0.25], ["1/10 Kelly", 0.1]] as const).map(([label, fraction]) => {
    const rec = recommendStake({ type: "kelly", fraction }, { bankroll, odds, probability: p }, limits);
    return { label, fraction, stakePct: bankroll > 0 ? rec.stake / bankroll : 0, stake: rec.stake, expectedProfit: money(rec.stake * ev).toNumber() };
  });
  return { implied: impliedProbability(odds), edge: probabilityEdge(p, odds), ev, fullKelly: fk, rows };
}
