import { expectedValue, fairOdds, impliedProbability } from "./odds";
import { fractionalKelly, type KellyParams } from "./kelly";

export type Confidence = "low" | "medium" | "high";

export interface ValueInput {
  matchId: string;
  matchLabel: string;
  market: string;
  selection: string;
  selectionLabel: string;
  bestOdds: number;
  bestBookmaker: string;
  oddsTimestamp: string;
  /** Model probability; null when the model has insufficient data. */
  modelProbability: number | null;
  /** Width of the model's 90% interval (ciHigh − ciLow), if known. */
  modelIntervalWidth?: number | null;
  /** No-vig market consensus probability. */
  marketProbability: number | null;
  /** 0..1 summary of data completeness and freshness. */
  dataQuality: number;
  booksInConsensus: number;
}

export interface ValueOpportunity extends ValueInput {
  modelProbability: number;
  /** True when model and market disagree by more than maxDivergence. */
  suspect: boolean;
  bookmakerImpliedProbability: number;
  fairOdds: number;
  expectedValue: number;
  /** Edge in probability points vs the bookmaker's implied probability. */
  edgePct: number;
  /** EV computed with the pessimistic end of the model interval. */
  evLowerBound: number | null;
  kellyStakePct: number;
  kellyCapped: boolean;
  confidence: Confidence;
  warnings: string[];
}

export interface ValueSettings extends Omit<KellyParams, "marketProbability"> {
  minEdge: number;
  minDataQuality: number;
  /**
   * Model/market divergence (probability points) above which an opportunity is treated as
   * SUSPECT rather than value: in liquid markets a large gap usually means the model is
   * missing information (injury, withdrawal, conditions), not that the market is wrong.
   */
  maxDivergence: number;
}

export const DEFAULT_VALUE_SETTINGS: ValueSettings = {
  fraction: 0.25,
  maxStakePct: 0.02,
  modelConfidence: 0.5,
  minEdge: 0.02,
  minDataQuality: 0.5,
  maxDivergence: 0.1,
};

/** Grade confidence from data quality, interval width and consensus depth. */
export function gradeConfidence(input: ValueInput): Confidence {
  const width = input.modelIntervalWidth ?? 0.3;
  if (input.dataQuality >= 0.8 && width <= 0.12 && input.booksInConsensus >= 4) return "high";
  if (input.dataQuality >= 0.6 && width <= 0.2 && input.booksInConsensus >= 2) return "medium";
  return "low";
}

/**
 * Evaluate one priced selection. Returns null when no model probability exists:
 * we never fabricate a probability to fill the table.
 */
export function evaluateValue(input: ValueInput, settings: ValueSettings = DEFAULT_VALUE_SETTINGS): ValueOpportunity | null {
  if (input.modelProbability === null || input.modelProbability <= 0 || input.modelProbability >= 1) return null;

  const p = input.modelProbability;
  const warnings: string[] = [];
  const bookImplied = impliedProbability(input.bestOdds);
  const ev = expectedValue(p, input.bestOdds);

  const w = input.modelIntervalWidth;
  const pLow = w ? Math.max(0.0001, p - w / 2) : null;
  const evLow = pLow !== null ? expectedValue(pLow, input.bestOdds) : null;

  const kelly = fractionalKelly(p, input.bestOdds, {
    fraction: settings.fraction,
    maxStakePct: settings.maxStakePct,
    modelConfidence: settings.modelConfidence,
    marketProbability: input.marketProbability ?? undefined,
  });

  if (input.dataQuality < settings.minDataQuality) warnings.push("Low data quality — treat as unverified");
  if (input.marketProbability !== null && Math.abs(p - input.marketProbability) > settings.maxDivergence)
    warnings.push("Model diverges sharply from market — check for missing information (injury, withdrawal)");
  if (evLow !== null && evLow < 0) warnings.push("Edge disappears at the lower end of the model interval");
  if (input.booksInConsensus < 2) warnings.push("Thin market — consensus from fewer than 2 books");

  return {
    ...input,
    modelProbability: p,
    bookmakerImpliedProbability: bookImplied,
    fairOdds: fairOdds(p),
    expectedValue: ev,
    edgePct: p - bookImplied,
    evLowerBound: evLow,
    kellyStakePct: kelly.stakePct,
    kellyCapped: kelly.capped,
    confidence: gradeConfidence(input),
    suspect: input.marketProbability !== null && Math.abs(p - input.marketProbability) > settings.maxDivergence,
    warnings,
  };
}

export function passesThresholds(v: ValueOpportunity, settings: ValueSettings = DEFAULT_VALUE_SETTINGS): boolean {
  return v.expectedValue >= settings.minEdge && v.dataQuality >= settings.minDataQuality && v.kellyStakePct > 0 && !v.suspect;
}

/** Filter evaluated opportunities to those that pass the user's thresholds. */
export function findValue(inputs: ValueInput[], settings: ValueSettings = DEFAULT_VALUE_SETTINGS): ValueOpportunity[] {
  return inputs
    .map((i) => evaluateValue(i, settings))
    .filter((v): v is ValueOpportunity => v !== null)
    .filter((v) => passesThresholds(v, settings))
    .sort((a, b) => b.expectedValue - a.expectedValue);
}
