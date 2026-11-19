import { assertProbability, assertValidOdds } from "./odds";

export interface KellyParams {
  /** Fraction of full Kelly to stake, e.g. 0.25 = quarter Kelly. */
  fraction: number;
  /** Hard cap as share of bankroll, e.g. 0.02 = never more than 2%. */
  maxStakePct: number;
  /**
   * 0..1 confidence in the model. Shrinks the model probability towards the
   * market probability before sizing: p' = market + confidence × (model − market).
   */
  modelConfidence?: number;
  /** Market (no-vig) probability used as the shrink target. */
  marketProbability?: number;
}

/** Full Kelly fraction f* = (b·p − q) / b, where b = odds − 1. Negative → 0. */
export function fullKelly(probability: number, odds: number): number {
  assertProbability(probability);
  assertValidOdds(odds);
  const b = odds - 1;
  const f = (b * probability - (1 - probability)) / b;
  return Math.max(0, f);
}

export function shrinkProbability(model: number, market: number | undefined, confidence = 1): number {
  if (market === undefined || confidence >= 1) return model;
  const c = Math.min(Math.max(confidence, 0), 1);
  return market + c * (model - market);
}

export interface KellyResult {
  /** Probability actually used for sizing after confidence shrinkage. */
  adjustedProbability: number;
  fullKelly: number;
  /** Stake as share of bankroll after fraction and cap. */
  stakePct: number;
  capped: boolean;
}

export function fractionalKelly(probability: number, odds: number, params: KellyParams): KellyResult {
  if (params.fraction <= 0 || params.fraction > 1) throw new Error("Kelly fraction must be in (0, 1]");
  if (params.maxStakePct <= 0 || params.maxStakePct > 1) throw new Error("maxStakePct must be in (0, 1]");
  const adjusted = shrinkProbability(probability, params.marketProbability, params.modelConfidence ?? 1);
  const fk = fullKelly(adjusted, odds);
  const raw = fk * params.fraction;
  const stakePct = Math.min(raw, params.maxStakePct);
  return { adjustedProbability: adjusted, fullKelly: fk, stakePct, capped: raw > params.maxStakePct };
}

export function kellyStake(bankroll: number, result: KellyResult, roundTo = 0.01): number {
  if (bankroll <= 0) return 0;
  return Math.floor((bankroll * result.stakePct) / roundTo) * roundTo;
}
