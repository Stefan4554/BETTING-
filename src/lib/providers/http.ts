/**
 * Shared HTTP layer for provider adapters:
 * timeouts, retries with exponential backoff + jitter, per-provider rate limiting,
 * in-memory TTL cache, usage tracking and API-key redaction in logs.
 */

/**
 * Failure classes, mapped to connection status in the UI:
 *   auth → auth_error · rate_limit → rate_limited · outage → outage (5xx) ·
 *   timeout / network → unreachable (connection could NOT be verified) ·
 *   malformed → invalid_response · http → error (other 4xx)
 */
export type ProviderErrorKind = "auth" | "rate_limit" | "outage" | "timeout" | "network" | "malformed" | "http";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
    readonly kind: ProviderErrorKind = "http",
    readonly body?: string,
  ) {
    super(message);
  }
}

export function classifyStatus(status: number, body = ""): ProviderErrorKind {
  if (status === 429 || /quota|usage.*(limit|credits)|rate.?limit|OUT_OF_USAGE/i.test(body)) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "outage";
  return "http";
}

export const CONNECTION_STATUS: Record<ProviderErrorKind, string> = {
  auth: "auth_error", rate_limit: "rate_limited", outage: "outage", timeout: "unreachable", network: "unreachable", malformed: "invalid_response", http: "error",
};

export interface UsageRecord {
  provider: string;
  endpoint: string;
  status: number | null;
  durationMs: number;
  cacheHit: boolean;
  costUnits: number | null;
  error: string | null;
  at: string;
}

type UsageSink = (r: UsageRecord) => void | Promise<void>;
const sinks: UsageSink[] = [];
export function onUsage(sink: UsageSink): () => void {
  sinks.push(sink);
  return () => { const i = sinks.indexOf(sink); if (i >= 0) sinks.splice(i, 1); };
}

/** In-process usage counters (per server instance) for the API Management page. */
export const usageStats = new Map<
  string,
  { requests: number; errors: number; cacheHits: number; lastRequestAt: string | null; lastError: string | null; quotaUsed: number | null; quotaRemaining: number | null }
>();

function track(r: UsageRecord, quota?: { used: number | null; remaining: number | null }) {
  const s = usageStats.get(r.provider) ?? { requests: 0, errors: 0, cacheHits: 0, lastRequestAt: null, lastError: null, quotaUsed: null, quotaRemaining: null };
  s.requests++;
  if (r.cacheHit) s.cacheHits++;
  if (r.error) {
    s.errors++;
    s.lastError = r.error;
  }
  s.lastRequestAt = r.at;
  if (quota?.used != null) s.quotaUsed = quota.used;
  if (quota?.remaining != null) s.quotaRemaining = quota.remaining;
  usageStats.set(r.provider, s);
  for (const sink of sinks) void Promise.resolve(sink(r)).catch(() => {});
}

/** Remove secrets from URLs before logging. */
export function redact(url: string): string {
  return url.replace(/([?&](api_?key|apikey|APIkey|key|token)=)[^&]+/gi, "$1***");
}

// --- rate limiter (token bucket per provider) -------------------------------
class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private readonly perMinute: number) {
    this.tokens = perMinute;
  }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.perMinute, this.tokens + ((now - this.last) / 60_000) * this.perMinute);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - this.tokens) * 60_000) / this.perMinute));
    }
  }
}
const buckets = new Map<string, TokenBucket>();

