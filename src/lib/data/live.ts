import "server-only";
import { LIVE_STATUSES } from "../domain";
import { buildMarketRows } from "./board";
import { getPredictions, getSnapshot, getStats } from "./service";
import { calibrateServe, liveWinProb } from "../engine/live-prob";
import { isDemoMode } from "../env";

export interface LiveMatchView {
  match: import("../domain").Match;
  bestA: number | null;
  bestB: number | null;
  consensusA: number | null;
  preMatchA: number | null;
  liveA: number | null;
  stats: import("../domain").MatchStatistics | null;
  oddsUpdatedAt: string | null;
}

/** Polling interval the UI should use, respecting provider limits. */
export function livePollMs(): number {
  return isDemoMode() ? 15_000 : 10_000;
}

export async function liveViews(): Promise<LiveMatchView[]> {
  const [snap, preds] = await Promise.all([getSnapshot(), getPredictions()]);
  const live = snap.matches.filter((m) => LIVE_STATUSES.includes(m.status));
  return Promise.all(
    live.map(async (m) => {
      const mw = buildMarketRows(m.id, snap.quotes[m.id] ?? []).find((r) => r.market === "match_winner");
      const pre = preds.find((p) => p.matchId === m.id)?.prediction?.probA ?? null;
      let liveA: number | null = null;
      if (pre !== null && m.score && m.bestOf) {
        const base = m.playerA.tour === "wta" ? 0.56 : 0.64;
        const { pa, pb } = calibrateServe(pre, m.bestOf, base);
        liveA = liveWinProb(pa, pb, { bestOf: m.bestOf, sets: m.score.sets, game: m.score.game, server: m.score.server });
      }
      return {
        match: m,
        bestA: mw?.selections.find((s) => s.selection === "a")?.bestOdds ?? null,
        bestB: mw?.selections.find((s) => s.selection === "b")?.bestOdds ?? null,
        consensusA: mw?.selections.find((s) => s.selection === "a")?.consensusProbability ?? null,
        preMatchA: pre,
        liveA,
        stats: await getStats(m.id),
        oddsUpdatedAt: mw?.lastUpdate ?? null,
      };
    }),
  );
}
