/**
 * Probability calibration of the user's estimates against outcomes.
 * Only bets with a valid estimated probability and a binary outcome (won/lost) are used;
 * half results, voids and cash-outs are excluded because they are not clean outcomes.
 */
import type { BetRecord } from "./metrics";

export interface CalibrationBucket {
  lo: number; hi: number; label: string;
  n: number;
  meanPredicted: number | null;
  actualRate: number | null;
  /** 95% Wilson score interval for the actual win rate. */
  ciLow: number | null; ciHigh: number | null;
}

export interface CalibrationReport {
  sample: number;
  excluded: number;
  brier: number | null;
  /** Brier score of the bookmaker's implied probability on the same bets (lower = better). */
  marketBrier: number | null;
  /** 1 − brier / marketBrier: positive = your estimates beat the market's implied odds. */
  brierSkill: number | null;
  logLoss: number | null;
  meanPredicted: number | null;
  actualRate: number | null;
  buckets: CalibrationBucket[];
  lowSample: boolean;
}

export function wilson(successes: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function calibrate(bets: BetRecord[], bucketCount = 10): CalibrationReport {
  const eligible = bets.filter(
    (b) => b.estProbability != null && b.estProbability > 0 && b.estProbability < 1 && b.side === "back" && (b.status === "won" || b.status === "lost"),
  );
  const excluded = bets.filter((b) => b.estProbability != null && b.status !== "pending").length - eligible.length;
  const eps = 1e-12;
  let brier = 0, mBrier = 0, ll = 0, pSum = 0, wins = 0;
  for (const b of eligible) {
    const y = b.status === "won" ? 1 : 0;
    const p = b.estProbability!;
    const m = Math.min(1 - eps, 1 / b.odds);
    brier += (p - y) ** 2;
    mBrier += (m - y) ** 2;
    ll += -(y * Math.log(Math.max(p, eps)) + (1 - y) * Math.log(Math.max(1 - p, eps)));
    pSum += p;
    wins += y;
  }
  const n = eligible.length;
  const buckets: CalibrationBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const lo = i / bucketCount, hi = (i + 1) / bucketCount;
    const inB = eligible.filter((b) => b.estProbability! >= lo && (b.estProbability! < hi || (i === bucketCount - 1 && b.estProbability! <= hi)));
    const w = inB.filter((b) => b.status === "won").length;
    const ci = wilson(w, inB.length);
    return {
      lo, hi, label: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, n: inB.length,
      meanPredicted: inB.length ? inB.reduce((s, b) => s + b.estProbability!, 0) / inB.length : null,
      actualRate: inB.length ? w / inB.length : null,
      ciLow: ci?.[0] ?? null, ciHigh: ci?.[1] ?? null,
    };
  });
  return {
    sample: n, excluded,
    brier: n ? brier / n : null,
    marketBrier: n ? mBrier / n : null,
    brierSkill: n && mBrier > 0 ? 1 - brier / mBrier : null,
    logLoss: n ? ll / n : null,
    meanPredicted: n ? pSum / n : null,
    actualRate: n ? wins / n : null,
    buckets,
    lowSample: n < 50,
  };
}