// --- cache ------------------------------------------------------------------
const cache = new Map<string, { at: number; ttl: number; value: unknown; headers: Record<string, string> }>();
export function clearProviderCache() {
  cache.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RequestOptions {
  provider: string;
  url: string;
  headers?: Record<string, string>;
  ttlMs?: number;
  rateLimitPerMinute?: number;
  retries?: number;
  timeoutMs?: number;
  /** Header that reports request cost (The Odds API: x-requests-last). */
  costHeader?: string;
  quotaHeaders?: { used?: string; remaining?: string };
  fetchImpl?: typeof fetch;
  /** Upper bound for a single Retry-After / backoff wait. */
  maxRetryWaitMs?: number;
}

export interface JsonResponse<T = unknown> {
  data: T;
  headers: Record<string, string>;
  cacheHit: boolean;
  fetchedAt: string;
}

export async function requestJson<T = unknown>(o: RequestOptions): Promise<JsonResponse<T>> {
  const key = `${o.provider}:${o.url}`;
  const ttl = o.ttlMs ?? 60_000;
  const hit = cache.get(key);
  const endpoint = redact(new URL(o.url).pathname);
  if (hit && Date.now() - hit.at < hit.ttl) {
    track({ provider: o.provider, endpoint, status: 200, durationMs: 0, cacheHit: true, costUnits: 0, error: null, at: new Date().toISOString() });
    return { data: hit.value as T, headers: hit.headers, cacheHit: true, fetchedAt: new Date(hit.at).toISOString() };
  }

  if (o.rateLimitPerMinute) {
    let b = buckets.get(o.provider);
    if (!b) buckets.set(o.provider, (b = new TokenBucket(o.rateLimitPerMinute)));
    await b.take();
  }

  const f = o.fetchImpl ?? fetch;
  const retries = o.retries ?? 3;
  let lastErr: ProviderError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 10_000);
    try {
      const res = await f(o.url, { headers: { accept: "application/json", ...o.headers }, signal: ctrl.signal, cache: "no-store" });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      const cost = o.costHeader ? Number(headers[o.costHeader]) : null;
      const quota = {
        used: o.quotaHeaders?.used && headers[o.quotaHeaders.used] ? Number(headers[o.quotaHeaders.used]) : null,
        remaining: o.quotaHeaders?.remaining && headers[o.quotaHeaders.remaining] ? Number(headers[o.quotaHeaders.remaining]) : null,
      };

      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300);
        const kind = classifyStatus(res.status, body);
        // 429 and 5xx are transient; auth errors and exhausted quotas are not retried.
        const retryable = res.status === 429 || res.status >= 500;
        const detail = body.replace(/\s+/g, " ").replace(/apiKey=[^&\s"]+/gi, "apiKey=***").trim();
        const msg = `${o.provider} HTTP ${res.status}${res.statusText ? " " + res.statusText : ""} on ${endpoint}${detail ? ` — ${detail.slice(0, 160)}` : ""}`;
        track({ provider: o.provider, endpoint, status: res.status, durationMs: Date.now() - started, cacheHit: false, costUnits: cost, error: msg, at: new Date().toISOString() }, quota);
        lastErr = new ProviderError(msg, o.provider, res.status, retryable, kind, detail);
        if (!retryable || attempt === retries) throw lastErr;
        const retryAfter = Number(headers["retry-after"]);
        await sleep(Math.min(o.maxRetryWaitMs ?? 10_000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt)));
        continue;
      }

      const text = await res.text();
      let data: T;
      try { data = JSON.parse(text) as T; }
      catch {
        const msg = `${o.provider} returned a malformed (non-JSON) response on ${endpoint}: ${text.slice(0, 80).replace(/\s+/g, " ")}`;
        track({ provider: o.provider, endpoint, status: res.status, durationMs: Date.now() - started, cacheHit: false, costUnits: cost, error: msg, at: new Date().toISOString() }, quota);
        throw new ProviderError(msg, o.provider, res.status, false, "malformed");
      }
      track({ provider: o.provider, endpoint, status: res.status, durationMs: Date.now() - started, cacheHit: false, costUnits: cost, error: null, at: new Date().toISOString() }, quota);
      const at = Date.now();
      if (ttl > 0) cache.set(key, { at, ttl, value: data, headers });
      return { data, headers, cacheHit: false, fetchedAt: new Date(at).toISOString() };
    } catch (e) {
      if (e instanceof ProviderError && !e.retryable) throw e;
      if (e instanceof ProviderError && attempt === retries) throw e;
      if (!(e instanceof ProviderError)) {
        const timeout = (e as Error).name === "AbortError";
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        const msg = `${o.provider} ${timeout ? `timed out after ${o.timeoutMs ?? 10_000} ms` : `unreachable (${cause?.code ?? cause?.message ?? (e as Error).message})`} on ${endpoint}`;
        track({ provider: o.provider, endpoint, status: null, durationMs: Date.now() - started, cacheHit: false, costUnits: null, error: msg, at: new Date().toISOString() });
        lastErr = new ProviderError(msg, o.provider, undefined, true, timeout ? "timeout" : "network");
        if (attempt === retries) throw lastErr;
      }
      await sleep(backoff(attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new ProviderError("unreachable", o.provider, undefined, false, "network");
}

function backoff(attempt: number) {
  return Math.min(8000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
}
