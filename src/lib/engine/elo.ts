/**
 * Tennis Elo with surface adjustment.
 *
 * K-factor follows the FiveThirtyEight tennis formulation: K = 250 / (n + 5)^0.4,
 * where n is the number of matches a player has played, so ratings of new players
 * move faster. Surface ratings are tracked separately and blended with the
 * overall rating for prediction.
 */

export type Surface = "hard" | "clay" | "grass" | "indoor_hard" | "carpet" | "unknown";

export interface HistoricalMatch {
  id: string;
  date: string; // ISO
  winnerId: string;
  loserId: string;
  surface: Surface;
  bestOf?: 3 | 5;
  /** Retirements/walkovers are excluded from rating updates by default. */
  completed?: boolean;
}

export interface PlayerRating {
  overall: number;
  overallMatches: number;
  surface: Partial<Record<Surface, { rating: number; matches: number }>>;
  lastMatchDate?: string;
}

export interface EloParams {
  initial: number;
  kNumerator: number;
  kOffset: number;
  kShape: number;
  /** Weight of the surface rating in the blended prediction rating (0..1). */
  surfaceWeight: number;
  /** Multiplier applied to K for best-of-5 matches (more informative). */
  bestOf5Boost: number;
  /** Players with fewer matches than this have no prediction. */
  minMatches: number;
}

export const DEFAULT_ELO: EloParams = {
  initial: 1500,
  kNumerator: 250,
  kOffset: 5,
  kShape: 0.4,
  surfaceWeight: 0.5,
  bestOf5Boost: 1.1,
  minMatches: 10,
};

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function kFactor(matches: number, p: EloParams = DEFAULT_ELO): number {
  return p.kNumerator / Math.pow(matches + p.kOffset, p.kShape);
}

export class EloModel {
  readonly ratings = new Map<string, PlayerRating>();
  constructor(readonly params: EloParams = DEFAULT_ELO) {}

  get(id: string): PlayerRating {
    let r = this.ratings.get(id);
    if (!r) {
      r = { overall: this.params.initial, overallMatches: 0, surface: {} };
      this.ratings.set(id, r);
    }
    return r;
  }

  private surfaceRating(r: PlayerRating, s: Surface) {
    return r.surface[s] ?? { rating: this.params.initial, matches: 0 };
  }

  /** Blended rating used for prediction. */
  blended(id: string, surface: Surface): number {
    const r = this.get(id);
    if (surface === "unknown") return r.overall;
    const s = this.surfaceRating(r, surface);
    return (1 - this.params.surfaceWeight) * r.overall + this.params.surfaceWeight * s.rating;
  }

  update(m: HistoricalMatch): void {
    if (m.completed === false) return;
    const w = this.get(m.winnerId);
    const l = this.get(m.loserId);
    const boost = m.bestOf === 5 ? this.params.bestOf5Boost : 1;

    const eW = expectedScore(w.overall, l.overall);
    const kW = kFactor(w.overallMatches, this.params) * boost;
    const kL = kFactor(l.overallMatches, this.params) * boost;
    w.overall += kW * (1 - eW);
    l.overall -= kL * (1 - eW);
    w.overallMatches++;
    l.overallMatches++;

    if (m.surface !== "unknown") {
      const sw = { ...this.surfaceRating(w, m.surface) };
      const sl = { ...this.surfaceRating(l, m.surface) };
      const eS = expectedScore(sw.rating, sl.rating);
      sw.rating += kFactor(sw.matches, this.params) * boost * (1 - eS);
      sl.rating -= kFactor(sl.matches, this.params) * boost * (1 - eS);
      sw.matches++;
      sl.matches++;
      w.surface[m.surface] = sw;
      l.surface[m.surface] = sl;
    }
    w.lastMatchDate = m.date;
    l.lastMatchDate = m.date;
  }

  /** Fit on matches in chronological order. Throws on unsorted input to prevent leakage. */
  fit(matches: HistoricalMatch[]): this {
    for (let i = 1; i < matches.length; i++) {
      if (Date.parse(matches[i]!.date) < Date.parse(matches[i - 1]!.date)) {
        throw new Error("Matches must be sorted chronologically (data leakage guard)");
      }
    }
    for (const m of matches) this.update(m);
    return this;
  }

  /**
   * Win probability for A vs B. Returns null if either player lacks history —
   * the application must display "insufficient data" rather than a fabricated number.
   */
  predict(aId: string, bId: string, surface: Surface): EloPrediction | null {
    const a = this.ratings.get(aId);
    const b = this.ratings.get(bId);
    if (!a || !b || a.overallMatches < this.params.minMatches || b.overallMatches < this.params.minMatches) return null;
    const p = expectedScore(this.blended(aId, surface), this.blended(bId, surface));
    // Heuristic rating uncertainty: SD ≈ 350/√n Elo points (floored at 40), combined for
    // both players and mapped through the logistic curve to a ~90% interval.
    // This is NOT a calibrated posterior; the UI labels it as an approximate interval.
    const sdOf = (n: number) => Math.max(40, 350 / Math.sqrt(n));
    const sd = Math.hypot(sdOf(a.overallMatches), sdOf(b.overallMatches));
    const diff = this.blended(aId, surface) - this.blended(bId, surface);
    const z = 1.645;
    const toP = (d: number) => 1 / (1 + Math.pow(10, -d / 400));
    return {
      probA: p,
      ciLow: toP(diff - z * sd),
      ciHigh: toP(diff + z * sd),
      sampleA: a.overallMatches,
      sampleB: b.overallMatches,
    };
  }
}

export interface EloPrediction {
  probA: number;
  ciLow: number;
  ciHigh: number;
  sampleA: number;
  sampleB: number;
}
