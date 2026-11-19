import { impliedProbability } from "./odds";

export interface PricePoint {
  bookmaker: string;
  odds: number;
  at: string; // ISO timestamp
}

export type Direction = "shortening" | "drifting" | "stable";

export function direction(opening: number, current: number, tolerance = 0.01): Direction {
  const change = (current - opening) / opening;
  if (change <= -tolerance) return "shortening";
  if (change >= tolerance) return "drifting";
  return "stable";
}

export interface SteamMove {
  start: string;
  end: string;
  booksMoved: number;
  avgProbShift: number; // implied-probability points, positive = shortening
}

/**
 * Steam move: within `windowMs`, at least `minBooks` bookmakers move the same
 * direction by at least `minProbShift` implied-probability points.
 */
export function detectSteamMoves(
  points: PricePoint[],
  opts: { windowMs?: number; minBooks?: number; minProbShift?: number } = {},
): SteamMove[] {
  const windowMs = opts.windowMs ?? 15 * 60_000;
  const minBooks = opts.minBooks ?? 3;
  const minShift = opts.minProbShift ?? 0.02;

  const byBook = new Map<string, PricePoint[]>();
  for (const p of [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const list = byBook.get(p.bookmaker) ?? [];
    list.push(p);
    byBook.set(p.bookmaker, list);
  }

  // Collect per-book moves (consecutive snapshots).
  const moves: { book: string; at: number; shift: number }[] = [];
  for (const [book, list] of byBook) {
    for (let i = 1; i < list.length; i++) {
      const shift = impliedProbability(list[i]!.odds) - impliedProbability(list[i - 1]!.odds);
      if (Math.abs(shift) >= minShift) moves.push({ book, at: Date.parse(list[i]!.at), shift });
    }
  }
  moves.sort((a, b) => a.at - b.at);

  const result: SteamMove[] = [];
  let i = 0;
  while (i < moves.length) {
    const anchor = moves[i]!;
    const sign = Math.sign(anchor.shift);
    const inWindow = moves.filter((m) => m.at >= anchor.at && m.at <= anchor.at + windowMs && Math.sign(m.shift) === sign);
    const books = new Set(inWindow.map((m) => m.book));
    if (books.size >= minBooks) {
      result.push({
        start: new Date(anchor.at).toISOString(),
        end: new Date(Math.max(...inWindow.map((m) => m.at))).toISOString(),
        booksMoved: books.size,
        avgProbShift: inWindow.reduce((s, m) => s + m.shift, 0) / inWindow.length,
      });
      const last = Math.max(...inWindow.map((m) => m.at));
      while (i < moves.length && moves[i]!.at <= last) i++;
    } else i++;
  }
  return result;
}

/**
 * Reverse line movement: price moves against the side receiving the majority of
 * public bets. Requires betting-percentage data, which most odds APIs do NOT provide;
 * returns null when the input is unavailable rather than guessing.
 */
export function reverseLineMovement(
  publicBetShare: number | null,
  opening: number,
  current: number,
): boolean | null {
  if (publicBetShare === null) return null;
  const d = direction(opening, current);
  return publicBetShare > 0.5 && d === "drifting";
}

/** Bucket a price series into a time window (for charts with selectable periods). */
export function filterWindow<T extends { at: string }>(points: T[], windowMs: number, now = new Date()): T[] {
  const from = now.getTime() - windowMs;
  return points.filter((p) => Date.parse(p.at) >= from);
}
