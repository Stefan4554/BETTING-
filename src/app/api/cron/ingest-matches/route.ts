import { NextResponse, type NextRequest } from "next/server";
import { assertCron, apiError } from "@/lib/api";
import { getSnapshot, getStats } from "@/lib/data/service";
import { upsertMatch, hookUsageLogging } from "@/lib/data/repository";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { FINISHED_STATUSES } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Upsert schedules/results (+ final statistics) so the model's history grows over time. */
export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  if (isDemoMode()) return NextResponse.json({ skipped: "demo mode — nothing is persisted" });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  hookUsageLogging();
  try {
    const snap = await getSnapshot();
    let upserted = 0, stats = 0;
    for (const m of snap.matches) {
      if (m.source.provider === "the_odds_api") continue; // names-only events are stored by ingest-odds
      const id = await upsertMatch(m);
      if (!id) continue;
      upserted++;
      if (FINISHED_STATUSES.includes(m.status)) {
        const s = await getStats(m.id);
        if (!s) continue;
        const { data: players } = await sb.from("matches").select("player_a_id,player_b_id").eq("id", id).single();
        const rows = (["a", "b"] as const).map((side) => {
          const x = s[side];
          return {
            match_id: id, player_id: side === "a" ? players!.player_a_id : players!.player_b_id, period: "match", provider: m.source.provider,
            aces: x.aces, double_faults: x.doubleFaults, first_serve_in: x.firstServeIn, first_serve_attempts: x.firstServeAttempts,
            first_serve_points_won: x.firstServePointsWon, first_serve_points_played: x.firstServePointsPlayed,
            second_serve_points_won: x.secondServePointsWon, second_serve_points_played: x.secondServePointsPlayed,
            break_points_saved: x.breakPointsSaved, break_points_faced: x.breakPointsFaced, break_points_converted: x.breakPointsConverted,
            break_points_opportunities: x.breakPointsOpportunities, service_games_won: x.serviceGamesWon, service_games_played: x.serviceGamesPlayed,
            return_games_won: x.returnGamesWon, return_games_played: x.returnGamesPlayed, total_points_won: x.totalPointsWon,
            winners: x.winners, unforced_errors: x.unforcedErrors,
          };
        });
        const { error } = await sb.from("match_statistics").upsert(rows, { onConflict: "match_id,player_id,period" });
        if (!error) stats++;
      }
    }
    return NextResponse.json({ upserted, statsStored: stats, notices: snap.notices });
  } catch (e) {
    return apiError(e);
  }
}
