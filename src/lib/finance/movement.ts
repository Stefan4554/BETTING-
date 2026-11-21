/**
 * Odds movement engine: compares stored snapshots of the same (market, bookmaker, selection).
 *   shortening = price fell (more likely) · drifting = price rose · significant when the
 *   implied-probability shift ≥ threshold. Suspensions and line changes are reported too.
 */
export interface Snapshot { marketId: string; bookmaker: string; selection: string; line: number | null; odds: number; capturedAt: string; suspended: boolean; isLive?: boolean }

export type MoveDirection = "shortening" | "drifting" | "stable";

export interface Movement {
  marketId: string; bookmaker: string; selection: string;
  opening: number; previous: number | null; current: number;
  changePct: number;              // vs opening
  lastChangePct: number | null;   // vs previous snapshot
  probShift: number;              // implied pp vs opening (+ = shortening)
  direction: MoveDirection;
  significant: boolean;
  suspended: boolean;
  lineChanged: boolean;
  snapshots: number;
  firstAt: string; lastAt: string;
}

export function classify(opening: number, current: number, tolerance = 0.01): MoveDirection {
  const c = current / opening - 1;
  return c <= -tolerance ? "shortening" : c >= tolerance ? "drifting" : "stable";
}

export function movements(snaps: Snapshot[], opts: { significantProbShift?: number; tolerance?: number } = {}): Movement[] {
  const sig = opts.significantProbShift ?? 0.03;
  const groups = new Map<string, Snapshot[]>();
  for (const s of snaps) {
    const k = `${s.marketId}|${s.bookmaker}|${s.selection}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  const out: Movement[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    const first = list[0]!, last = list.at(-1)!, prev = list.length > 1 ? list.at(-2)! : null;
    const probShift = 1 / last.odds - 1 / first.odds;
    out.push({
      marketId: first.marketId, bookmaker: first.bookmaker, selection: first.selection,
      opening: first.odds, previous: prev?.odds ?? null, current: last.odds,
      changePct: last.odds / first.odds - 1,
      lastChangePct: prev ? last.odds / prev.odds - 1 : null,
      probShift,
      direction: classify(first.odds, last.odds, opts.tolerance),
      significant: Math.abs(probShift) >= sig,
      suspended: last.suspended,
      lineChanged: list.some((s) => s.line !== first.line),
      snapshots: list.length, firstAt: first.capturedAt, lastAt: last.capturedAt,
    });
  }
  return out.sort((a, b) => Math.abs(b.probShift) - Math.abs(a.probShift));
}
