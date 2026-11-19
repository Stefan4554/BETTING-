import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiTennis, oddsApi, sportradarTennis } from "@/lib/providers/registry";
import { rateLimit } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/env";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Make one cheap real request to verify a provider key. Admin-only when auth is on. */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "provider-test", 6);
  if (limited) return limited;
  if (isSupabaseConfigured()) {
    const u = await currentUser();
    if (u?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = z.enum(["the_odds_api", "sportradar_tennis", "api_tennis"]).safeParse(req.nextUrl.searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  const started = Date.now();
  try {
    let detail = "";
    if (id.data === "the_odds_api") {
      const c = oddsApi();
      if (!c) return NextResponse.json({ ok: false, detail: "NOT CONNECTED — THE_ODDS_API_KEY missing" });
      const s = await c.tennisSports(); // /sports does not consume quota
      detail = `${s.length} active tennis tournaments`;
    } else if (id.data === "sportradar_tennis") {
      const c = sportradarTennis();
      if (!c) return NextResponse.json({ ok: false, detail: "NOT CONNECTED — SPORTRADAR_TENNIS_API_KEY missing" });
      const s = await c.dailySummaries(new Date().toISOString().slice(0, 10));
      detail = `${s.length} matches today`;
    } else {
      const c = apiTennis();
      if (!c) return NextResponse.json({ ok: false, detail: "NOT CONNECTED — API_TENNIS_KEY missing" });
      const d = new Date().toISOString().slice(0, 10);
      const s = await c.fixtures(d, d);
      detail = `${s.length} fixtures today`;
    }
    return NextResponse.json({ ok: true, detail, ms: Date.now() - started });
  } catch (e) {
    return NextResponse.json({ ok: false, detail: (e as Error).message, ms: Date.now() - started });
  }
}
