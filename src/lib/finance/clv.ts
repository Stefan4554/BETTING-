/**
 * Closing line value.
 *   Odds-based CLV        = taken odds / closing odds − 1          (e.g. 2.10 vs 2.00 → +5.0%)
 *   Probability-based CLV = closing implied p − entry implied p     (percentage points; e.g. 47.6% → 50.0% = +2.4pp)
 * Positive = you beat the close. The convention in use is always labelled in the UI.
 */
import { impliedProbability } from "./odds";

export type ClvConvention = "odds" | "probability";

export function clvOdds(taken: number, closing: number): number | null {
  if (!(taken > 1) || !(closing > 1)) return null;
  return taken / closing - 1;
}

export function clvProbability(taken: number, closing: number): number | null {
  if (!(taken > 1) || !(closing > 1)) return null;
  return impliedProbability(closing) - impliedProbability(taken);
}

/** For a lay bet you want the price to shorten after you lay: CLV sign flips. */
export function clv(taken: number, closing: number | null | undefined, convention: ClvConvention, side: "back" | "lay" = "back"): number | null {
  if (closing == null) return null;
  const v = convention === "odds" ? clvOdds(taken, closing) : clvProbability(taken, closing);
  if (v === null) return null;
  return side === "lay" ? (convention === "odds" ? closing / taken - 1 : -v) : v;
}

export function clvLabel(convention: ClvConvention): string {
  return convention === "odds" ? "CLV (odds: taken/closing − 1)" : "CLV (prob.: closing − entry implied, pp)";
}

/** Market movement from opening to closing, % change in price (negative = shortened). */
export function marketMovement(opening: number | null | undefined, closing: number | null | undefined): number | null {
  if (!opening || !closing || opening <= 1 || closing <= 1) return null;
  return closing / opening - 1;
}
