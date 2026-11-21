/**
 * Arbitrage detection for complete markets (2-way or n-way).
 * An arb exists when Σ 1/o'ᵢ < 1, with o' the commission-adjusted odds 1 + (o − 1)(1 − c).
 * Stakes are allocated proportionally to 1/o' so every outcome returns the same amount.
 * Results are THEORETICAL until prices, limits and settlement rules are verified.
 */
import { money } from "./decimal";

export interface ArbLeg {
  selection: string;
  bookmaker: string;
  odds: number;
  commission?: number;
  /** Maximum stake accepted, in this leg's currency. */
  maxStake?: number | null;
  /** Conversion of 1 unit of the leg currency into the base currency (default 1). */
  fxToBase?: number;
}

export interface ArbResult {
  isArb: boolean;
  /** Σ 1/o' */
  bookSum: number;
  /** Guaranteed return on total stake: 1/Σ − 1. */
  margin: number;
  totalStake: number;
  guaranteedReturn: number;
  guaranteedProfit: number;
  /** True when a max-stake limit reduced the total stake. */
  limitedByMaxStake: boolean;
  legs: (ArbLeg & { effectiveOdds: number; stakeBase: number; stake: number; returnBase: number })[];
  status: "theoretical";
}

export const effectiveOdds = (odds: number, commission = 0) => 1 + (odds - 1) * (1 - commission);

export function arbitrage(legs: ArbLeg[], totalStakeBase: number): ArbResult {
  if (legs.length < 2) throw new Error("A complete market needs at least two outcomes");
  if (legs.some((l) => !(l.odds > 1))) throw new Error("All odds must be > 1");
  const eff = legs.map((l) => effectiveOdds(l.odds, l.commission ?? 0));
  const bookSum = eff.reduce((s, o) => s + 1 / o, 0);
  // Scale the total stake down if any leg's max stake would be exceeded.
  let total = totalStakeBase;
  let limited = false;
  legs.forEach((l, i) => {
    if (l.maxStake == null) return;
    const share = 1 / eff[i]! / bookSum;
    const maxTotal = (l.maxStake * (l.fxToBase ?? 1)) / share;
    if (maxTotal < total) { total = maxTotal; limited = true; }
  });
  const out = legs.map((l, i) => {
    const stakeBase = (total * (1 / eff[i]!)) / bookSum;
    return {
      ...l,
      effectiveOdds: eff[i]!,
      stakeBase: money(stakeBase).toNumber(),
      stake: money(stakeBase / (l.fxToBase ?? 1)).toNumber(),
      returnBase: money(stakeBase * eff[i]!).toNumber(),
    };
  });
  const ret = total / bookSum;
  return {
    isArb: bookSum < 1,
    bookSum,
    margin: 1 / bookSum - 1,
    totalStake: money(total).toNumber(),
    guaranteedReturn: money(ret).toNumber(),
    guaranteedProfit: money(ret - total).toNumber(),
    limitedByMaxStake: limited,
    legs: out,
    status: "theoretical",
  };
}

/** Best price per outcome across bookmakers, then arbitrage on that combination. */
export function bestPriceArb(
  quotes: { selection: string; bookmaker: string; odds: number; commission?: number }[],
  outcomes: string[],
  totalStake = 100,
): ArbResult | null {
  const best = outcomes.map((o) =>
    quotes.filter((q) => q.selection === o).sort((a, b) => effectiveOdds(b.odds, b.commission) - effectiveOdds(a.odds, a.commission))[0],
  );
  if (best.some((b) => !b)) return null;
  return arbitrage(best as ArbLeg[], totalStake);
}
