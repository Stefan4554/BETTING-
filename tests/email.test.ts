import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { nextRetryDelayMs, renderAlertEmail, sendViaResend, verifySvixSignature } from "@/lib/email";

const msg = { from: "Alerts <alerts@example.com>", to: "user@example.com", subject: "[Betting Edge Pro] Daily loss", text: "t", html: "<p>t</p>", idempotencyKey: "bep-1" };
const respond = (status: number, body: unknown) => (async (_u: unknown, init?: RequestInit) => {
  respond.last = init;
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}) as unknown as typeof fetch;
respond.last = undefined as RequestInit | undefined;

describe("Resend transport", () => {
  it("success returns the provider message id (status 'sent', not 'delivered')", async () => {
    const r = await sendViaResend("re_key", msg, respond(200, { id: "abc-123" }));
    expect(r).toEqual({ ok: true, providerMessageId: "abc-123", httpStatus: 200 });
    const init = respond.last!;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("bep-1");
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ["user@example.com"], subject: msg.subject });
  });
  it("invalid key / unverified domain: permanent failure", async () => {
    const r = await sendViaResend("bad", msg, respond(403, { name: "validation_error", message: "The example.com domain is not verified" }));
    expect(r).toMatchObject({ ok: false, retryable: false, httpStatus: 403 });
    expect((r as { error: string }).error).toContain("not verified");
  });
  it("rate limit and provider outage are retryable", async () => {
    expect(await sendViaResend("k", msg, respond(429, { message: "Too many requests" }))).toMatchObject({ ok: false, retryable: true });
    expect(await sendViaResend("k", msg, respond(503, "<html>down</html>"))).toMatchObject({ ok: false, retryable: true, httpStatus: 503 });
  });
  it("network failure and timeout are retryable", async () => {
    const boom = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }) as unknown as typeof fetch;
    expect(await sendViaResend("k", msg, boom)).toMatchObject({ ok: false, retryable: true, httpStatus: null, error: "Resend unreachable (ECONNREFUSED)" });
    const hang = ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))) as unknown as typeof fetch;
    expect(await sendViaResend("k", msg, hang, 20)).toMatchObject({ ok: false, retryable: true, error: "Resend request timed out after 20 ms" });
  });
  it("2xx without an id is not treated as sent", async () => {
    expect(await sendViaResend("k", msg, respond(200, {}))).toMatchObject({ ok: false });
  });
  it("retry schedule backs off and caps", () => {
    expect([1, 2, 3, 4, 9].map(nextRetryDelayMs)).toEqual([60_000, 300_000, 900_000, 3_600_000, 3_600_000]);
  });
});

describe("email rendering", () => {
  it("escapes user/provider content and links to the notification centre", () => {
    const r = renderAlertEmail("[Betting Edge Pro] <b>x</b>", 'Bet "A & B" <script>', "https://app.example.com/");
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("https://app.example.com/alerts");
    expect(r.text).toContain('Bet "A & B"');
  });
});

describe("Resend webhook signature (Svix)", () => {
  const secretBytes = Buffer.from("super-secret-webhook-key-123456");
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });
  const sign = (id: string, ts: string) => `v1,${createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64")}`;
  const now = 1_800_000_000;
  it("accepts a valid signature", async () => {
    expect(await verifySvixSignature(secret, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", String(now)) }, body, now)).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets and replays", async () => {
    const sig = sign("msg_1", String(now));
    expect(await verifySvixSignature(secret, { id: "msg_1", timestamp: String(now), signature: sig }, body + " ", now)).toBe(false);
    expect(await verifySvixSignature("whsec_" + Buffer.from("other").toString("base64"), { id: "msg_1", timestamp: String(now), signature: sig }, body, now)).toBe(false);
    expect(await verifySvixSignature(secret, { id: "msg_1", timestamp: String(now), signature: sig }, body, now + 3600)).toBe(false);
    expect(await verifySvixSignature(secret, { id: null, timestamp: String(now), signature: sig }, body, now)).toBe(false);
  });
});
