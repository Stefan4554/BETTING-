import { NextResponse, type NextRequest } from "next/server";
import { assertCron, apiError } from "@/lib/api";
import { getSnapshot } from "@/lib/data/service";
import { insertOddsSnapshots, upsertMatch, hookUsageLogging } from "@/lib/data/repository";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { LIVE_STATUSES } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Snapshot current odds into odds_snapshots (builds line history + closing odds). */
export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  if (isDemoMode()) return NextResponse.json({ skipped: "demo mode — nothing is persisted" });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  hookUsageLogging();
  try {
    const snap = await getSnapshot();
    let matches = 0, snapshots = 0;
    for (const m of snap.matches) {
      const quotes = snap.quotes[m.id];
      if (!quotes?.length) continue;
      const id = await upsertMatch(m);
      if (!id) continue;
      matches++;
      snapshots += await insertOddsSnapshots(id, quotes, LIVE_STATUSES.includes(m.status));
    }
    const { data: closing } = await sb.rpc("mark_closing_odds");
    await sb.from("api_providers").update({ last_success_at: new Date().toISOString() }).eq("id", "the_odds_api");
    return NextResponse.json({ matches, snapshots, closingMarked: closing ?? 0, notices: snap.notices });
  } catch (e) {
    return apiError(e);
  }
}
