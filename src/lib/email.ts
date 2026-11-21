/**
 * Transactional email via Resend (https://resend.com/docs/api-reference/emails/send-email).
 * Server-only usage: the API key is read from env by callers and never reaches the browser.
 * Pure transport + rendering here so it can be unit-tested with a mocked fetch.
 */
export interface EmailMessage { from: string; to: string; subject: string; text: string; html: string; idempotencyKey?: string }
export type SendResult =
  | { ok: true; providerMessageId: string; httpStatus: number }
  | { ok: false; retryable: boolean; error: string; httpStatus: number | null };

export async function sendViaResend(apiKey: string, m: EmailMessage, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<SendResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(m.idempotencyKey ? { "idempotency-key": m.idempotencyKey } : {}) },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    const body = await res.text();
    let json: { id?: string; message?: string; name?: string } = {};
    try { json = JSON.parse(body); } catch { /* non-JSON error page */ }
    if (res.ok && json.id) return { ok: true, providerMessageId: json.id, httpStatus: res.status };
    if (res.ok) return { ok: false, retryable: true, error: "Provider accepted the request but returned no message id", httpStatus: res.status };
    // 429 (rate limit) and 5xx are transient; 4xx (bad key, unverified domain, invalid address) are not.
    return { ok: false, retryable: res.status === 429 || res.status >= 500, error: `Resend ${res.status}: ${json.message ?? body.slice(0, 200)}`, httpStatus: res.status };
  } catch (e) {
    const timeout = (e as Error).name === "AbortError";
    const code = (e as { cause?: { code?: string } }).cause?.code;
    return { ok: false, retryable: true, error: timeout ? `Resend request timed out after ${timeoutMs} ms` : `Resend unreachable (${code ?? (e as Error).message})`, httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderAlertEmail(subject: string, body: string | null, appUrl: string | null): { text: string; html: string } {
  const link = appUrl ? `${appUrl.replace(/\/$/, "")}/alerts` : null;
  const text = `${subject}\n\n${body ?? ""}\n\n${link ? `Open the notification centre: ${link}\n` : ""}You receive this because email notifications are enabled for this alert type in Betting Edge Pro → Settings → Notifications.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#0d0f12;color:#e2e6ec;padding:24px">
<div style="max-width:560px;margin:auto;background:#13161b;border:1px solid #2f3843;border-radius:4px;padding:20px">
<div style="font-size:11px;letter-spacing:.15em;color:#8a94a3">BETTING EDGE PRO</div>
<h1 style="font-size:17px;margin:8px 0 12px">${esc(subject.replace(/^\[Betting Edge Pro\]\s*/, ""))}</h1>
<p style="font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(body ?? "")}</p>
${link ? `<p><a href="${esc(link)}" style="color:#3987e5">Open the notification centre</a></p>` : ""}
<p style="font-size:11px;color:#5c6675">You receive this because email notifications are enabled for this alert type (Settings → Notifications).</p>
</div></body></html>`;
  return { text, html };
}

/** Retry schedule for transient failures: 1 min, 5 min, 15 min, 1 h. */
export function nextRetryDelayMs(attempt: number): number {
  return [60_000, 300_000, 900_000, 3_600_000][Math.min(Math.max(attempt - 1, 0), 3)]!;
}

/** Verify a Svix-signed webhook (Resend). secret: "whsec_<base64>"; header svix-signature: "v1,<base64> …". */
export async function verifySvixSignature(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false;   // replay window
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  return headers.signature.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
