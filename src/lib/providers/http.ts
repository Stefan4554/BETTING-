/**
 * Shared HTTP layer for provider adapters:
 * timeouts, retries with exponential backoff + jitter, per-provider rate limiting,
 * in-memory TTL cache, usage tracking and API-key redaction in logs.
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

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
export function onUsage(sink: UsageSink) {
  sinks.push(sink);
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
        const retryable = res.status === 429 || res.status >= 500;
        const msg = `${o.provider} ${res.status} ${res.statusText} on ${endpoint}`;
        track({ provider: o.provider, endpoint, status: res.status, durationMs: Date.now() - started, cacheHit: false, costUnits: cost, error: msg, at: new Date().toISOString() }, quota);
        lastErr = new ProviderError(msg, o.provider, res.status, retryable);
        if (!retryable || attempt === retries) throw lastErr;
        const retryAfter = Number(headers["retry-after"]);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        continue;
      }

      const data = (await res.json()) as T;
      track({ provider: o.provider, endpoint, status: res.status, durationMs: Date.now() - started, cacheHit: false, costUnits: cost, error: null, at: new Date().toISOString() }, quota);
      const at = Date.now();
      cache.set(key, { at, ttl, value: data, headers });
      return { data, headers, cacheHit: false, fetchedAt: new Date(at).toISOString() };
    } catch (e) {
      if (e instanceof ProviderError && !e.retryable) throw e;
      if (e instanceof ProviderError && attempt === retries) throw e;
      if (!(e instanceof ProviderError)) {
        const msg = `${o.provider} network error on ${endpoint}: ${(e as Error).name === "AbortError" ? "timeout" : (e as Error).message}`;
        track({ provider: o.provider, endpoint, status: null, durationMs: Date.now() - started, cacheHit: false, costUnits: null, error: msg, at: new Date().toISOString() });
        lastErr = new ProviderError(msg, o.provider, undefined, true);
        if (attempt === retries) throw lastErr;
      }
      await sleep(backoff(attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new ProviderError("unreachable", o.provider);
}

function backoff(attempt: number) {
  return Math.min(8000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
}
