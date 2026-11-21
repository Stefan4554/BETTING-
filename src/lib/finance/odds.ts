/**
 * Core odds mathematics. Pure functions, no I/O.
 * All odds are decimal (European) unless stated otherwise.
 */

export class OddsError extends Error {}

export function assertValidOdds(odds: number): void {
  if (!Number.isFinite(odds) || odds <= 1) {
    throw new OddsError(`Invalid decimal odds: ${odds}. Decimal odds must be > 1.`);
  }
}

export function assertProbability(p: number): void {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new OddsError(`Probability must be in (0, 1), got ${p}`);
  }
}

/** P = 1 / decimal odds */
export function impliedProbability(odds: number): number {
  assertValidOdds(odds);
  return 1 / odds;
}

/** Fair odds = 1 / probability */
export function fairOdds(probability: number): number {
  assertProbability(probability);
  return 1 / probability;
}

/** Sum of implied probabilities minus 1 (bookmaker margin / overround). */
export function overround(oddsSet: number[]): number {
  if (oddsSet.length < 2) throw new OddsError("Overround needs at least two outcomes");
  return oddsSet.reduce((s, o) => s + impliedProbability(o), 0) - 1;
}

export type DevigMethod = "multiplicative" | "additive" | "power" | "shin";

/**
 * Remove bookmaker margin from a complete set of mutually exclusive outcomes.
 * - multiplicative: normalise implied probabilities (most common).
 * - additive: subtract equal share of margin from each outcome.
 * - power: find k such that sum(p_i^k) = 1 (accounts for favourite-longshot bias).
 * - shin: Shin (1993) insider-trading model, iterative.
 */
export function removeVig(oddsSet: number[], method: DevigMethod = "multiplicative"): number[] {
  const implied = oddsSet.map(impliedProbability);
  const booksum = implied.reduce((a, b) => a + b, 0);
  const n = implied.length;
  if (n < 2) throw new OddsError("De-vig needs at least two outcomes");

  switch (method) {
    case "multiplicative":
      return implied.map((p) => p / booksum);
    case "additive": {
      const adj = (booksum - 1) / n;
      const out = implied.map((p) => p - adj);
      if (out.some((p) => p <= 0)) return implied.map((p) => p / booksum);
      return out;
    }
    case "power": {
      if (booksum <= 1) return implied.map((p) => p / booksum);
      let lo = 1;
      let hi = 10;
      for (let i = 0; i < 100; i++) {
        const k = (lo + hi) / 2;
        const s = implied.reduce((acc, p) => acc + Math.pow(p, k), 0);
        if (s > 1) lo = k;
        else hi = k;
      }
      const k = (lo + hi) / 2;
      const out = implied.map((p) => Math.pow(p, k));
      const s = out.reduce((a, b) => a + b, 0);
      return out.map((p) => p / s);
    }
    case "shin": {
      if (booksum <= 1) return implied.map((p) => p / booksum);
      const z = shinZ(implied, booksum);
      const probs = implied.map(
        (p) => (Math.sqrt(z * z + (4 * (1 - z) * p * p) / booksum) - z) / (2 * (1 - z)),
      );
      const s = probs.reduce((a, b) => a + b, 0);
      return probs.map((p) => p / s);
    }
  }
}

/**
 * Shin's z (proportion of insider money). Analytic for two outcomes,
 * fixed-point iteration otherwise (as in Clarke, Kovalchik & Ingram 2017; R package "implied").
 */
function shinZ(implied: number[], booksum: number): number {
  const n = implied.length;
  if (n === 2) {
    const d = implied[0]! - implied[1]!;
    return ((booksum - 1) * (d * d - booksum)) / (booksum * (d * d - 1));
  }
  let z = 0;
  for (let i = 0; i < 1000; i++) {
    const zNew =
      (implied.reduce((acc, p) => acc + Math.sqrt(z * z + (4 * (1 - z) * p * p) / booksum), 0) - 2) /
      (n - 2);
    if (Math.abs(zNew - z) < 1e-12) return zNew;
    z = zNew;
  }
  return z;
}

/** EV per unit staked: (p × odds) − 1 */
export function expectedValue(modelProbability: number, odds: number): number {
  assertProbability(modelProbability);
  assertValidOdds(odds);
  return modelProbability * odds - 1;
}

/** Edge relative to the fair price: (odds / fairOdds) − 1  ≡ EV. Also expose prob-space edge. */
export function edgeProbability(modelProbability: number, odds: number): number {
  return modelProbability - impliedProbability(odds);
}

/** Percentage change from opening to current price (positive = drifting/lengthening). */
export function oddsMovementPct(opening: number, current: number): number {
  assertValidOdds(opening);
  assertValidOdds(current);
  return (current - opening) / opening;
}

/** Change in implied probability (percentage points). Positive = shortening (more likely). */
export function impliedProbabilityShift(opening: number, current: number): number {
  return impliedProbability(current) - impliedProbability(opening);
}

/** Closing line value: how much better the price taken was than the close. */
export function closingLineValue(takenOdds: number, closingOdds: number): number {
  assertValidOdds(takenOdds);
  assertValidOdds(closingOdds);
  return takenOdds / closingOdds - 1;
}

export function americanToDecimal(american: number): number {
  if (american === 0 || !Number.isFinite(american)) throw new OddsError("Invalid American odds");
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function decimalToAmerican(decimal: number): number {
  assertValidOdds(decimal);
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export function formatOdds(decimal: number, format: "decimal" | "american" | "fractional" = "decimal"): string {
  if (format === "fractional") return decimalToFractional(decimal);
  if (format === "american") {
    const a = decimalToAmerican(decimal);
    return a > 0 ? `+${a}` : `${a}`;
  }
  return decimal.toFixed(2);
}

/** Fractional odds string (e.g. "5/2") → decimal. */
export function fractionalToDecimal(frac: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(frac);
  if (!m || Number(m[2]) === 0) throw new OddsError(`Invalid fractional odds: ${frac}`);
  return 1 + Number(m[1]) / Number(m[2]);
}

/** Decimal → nearest simple fraction (denominator ≤ 100). */
export function decimalToFractional(decimal: number): string {
  assertValidOdds(decimal);
  const x = decimal - 1;
  let best = { n: Math.round(x), dn: 1, err: Math.abs(x - Math.round(x)) };
  for (let dn = 1; dn <= 100; dn++) {
    const n = Math.round(x * dn);
    const err = Math.abs(x - n / dn);
    if (err < best.err - 1e-12) best = { n, dn, err };
  }
  return `${best.n}/${best.dn}`;
}

/** Parse user input in decimal ("2.5"), American ("+150"/"-200") or fractional ("3/2") format. */
export function parseOdds(input: string): number {
  const s = input.trim();
  if (s.includes("/")) return fractionalToDecimal(s);
  if (/^[+-]\d+$/.test(s) && Math.abs(Number(s)) >= 100) return americanToDecimal(Number(s));
  const v = Number(s.replace(",", "."));
  assertValidOdds(v);
  return v;
}
