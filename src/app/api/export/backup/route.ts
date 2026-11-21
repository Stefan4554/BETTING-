import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Full JSON backup of the signed-in user's data (RLS-scoped, both workspaces, secrets excluded). */
export async function GET() {
  const sb = await supabaseServer();
  if (!sb) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tables = ["profiles", "user_settings", "risk_limits", "bankrolls", "bankroll_transactions", "strategies", "bets", "bet_legs", "bet_notes", "trades", "trade_executions",
    "goals", "alerts", "saved_views", "bookmaker_accounts", "api_connections", "exchange_rates"] as const;
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rows: unknown[] = [];
    for (let off = 0; off < 200_000; off += 1000) {
      const { data, error } = await sb.from(t).select("*").range(off, off + 999);
      if (error) return NextResponse.json({ error: `${t}: ${error.message}` }, { status: 500 });
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    out[t] = t === "exchange_rates" ? rows.filter((r) => (r as { owner_id: string | null }).owner_id) : rows;
  }
  const body = JSON.stringify({ format: "betting-edge-pro-backup", version: 1, exported_at: new Date().toISOString(), user_id: auth.user.id, data: out }, null, 1);
  return new NextResponse(body, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="betting-edge-backup-${new Date().toISOString().slice(0, 10)}.json"` } });
}
