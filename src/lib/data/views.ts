import "server-only";
import type { MatchRow } from "@/components/terminal/match-table";
import type { Match } from "../domain";
import { buildMarketRows } from "./board";
import { getPredictions, getSnapshot } from "./service";

/** Rows for match tables: best match-winner prices + model probability. */
export async function matchRows(filter: (m: Match) => boolean): Promise<MatchRow[]> {
  const [snap, preds] = await Promise.all([getSnapshot(), getPredictions()]);
  return snap.matches.filter(filter).map((m) => {
    const mw = buildMarketRows(m.id, snap.quotes[m.id] ?? []).find((r) => r.market === "match_winner");
    return {
      match: m,
      bestA: mw?.selections.find((s) => s.selection === "a")?.bestOdds ?? null,
      bestB: mw?.selections.find((s) => s.selection === "b")?.bestOdds ?? null,
      modelA: preds.find((p) => p.matchId === m.id)?.prediction?.probA ?? null,
    };
  });
}
