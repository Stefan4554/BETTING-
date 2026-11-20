import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cronAuthorized } from "@/lib/server/cron";

export const dynamic = "force-dynamic";

/** Daily ECB euro reference rates (public, free) → exchange_rates snapshots (EUR base). */
export async function GET(req: NextRequest) {
  const deny = cronAuthorized(req);
  if (deny) return deny;
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "service role not configured" }, { status: 503 });
  const res = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: `ECB ${res.status}` }, { status: 502 });
  const xml = await res.text();
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const rows = [...xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)].map((m) => ({ base: "EUR", quote: m[1]!, rate: Number(m[2]), as_of: date!, source: "ecb" }));
  if (!date || !rows.length) return NextResponse.json({ error: "could not parse ECB feed" }, { status: 502 });
  const { data: existing } = await admin.from("exchange_rates").select("quote").is("owner_id", null).eq("as_of", date);
  const have = new Set((existing ?? []).map((r) => r.quote));
  const fresh = rows.filter((r) => !have.has(r.quote));
  if (fresh.length) {
    const { error } = await admin.from("exchange_rates").insert(fresh);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, date, inserted: fresh.length });
}
