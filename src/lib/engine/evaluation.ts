/**
 * Model evaluation: chronological splits, Brier score, log loss and calibration.
 */
import { EloModel, type EloParams, type HistoricalMatch } from "./elo";

export interface Forecast {
  probability: number; // forecast probability of the event
  outcome: 0 | 1;
}

export function brierScore(f: Forecast[]): number {
  if (f.length === 0) return NaN;
  return f.reduce((s, x) => s + (x.probability - x.outcome) ** 2, 0) / f.length;
}

export function logLoss(f: Forecast[], eps = 1e-15): number {
  if (f.length === 0) return NaN;
  return (
    -f.reduce((s, x) => {
      const p = Math.min(Math.max(x.probability, eps), 1 - eps);
      return s + (x.outcome * Math.log(p) + (1 - x.outcome) * Math.log(1 - p));
    }, 0) / f.length
  );
}

export function accuracy(f: Forecast[]): number {
  if (f.length === 0) return NaN;
  return f.filter((x) => (x.probability >= 0.5 ? 1 : 0) === x.outcome).length / f.length;
}

export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  meanForecast: number;
  observedRate: number;
}

export function calibration(f: Forecast[], bins = 10): CalibrationBin[] {
  const out: CalibrationBin[] = Array.from({ length: bins }, (_, i) => ({
    lower: i / bins,
    upper: (i + 1) / bins,
    count: 0,
    meanForecast: 0,
    observedRate: 0,
  }));
  for (const x of f) {
    const idx = Math.min(bins - 1, Math.floor(x.probability * bins));
    const b = out[idx]!;
    b.count++;
    b.meanForecast += x.probability;
    b.observedRate += x.outcome;
  }
  for (const b of out) {
    if (b.count) {
      b.meanForecast /= b.count;
      b.observedRate /= b.count;
    }
  }
  return out;
}

/** Expected calibration error, weighted by bin count. */
export function expectedCalibrationError(bins: CalibrationBin[]): number {
  const n = bins.reduce((s, b) => s + b.count, 0);
  if (!n) return NaN;
  return bins.reduce((s, b) => s + (b.count / n) * Math.abs(b.meanForecast - b.observedRate), 0);
}

export function chronologicalSplit<T extends { date: string }>(rows: T[], cutoff: string): { train: T[]; test: T[] } {
  const sorted = [...rows].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const c = Date.parse(cutoff);
  return { train: sorted.filter((r) => Date.parse(r.date) < c), test: sorted.filter((r) => Date.parse(r.date) >= c) };
}

export interface BacktestResult {
  trainSize: number;
  testSize: number;
  predicted: number;
  skippedInsufficientData: number;
  brier: number;
  logLoss: number;
  accuracy: number;
  ece: number;
  calibration: CalibrationBin[];
}

/**
 * Walk-forward backtest: fit on train, then for each test match predict BEFORE
 * updating with its result. Forecasts are made from player A's perspective where
 * A is chosen deterministically (by id) so the winner is not always "A".
 */
export function backtestElo(matches: HistoricalMatch[], cutoff: string, params?: EloParams): BacktestResult {
  const { train, test } = chronologicalSplit(matches, cutoff);
  const model = new EloModel(params).fit(train);
  const forecasts: Forecast[] = [];
  let skipped = 0;
  for (const m of test) {
    const [a, b] = [m.winnerId, m.loserId].sort();
    const pred = model.predict(a!, b!, m.surface);
    if (pred) forecasts.push({ probability: pred.probA, outcome: a === m.winnerId ? 1 : 0 });
    else skipped++;
    model.update(m); // update only after predicting → no leakage
  }
  const cal = calibration(forecasts);
  return {
    trainSize: train.length,
    testSize: test.length,
    predicted: forecasts.length,
    skippedInsufficientData: skipped,
    brier: brierScore(forecasts),
    logLoss: logLoss(forecasts),
    accuracy: accuracy(forecasts),
    ece: expectedCalibrationError(cal),
    calibration: cal,
  };
}
