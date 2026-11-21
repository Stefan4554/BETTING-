import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { env, isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Deployment health check. Reports configuration as booleans only (never values) and probes
 * the database with the service role, including the latest migration's objects.
 */
export async function GET() {
  const e = env();
  const config = {
    supabase: isSupabaseConfigured(), serviceRole: Boolean(e.SUPABASE_SERVICE_ROLE_KEY), encryptionKey: Boolean(e.API_KEY_ENCRYPTION_KEY),
    cronSecret: Boolean(e.CRON_SECRET), email: Boolean(e.RESEND_API_KEY && e.ALERTS_FROM_EMAIL), emailWebhook: Boolean(e.RESEND_WEBHOOK_SECRET), appUrl: Boolean(e.APP_URL),
  };
  const db: Record<string, boolean | string> = {};
  const admin = supabaseAdmin();
  if (admin) {
    const probe = async (name: string, f: () => PromiseLike<{ error: { message: string } | null }>) => { const r = await f(); db[name] = r.error ? r.error.message : true; };
    await probe("reachable", () => admin.from("sports").select("id", { head: true, count: "exact" }).limit(1));
    await probe("migration_0008_email_outbox", () => admin.from("email_outbox").select("id", { head: true }).limit(1));
    await probe("migration_0008_trade_reservations", () => admin.from("trades").select("reserved_base", { head: true }).limit(1));
  }
  const ok = config.supabase && config.serviceRole && config.encryptionKey && config.cronSecret && Object.values(db).every((v) => v === true) && Object.keys(db).length > 0;
  return NextResponse.json({ ok, config, db, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, env: process.env.VERCEL_ENV ?? "local" }, { status: ok ? 200 : 503 });
}
