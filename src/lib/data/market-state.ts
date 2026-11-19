import "server-only";
import type { MarketState } from "../engine/alerts";
import { buildMarketRows } from "./board";
import { getPredictions, getSnapshot, getValueCandidates } from "./service";

/** Current per-match market state used for alert evaluation (server cron and in-browser). */
export async function marketStates(): Promise<MarketState[]> {
  const [snap, value, preds] = await Promise.all([getSnapshot(), getValueCandidates(), getPredictions()]);
  return snap.matches.map((m) => {
    const mw = buildMarketRows(m.id, snap.quotes[m.id] ?? []).find((r) => r.market === "match_winner");
    const p = preds.find((x) => x.matchId === m.id)?.prediction;
    return {
      matchId: m.id,
      label: `${m.playerA.name} v ${m.playerB.name}`,
      status: m.status,
      scheduledAt: m.scheduledAt,
      best: Object.fromEntries((mw?.selections ?? []).filter((s) => s.bestOdds).map((s) => [s.selection, s.bestOdds!])),
      consensus: Object.fromEntries((mw?.selections ?? []).filter((s) => s.consensusProbability != null).map((s) => [s.selection, s.consensusProbability!])),
      modelProbability: { a: p?.probA ?? null, b: p ? 1 - p.probA : null },
      ev: Object.fromEntries(value.filter((v) => v.matchId === m.id && !v.suspect).map((v) => [v.selection, v.expectedValue])),
    };
  });
}
