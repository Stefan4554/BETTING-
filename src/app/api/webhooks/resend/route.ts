import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifySvixSignature } from "@/lib/email";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Resend delivery webhooks (Svix-signed). Only provider-confirmed events change an email to
 * "delivered" / "bounced"; "sent" alone never implies delivery.
 */
export async function POST(req: NextRequest) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  const admin = supabaseAdmin();
  if (!secret || !admin) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  const body = await req.text();
  const ok = await verifySvixSignature(secret, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, body);
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  let evt: { type?: string; created_at?: string; data?: { email_id?: string; bounce?: { message?: string } } };
  try { evt = JSON.parse(body); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const id = evt.data?.email_id;
  if (!id || !evt.type) return NextResponse.json({ ok: true, ignored: true });
  const { data: row } = await admin.from("email_outbox").select("id, user_id, status").eq("provider_message_id", id).maybeSingle();
  if (!row) return NextResponse.json({ ok: true, unknown: true });
  const map: Record<string, { status?: "delivered" | "bounced" | "failed"; event: string }> = {
    "email.delivered": { status: "delivered", event: "delivered" },
    "email.bounced": { status: "bounced", event: "bounced" },
    "email.complained": { event: "complained" },
    "email.delivery_delayed": { event: "delivery_delayed" },
    "email.sent": { event: "provider_sent" },
    "email.failed": { status: "failed", event: "failed" },
  };
  const m = map[evt.type] ?? { event: evt.type };
  const at = evt.created_at ?? new Date().toISOString();
  if (m.status && row.status !== "delivered") {
    await admin.from("email_outbox").update({ status: m.status, ...(m.status === "delivered" ? { delivered_at: at } : { last_error: evt.data?.bounce?.message ?? evt.type }), updated_at: new Date().toISOString() }).eq("id", row.id);
  }
  await admin.from("email_events").insert({ outbox_id: row.id, user_id: row.user_id, status: m.event, detail: `webhook ${evt.type}` });
  return NextResponse.json({ ok: true });
}
