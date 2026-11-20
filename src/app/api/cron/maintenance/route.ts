import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cronAuthorized } from "@/lib/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly: mark closing prices, capture closing odds for all users, prune old history. */
export async function GET(req: NextRequest) {
  const deny = cronAuthorized(req);
  if (deny) return deny;
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "service role not configured" }, { status: 503 });
  const marked = await admin.rpc("mark_closing_odds");
  const { data: users } = await admin.from("profiles").select("id").limit(10000);
  let captured = 0;
  for (const u of users ?? []) captured += Number((await admin.rpc("capture_closing_odds_for", { p_user: u.id })).data ?? 0);
  const pruned = await admin.rpc("prune_odds_history", { p_days: 120 });
  return NextResponse.json({ ok: true, marked: marked.data, captured, pruned: pruned.data });
}
