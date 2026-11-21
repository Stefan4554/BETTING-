"use server";
import { z } from "zod";
import { getContext } from "@/lib/server/context";
import { supabaseAdmin } from "@/lib/supabase/server";
import { emailConfigured, processEmailOutbox } from "@/lib/server/email-worker";
import { must, run } from "./util";
import { NOTIFICATION_TYPES } from "@/lib/notifications";

const prefsSchema = z.record(z.enum(NOTIFICATION_TYPES.map(([k]) => k) as [string, ...string[]]), z.object({ in_app: z.boolean(), email: z.boolean() }));

export async function saveNotificationSettings(input: { notification_email: string | null; prefs: Record<string, { in_app: boolean; email: boolean }> }) {
  return run(async () => {
    const ctx = await getContext();
    const email = input.notification_email?.trim() || null;
    if (email) z.string().email("Invalid email address").max(254).parse(email);
    must(await ctx.sb.from("user_settings").update({ notification_email: email, notification_prefs: prefsSchema.parse(input.prefs) as never }).eq("user_id", ctx.user.id));
    return true;
  });
}

/**
 * TEST EMAIL: queues a test message for the caller and delivers it immediately through the
 * provider. Returns the real outcome: sent (accepted by the provider) or failed — never
 * "delivered" (that is only set when the provider's webhook confirms delivery).
 */
export async function sendTestEmail() {
  return run(async () => {
    const ctx = await getContext();
    const admin = supabaseAdmin();
    if (!admin) throw new Error("VALIDATION: SUPABASE_SERVICE_ROLE_KEY is not configured on the server");
    const id = must(await ctx.sb.rpc("queue_test_email")) as string;
    const cfg = emailConfigured();
    await processEmailOutbox(admin, { only: id, limit: 1 });
    const { data: row, error } = await ctx.sb.from("email_outbox").select("id, status, to_email, last_error, provider_message_id").eq("id", id).single();
    if (error || !row) throw new Error(error?.message ?? "test email not found");
    return { ...row, configured: cfg.ok, missing: cfg.missing };
  });
}

export async function retryEmail(id: string) {
  return run(async () => {
    const ctx = await getContext();
    const admin = supabaseAdmin();
    if (!admin) throw new Error("VALIDATION: service role not configured");
    const { data: row } = await ctx.sb.from("email_outbox").select("id, status, attempts, max_attempts").eq("id", z.string().uuid().parse(id)).single();   // RLS: own only
    if (!row) throw new Error("NOT_FOUND: email not found");
    if (row.status !== "failed") throw new Error("VALIDATION: only failed emails can be retried");
    await admin.from("email_outbox").update({ status: "queued", next_attempt_at: new Date().toISOString(), max_attempts: row.attempts + 1 }).eq("id", row.id);
    return processEmailOutbox(admin, { only: row.id, limit: 1 });
  });
}
