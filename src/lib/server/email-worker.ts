import "server-only";
import type { DB } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { nextRetryDelayMs, renderAlertEmail, sendViaResend } from "@/lib/email";

export interface WorkerResult { claimed: number; sent: number; retrying: number; failed: number; skipped: string | null }

export function emailConfigured(): { ok: boolean; missing: string[] } {
  const e = env();
  const missing = [!e.RESEND_API_KEY && "RESEND_API_KEY", !e.ALERTS_FROM_EMAIL && "ALERTS_FROM_EMAIL"].filter(Boolean) as string[];
  return { ok: missing.length === 0, missing };
}

/**
 * Deliver due outbox emails. Claims rows with SKIP LOCKED (no double sends across workers),
 * sends through Resend with an idempotency key, then records sent / retry / failed and an
 * email_events row per attempt. "sent" means the provider accepted the message; "delivered"
 * is set only by the provider webhook.
 */
export async function processEmailOutbox(admin: DB, opts: { limit?: number; only?: string; fetchImpl?: typeof fetch } = {}): Promise<WorkerResult> {
  const cfg = emailConfigured();
  const res: WorkerResult = { claimed: 0, sent: 0, retrying: 0, failed: 0, skipped: null };
  const e = env();
  const { data: rows, error } = await admin.rpc("claim_email_batch", { p_limit: opts.limit ?? 20, p_only: opts.only });
  if (error) throw new Error(error.message);
  res.claimed = rows?.length ?? 0;
  for (const row of rows ?? []) {
    const now = new Date().toISOString();
    if (!cfg.ok) {
      // Not configured: do not pretend. Fail permanently with a clear reason (test emails) or
      // keep alert emails queued for when the integration is configured.
      const terminal = row.kind === "test" || row.attempts >= row.max_attempts;
      const msg = `Email provider not configured on the server (missing ${cfg.missing.join(", ")})`;
      await admin.from("email_outbox").update({ status: terminal ? "failed" : "queued", last_error: msg, next_attempt_at: new Date(Date.now() + nextRetryDelayMs(row.attempts)).toISOString(), updated_at: now, attempts: terminal ? row.attempts : row.attempts - 1 }).eq("id", row.id);
      await admin.from("email_events").insert({ outbox_id: row.id, user_id: row.user_id, status: terminal ? "failed" : "deferred", detail: msg });
      if (terminal) res.failed++; else res.retrying++;
      res.skipped = msg;
      continue;
    }
    const { text, html } = renderAlertEmail(row.subject, row.body, process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null));
    const r = await sendViaResend(e.RESEND_API_KEY!, { from: e.ALERTS_FROM_EMAIL!, to: row.to_email, subject: row.subject, text, html, idempotencyKey: `bep-${row.id}` }, opts.fetchImpl);
    if (r.ok) {
      await admin.from("email_outbox").update({ status: "sent", provider: "resend", provider_message_id: r.providerMessageId, sent_at: now, last_error: null, updated_at: now }).eq("id", row.id);
      await admin.from("email_events").insert({ outbox_id: row.id, user_id: row.user_id, status: "sent", http_status: r.httpStatus, detail: `accepted by Resend, id ${r.providerMessageId}` });
      res.sent++;
    } else {
      const retry = r.retryable && row.attempts < row.max_attempts;
      await admin.from("email_outbox").update({ status: retry ? "queued" : "failed", last_error: r.error, updated_at: now,
        next_attempt_at: new Date(Date.now() + nextRetryDelayMs(row.attempts)).toISOString() }).eq("id", row.id);
      await admin.from("email_events").insert({ outbox_id: row.id, user_id: row.user_id, status: retry ? "retry_scheduled" : "failed", http_status: r.httpStatus, detail: r.error });
      if (retry) res.retrying++; else res.failed++;
    }
  }
  return res;
}
