import "server-only";
import { env } from "./env";
import type { AlertEvent } from "./engine/alerts";

/** Optional email delivery via Resend (https://resend.com). No key → in-app only. */
export async function sendAlertEmail(to: string, events: AlertEvent[]): Promise<boolean> {
  const { RESEND_API_KEY, ALERTS_FROM_EMAIL } = env();
  if (!RESEND_API_KEY || !ALERTS_FROM_EMAIL) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: ALERTS_FROM_EMAIL,
      to,
      subject: `EDGE alerts: ${events[0]!.title}${events.length > 1 ? ` (+${events.length - 1})` : ""}`,
      html: events.map((e) => `<p><b>${esc(e.title)}</b><br/>${esc(e.body)}</p>`).join("") + "<p style='color:#888'>Analytics only — no outcome is guaranteed.</p>",
    }),
  });
  return res.ok;
}
