import { removeVig, type DevigMethod } from "./odds";

/** One bookmaker's complete two-way (or n-way) price for a market. */
export interface BookPrice {
  bookmaker: string;
  /** Odds keyed by selection id, must cover every outcome of the market. */
  prices: Record<string, number>;
  updatedAt: string;
  /** Sharp books (e.g. Pinnacle, exchanges) get more weight in consensus. */
  sharp?: boolean;
}

export interface ConsensusResult {
  /** No-vig consensus probability per selection. */
  probabilities: Record<string, number>;
  /** Best available price per selection with source. */
  best: Record<string, { odds: number; bookmaker: string; updatedAt: string }>;
  /** Average raw price per selection. */
  average: Record<string, number>;
  booksUsed: number;
  method: DevigMethod;
}

/**
 * Market consensus: de-vig each bookmaker separately, then take a weighted mean.
 * Books with stale prices (older than maxAgeMs relative to `now`) are excluded.
 */
export function marketConsensus(
  books: BookPrice[],
  selections: string[],
  opts: { method?: DevigMethod; sharpWeight?: number; now?: Date; maxAgeMs?: number } = {},
): ConsensusResult | null {
  const method = opts.method ?? "multiplicative";
  const sharpWeight = opts.sharpWeight ?? 3;
  const now = opts.now ?? new Date();
  const maxAge = opts.maxAgeMs ?? Infinity;

  const usable = books.filter(
    (b) =>
      selections.every((s) => typeof b.prices[s] === "number" && b.prices[s]! > 1) &&
      now.getTime() - new Date(b.updatedAt).getTime() <= maxAge,
  );
  if (usable.length === 0) return null;

  const probabilities: Record<string, number> = Object.fromEntries(selections.map((s) => [s, 0]));
  const average: Record<string, number> = Object.fromEntries(selections.map((s) => [s, 0]));
  const best: ConsensusResult["best"] = {};
  let totalWeight = 0;

  for (const b of usable) {
    const odds = selections.map((s) => b.prices[s]!);
    const fair = removeVig(odds, method);
    const w = b.sharp ? sharpWeight : 1;
    totalWeight += w;
    selections.forEach((s, i) => {
      probabilities[s]! += fair[i]! * w;
      average[s]! += odds[i]!;
      const cur = best[s];
      if (!cur || odds[i]! > cur.odds) best[s] = { odds: odds[i]!, bookmaker: b.bookmaker, updatedAt: b.updatedAt };
    });
  }
  for (const s of selections) {
    probabilities[s]! /= totalWeight;
    average[s]! /= usable.length;
  }
  return { probabilities, best, average, booksUsed: usable.length, method };
}
