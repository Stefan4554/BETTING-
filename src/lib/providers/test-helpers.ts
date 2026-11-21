import { z } from "zod";
import { CONNECTION_STATUS, ProviderError } from "./http";
import type { TestCheck, TestResult } from "./types";

/** Turn any failure into a stored, classified test result. Never reports success. */
export function failedTest(e: unknown, checks: TestCheck[], started: number): TestResult {
  const testedAt = new Date().toISOString();
  if (e instanceof z.ZodError) {
    const msg = `Unexpected response structure: ${e.issues.slice(0, 2).map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`;
    return { ok: false, status: "invalid_response", message: msg, checks: [...checks, { name: "Response schema", ok: false, detail: msg }], latencyMs: Date.now() - started, testedAt, reachedProvider: true };
  }
  const pe = e instanceof ProviderError ? e : new ProviderError((e as Error).message, "?", undefined, false, "http");
  const human: Record<string, string> = {
    auth: "Authentication failed: the API key is invalid, expired or not authorised for this endpoint.",
    rate_limit: "Rate limit or usage quota exceeded at the provider.",
    outage: "The provider is unavailable (server error) after retries.",
    timeout: "Connection timed out. The integration could NOT be verified.",
    network: "Provider unreachable from this server (DNS/network/firewall). The integration could NOT be verified.",
    malformed: "The provider returned a malformed response.",
    http: "The provider rejected the request.",
  };
  const reached = pe.kind !== "network" && pe.kind !== "timeout";
  return {
    ok: false, status: CONNECTION_STATUS[pe.kind], message: `${human[pe.kind]} (${pe.message})`, latencyMs: Date.now() - started, testedAt, reachedProvider: reached,
    checks: [...checks, { name: reached ? "Provider response" : "Network reachability", ok: false, detail: pe.message }],
  };
}
