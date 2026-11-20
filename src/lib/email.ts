import "server-only";
import { env } from "./env";

/**
 * Email delivery for alerts (prepared integration). Uses Resend when RESEND_API_KEY and
 * ALERTS_FROM_EMAIL are set; otherwise alerts stay in-app only and this returns false.
 */
export async function sendAlertEmail(to: string, alerts: { title: string; body: string | null }[]): Promise<boolean> {
  const { RESEND_API_KEY, ALERTS_FROM_EMAIL } = env();
  if (!RESEND_API_KEY || !ALERTS_FROM_EMAIL || !alerts.length) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: ALERTS_FROM_EMAIL, to,
      subject: `Betting Edge Pro: ${alerts[0]!.title}${alerts.length > 1 ? ` (+${alerts.length - 1})` : ""}`,
      html: alerts.map((a) => `<p><b>${esc(a.title)}</b><br/>${esc(a.body ?? "")}</p>`).join(""),
    }),
  });
  return res.ok;
}
