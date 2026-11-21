/**
 * Email outbox worker against a real Supabase stack (local: `npx supabase start`).
 * Only the outbound Resend HTTP call is mocked; queueing, preferences, dedupe, claiming,
 * retries and status transitions run in the database.
 *   SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_SERVICE_KEY=… npx vitest run tests/email.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { resetEnvCache } from "@/lib/env";
import { processEmailOutbox } from "@/lib/server/email-worker";

const url = process.env.SUPABASE_TEST_URL, key = process.env.SUPABASE_TEST_SERVICE_KEY;
const suite = url && key ? describe : describe.skip;

suite("email outbox (integration)", () => {
  let admin: ReturnType<typeof createClient<Database>>;
  let uid = "";
  let sends = 0;
  const resend = (status: number, body: unknown) => (async () => { sends++; return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  const alert = async (type: string, dedupe: string, isDemo = false) => {
    const { error } = await admin.from("alerts").insert({ user_id: uid, is_demo: isDemo, type, title: `T ${dedupe}`, body: "body", dedupe_key: dedupe });
    return error;
  };
  const outboxFor = async (dedupe: string) => (await admin.from("email_outbox").select("*").eq("user_id", uid).eq("dedupe_key", `alert:${dedupe}`)).data ?? [];

  beforeAll(async () => {
    admin = createClient<Database>(url!, key!, { auth: { persistSession: false } });
    process.env.RESEND_API_KEY = "re_test_key"; process.env.ALERTS_FROM_EMAIL = "Alerts <alerts@example.com>"; resetEnvCache();
    const { data, error } = await admin.auth.admin.createUser({ email: `email-it-${Date.now()}@example.com`, password: "password123", email_confirm: true });
    if (error) throw error;
    uid = data.user.id;
    await admin.from("user_settings").update({ notification_email: "notify@example.com",
      notification_prefs: { daily_loss: { in_app: true, email: true }, exposure: { in_app: true, email: false }, large_loss: { in_app: false, email: true } } }).eq("user_id", uid);
  });
  afterAll(async () => { if (uid) await admin.auth.admin.deleteUser(uid); });

  it("respects preferences: email only for opted-in types, never for demo", async () => {
    await alert("exposure", "p-1");
    await alert("daily_loss", "p-2");
    await alert("daily_loss", "p-3", true);
    expect(await outboxFor("p-1")).toHaveLength(0);
    expect(await outboxFor("p-2")).toHaveLength(1);
    expect(await outboxFor("p-3")).toHaveLength(0);
  });

  it("successful send → sent with provider id; delivered only via webhook", async () => {
    const [row] = await outboxFor("p-2");
    const r = await processEmailOutbox(admin, { only: row!.id, fetchImpl: resend(200, { id: "re_msg_1" }) });
    expect(r).toMatchObject({ claimed: 1, sent: 1 });
    const [after] = await outboxFor("p-2");
    expect(after).toMatchObject({ status: "sent", provider_message_id: "re_msg_1", to_email: "notify@example.com" });
    expect(after!.delivered_at).toBeNull();
    const { data: ev } = await admin.from("email_events").select("status").eq("outbox_id", row!.id);
    expect(ev!.map((e) => e.status)).toEqual(["sent"]);
  });

  it("transient failure → queued with a retry delay; permanent failure → failed", async () => {
    await alert("daily_loss", "f-1"); await alert("daily_loss", "f-2");
    const [a] = await outboxFor("f-1"); const [b] = await outboxFor("f-2");
    await processEmailOutbox(admin, { only: a!.id, fetchImpl: resend(503, { message: "unavailable" }) });
    await processEmailOutbox(admin, { only: b!.id, fetchImpl: resend(422, { message: "invalid to address" }) });
    const [a2] = await outboxFor("f-1"); const [b2] = await outboxFor("f-2");
    expect(a2).toMatchObject({ status: "queued", attempts: 1 });
    expect(Date.parse(a2!.next_attempt_at)).toBeGreaterThan(Date.now() + 30_000);
    expect(b2).toMatchObject({ status: "failed", attempts: 1 });
    expect(b2!.last_error).toContain("invalid to address");
    // not due yet → not re-sent
    expect((await processEmailOutbox(admin, { only: a!.id, fetchImpl: resend(200, { id: "x" }) })).claimed).toBe(0);
  });

  it("duplicate alerts produce one email; concurrent workers send it once", async () => {
    expect(await alert("daily_loss", "d-1")).toBeNull();
    expect(await alert("daily_loss", "d-1")).not.toBeNull();   // alerts dedupe constraint
    const rows = await outboxFor("d-1");
    expect(rows).toHaveLength(1);
    sends = 0;
    const f = resend(200, { id: "re_dup" });
    await Promise.all([processEmailOutbox(admin, { only: rows[0]!.id, fetchImpl: f }), processEmailOutbox(admin, { only: rows[0]!.id, fetchImpl: f })]);
    expect(sends).toBe(1);
  });

  it("email-only alert is hidden in-app but emailed", async () => {
    await alert("large_loss", "e-1");
    const { data } = await admin.from("alerts").select("in_app").eq("dedupe_key", "e-1").single();
    expect(data!.in_app).toBe(false);
    expect(await outboxFor("e-1")).toHaveLength(1);
  });

  it("unconfigured provider: test email fails with the reason, alert emails stay queued", async () => {
    process.env.RESEND_API_KEY = ""; resetEnvCache();
    const { data: t } = await admin.from("email_outbox").insert({ user_id: uid, kind: "test", to_email: "notify@example.com", subject: "test", dedupe_key: `test:${Date.now()}`, max_attempts: 1 }).select("id").single();
    await processEmailOutbox(admin, { only: t!.id });
    const { data: tr } = await admin.from("email_outbox").select("status, last_error").eq("id", t!.id).single();
    expect(tr).toMatchObject({ status: "failed" });
    expect(tr!.last_error).toContain("RESEND_API_KEY");
    await alert("daily_loss", "u-1");
    const [u] = await outboxFor("u-1");
    await processEmailOutbox(admin, { only: u!.id });
    const [u2] = await outboxFor("u-1");
    expect(u2).toMatchObject({ status: "queued", attempts: 0 });
    process.env.RESEND_API_KEY = "re_test_key"; resetEnvCache();
  });
});
