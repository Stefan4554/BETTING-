import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cronAuthorized } from "@/lib/server/cron";
import { connectionConfig, ingest, loadConnectionKey, recordIngestOutcome } from "@/lib/server/ingest";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled odds ingestion. Polls every enabled user connection whose refresh interval has
 * elapsed (respecting the provider minimum), plus the optional platform key (shared data).
 */
export async function GET(req: NextRequest) {
  const deny = cronAuthorized(req);
  if (deny) return deny;
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "service role not configured" }, { status: 503 });
  const started = Date.now();
  const { data: conns } = await admin.from("api_connections").select("*, odds_providers(min_refresh_seconds, implemented)").eq("is_enabled", true).limit(200);
  const results: Record<string, unknown>[] = [];
  for (const c of conns ?? []) {
    if (Date.now() - started > 240_000) break;
    const prov = c.odds_providers as { min_refresh_seconds: number; implemented: boolean } | null;
    if (!prov?.implemented) continue;
    const key = await loadConnectionKey(admin, c.id).catch(() => null);
    if (!key) continue;
    const cfg = connectionConfig(c as never, key);
    if (!cfg.sports?.length) continue;
    const due = !c.last_success_at || Date.now() - Date.parse(c.last_success_at) >= Math.max(cfg.refreshSeconds, prov.min_refresh_seconds) * 1000;
    if (!due) continue;
    const r = await ingest(admin, { providerId: c.provider_id, config: cfg, ownerId: c.user_id, connectionId: c.id });
    const failed = await recordIngestOutcome(admin, c, r);
    if (failed) await admin.from("alerts").upsert({ user_id: c.user_id, is_demo: false, type: "api_failure", severity: "warning", title: `Scheduled odds ingestion failed (${r.errorStatus ?? "error"})`,
      body: r.errors.slice(0, 2).join(" · "), dedupe_key: `api_failure:${c.id}:${new Date().toISOString().slice(0, 13)}` }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
    results.push({ connection: c.id, ...r });
  }
  const e = env();
  if (e.THE_ODDS_API_KEY && process.env.PLATFORM_ODDS_SPORTS) {
    const r = await ingest(admin, { providerId: "the_odds_api", ownerId: null, config: { apiKey: e.THE_ODDS_API_KEY, regions: process.env.PLATFORM_ODDS_REGIONS ?? "eu,uk", markets: "h2h,totals", sports: process.env.PLATFORM_ODDS_SPORTS.split(",") } });
    results.push({ connection: "platform", ...r });
  }
  return NextResponse.json({ ok: true, ran: results.length, results, ms: Date.now() - started });
}
