import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cronAuthorized } from "@/lib/server/cron";
import { processEmailOutbox } from "@/lib/server/email-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Email outbox worker: delivers queued notifications and retries transient failures. */
export async function GET(req: NextRequest) {
  const deny = cronAuthorized(req);
  if (deny) return deny;
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "service role not configured" }, { status: 503 });
  const total = { claimed: 0, sent: 0, retrying: 0, failed: 0, skipped: null as string | null };
  for (let i = 0; i < 5; i++) {
    const r = await processEmailOutbox(admin, { limit: 50 });
    total.claimed += r.claimed; total.sent += r.sent; total.retrying += r.retrying; total.failed += r.failed; total.skipped ??= r.skipped;
    if (r.claimed < 50) break;
  }
  return NextResponse.json({ ok: true, ...total });
}
