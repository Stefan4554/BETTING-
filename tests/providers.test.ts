import { beforeEach, describe, expect, it } from "vitest";
import { normalizeEvent, sportFromKey, theOddsApi, EventSchema } from "@/lib/providers/the-odds-api";
import { apiFootball, normalizeOdds } from "@/lib/providers/api-football";
import { clearProviderCache, redact, requestJson } from "@/lib/providers/http";

const toaEvent = {
  id: "e1", sport_key: "soccer_epl", sport_title: "EPL", commence_time: "2026-11-21T15:00:00Z", home_team: "Arsenal", away_team: "Chelsea",
  bookmakers: [
    { key: "pinnacle", title: "Pinnacle", last_update: "2026-11-20T10:00:00Z", markets: [
      { key: "h2h", outcomes: [{ name: "Arsenal", price: 2.1 }, { name: "Chelsea", price: 3.6 }, { name: "Draw", price: 3.4 }] },
      { key: "totals", outcomes: [{ name: "Over", price: 1.95, point: 2.5 }, { name: "Under", price: 1.9, point: 2.5 }] },
      { key: "spreads", outcomes: [{ name: "Arsenal", price: 1.92, point: -0.5 }, { name: "Chelsea", price: 1.98, point: 0.5 }] },
    ] },
    { key: "unibet_eu", title: "Unibet", last_update: "2026-11-20T10:05:00Z", markets: [{ key: "h2h", outcomes: [{ name: "Arsenal", price: 2.05 }, { name: "Chelsea", price: 3.7 }, { name: "Draw", price: 1 }] }] },
  ],
};

function mockFetch(routes: Record<string, { status?: number; body: unknown; headers?: Record<string, string> }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response("not found", { status: 404 });
    const [, r] = hit;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
}

beforeEach(() => clearProviderCache());

describe("The Odds API adapter", () => {
  it("normalises events, markets and lines; drops invalid prices", () => {
    const e = normalizeEvent(EventSchema.parse(toaEvent), "football", "2026-11-20T12:00:00Z");
    expect(e).toMatchObject({ externalId: "e1", name: "Arsenal v Chelsea", sportKey: "football", isLive: false });
    const h2h = e.markets.find((m) => m.key === "h2h")!;
    expect(h2h.quotes).toHaveLength(5); // Unibet Draw @ 1.00 dropped
    const totals = e.markets.find((m) => m.key === "totals")!;
    expect(totals.line).toBe(2.5);
    const spreads = e.markets.find((m) => m.key === "spreads")!;
    expect(spreads.line).toBe(-0.5); // home perspective
    expect(spreads.quotes.find((q) => q.selection === "Chelsea")!.line).toBe(0.5);
  });
  it("marks started events as live", () => {
    expect(normalizeEvent(EventSchema.parse(toaEvent), "football", "2026-11-21T15:30:00Z").isLive).toBe(true);
  });
  it("maps sport keys", () => {
    expect(sportFromKey("soccer_epl")).toBe("football");
    expect(sportFromKey("americanfootball_nfl")).toBe("american_football");
    expect(sportFromKey("politics_us")).toBe("other");
  });
  it("fetchOdds() returns normalised events and quota", async () => {
    const f = mockFetch({
      "/odds": { body: [toaEvent], headers: { "x-requests-last": "3", "x-requests-remaining": "100" } },
      "/sports": { body: [{ key: "soccer_epl", group: "Soccer", title: "EPL", active: true }] },
    });
    const r = await theOddsApi.fetchOdds({ apiKey: "k", regions: "eu", markets: "h2h,totals", fetchImpl: f }, "soccer_epl");
    expect(r.events[0]!.sportKey).toBe("football");
    expect(r.quota).toMatchObject({ remaining: 100, lastCost: 3 });
  });
});

describe("API-Football adapter", () => {
  const fixture = { fixture: { id: 7, date: "2026-11-22T15:00:00+00:00", status: { short: "NS" } }, league: { id: 39, name: "Premier League", season: 2026 }, teams: { home: { name: "Leeds" }, away: { name: "Wolves" } } };
  const odds = { fixture: { id: 7, date: "2026-11-22T15:00:00+00:00" }, league: { id: 39, name: "Premier League" }, update: "2026-11-20T09:00:00+00:00", bookmakers: [{ id: 8, name: "Bet365", bets: [
    { id: 1, name: "Match Winner", values: [{ value: "Home", odd: "2.40" }, { value: "Draw", odd: "3.30" }, { value: "Away", odd: "3.00" }] },
    { id: 5, name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.90" }, { value: "Under 2.5", odd: "1.95" }] },
    { id: 4, name: "Asian Handicap", values: [{ value: "Home -0.25", odd: "1.95" }, { value: "Away +0.25", odd: "1.90" }] },
    { id: 99, name: "Corners 1x2", values: [{ value: "Home", odd: "2" }] },
  ] }] };
  it("normalises team names, totals and handicap lines", () => {
    const e = normalizeOdds(odds as never, fixture as never, "2026-11-20T10:00:00Z");
    expect(e.name).toBe("Leeds v Wolves");
    expect(e.markets.find((m) => m.key === "h2h")!.quotes.map((q) => q.selection)).toEqual(["Leeds", "Draw", "Wolves"]);
    expect(e.markets.find((m) => m.key === "totals")!.line).toBe(2.5);
    const ah = e.markets.filter((m) => m.key === "spreads");
    expect(ah).toHaveLength(1);
    expect(ah[0]!.line).toBe(-0.25);
    expect(ah[0]!.quotes.map((q) => [q.selection, q.line])).toEqual([["Leeds", -0.25], ["Wolves", 0.25]]);
    expect(e.markets.some((m) => m.name.includes("Corners"))).toBe(false); // unmapped markets skipped
  });
  it("surfaces auth errors returned with HTTP 200", async () => {
    const r = await apiFootball.test({ apiKey: "k", fetchImpl: mockFetch({ "/status": { body: { errors: { token: "Error/Missing application key" }, response: [] } } }) });
    expect(r).toMatchObject({ ok: false, status: "auth_error", reachedProvider: true });
    expect(r.message).toContain("Missing application key");
  });
  it("valid key returns plan and daily quota", async () => {
    const r = await apiFootball.test({ apiKey: "k", fetchImpl: mockFetch({ "/status": { body: { errors: [], response: { subscription: { plan: "Free" }, requests: { current: 12, limit_day: 100 } } } } }) });
    expect(r).toMatchObject({ ok: true, status: "ok", quota: { used: 12, remaining: 88 } });
  });
});

describe("HTTP layer", () => {
  it("redacts secrets in URLs", () => expect(redact("https://x/y?apiKey=SECRET&b=1")).toBe("https://x/y?apiKey=***&b=1"));
  it("retries 5xx then succeeds; caches", async () => {
    let n = 0;
    const f = (async () => (++n < 2 ? new Response("err", { status: 503 }) : new Response("[1]", { status: 200 }))) as unknown as typeof fetch;
    const r = await requestJson({ provider: "t", url: "https://example.test/a", fetchImpl: f, retries: 2, ttlMs: 60_000 });
    expect(r.data).toEqual([1]);
    expect(n).toBe(2);
    const again = await requestJson({ provider: "t", url: "https://example.test/a", fetchImpl: f });
    expect(again.cacheHit).toBe(true);
    expect(n).toBe(2);
  });
  it("does not retry 4xx", async () => {
    let n = 0;
    const f = (async () => { n++; return new Response("no", { status: 403 }); }) as unknown as typeof fetch;
    await expect(requestJson({ provider: "t", url: "https://example.test/b", fetchImpl: f, retries: 3 })).rejects.toThrow(/403/);
    expect(n).toBe(1);
  });
});

// ── Connection-test scenarios (transport mocked; the live check is scripts/live-odds-check.ts) ──
describe("The Odds API connection test scenarios", () => {
  const sportsBody = [{ key: "soccer_epl", group: "Soccer", title: "EPL", active: true }, { key: "politics", group: "Politics", title: "x", active: false }];
  it("valid key: verified, parsed, quota stored", async () => {
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: mockFetch({ "/sports": { body: sportsBody, headers: { "x-requests-remaining": "480", "x-requests-used": "20" } } }) });
    expect(r).toMatchObject({ ok: true, status: "ok", reachedProvider: true, quota: { remaining: 480, used: 20 }, sample: { sports: 2, activeSports: 1 } });
    expect(r.checks.map((c) => c.name)).toEqual(["Authenticated request", "Response schema", "Quota headers"]);
  });
  it("valid key + odds sample parses a real-shaped odds payload", async () => {
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: mockFetch({ "/odds": { body: [toaEvent], headers: { "x-requests-last": "2", "x-requests-remaining": "478" } }, "/sports": { body: sportsBody } }) }, { sampleSport: "soccer_epl" });
    expect(r.ok).toBe(true);
    expect(r.sample).toMatchObject({ oddsEvents: 1, bookmakers: 2 });
    expect(r.quota?.remaining).toBe(478);
  });
  it("invalid key (401): auth_error, not retried", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response(JSON.stringify({ message: "API key is not valid" }), { status: 401 }); }) as unknown as typeof fetch;
    const r = await theOddsApi.test({ apiKey: "bad", fetchImpl: f });
    expect(r).toMatchObject({ ok: false, status: "auth_error", reachedProvider: true });
    expect(r.message).toContain("API key is not valid");
    expect(calls).toBe(1);
  });
  it("exhausted quota reported as rate_limited even on 401", async () => {
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: mockFetch({ "/sports": { status: 401, body: { message: "Usage quota has been reached", error_code: "OUT_OF_USAGE_CREDITS" } } }) });
    expect(r.status).toBe("rate_limited");
  });
  it("rate limit (429): retried honouring Retry-After, then rate_limited", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "0.01" } }); }) as unknown as typeof fetch;
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: f });
    expect(r.status).toBe("rate_limited");
    expect(calls).toBe(2); // 1 retry for the test request
  });
  it("timeout: unreachable / not verified", async () => {
    const f = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: f, timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, status: "unreachable", reachedProvider: false });
    expect(r.message).toMatch(/timed out.*could NOT be verified|could NOT be verified.*timed out/s);
  });
  it("network failure (DNS/firewall): unreachable, never success", async () => {
    const f = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); }) as unknown as typeof fetch;
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: f });
    expect(r).toMatchObject({ ok: false, status: "unreachable", reachedProvider: false });
    expect(r.message).toContain("ENOTFOUND");
  });
  it("provider unavailable (503): retried, then outage", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("<html>Service Unavailable</html>", { status: 503 }); }) as unknown as typeof fetch;
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: f });
    expect(r.status).toBe("outage");
    expect(calls).toBe(2);
  });
  it("malformed response (HTML with 200): invalid_response", async () => {
    const f = (async () => new Response("<html>captive portal</html>", { status: 200 })) as unknown as typeof fetch;
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: f });
    expect(r.status).toBe("invalid_response");
  });
  it("unexpected JSON structure: invalid_response with the failing path", async () => {
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: mockFetch({ "/sports": { body: { data: "nope" } } }) });
    expect(r.status).toBe("invalid_response");
    expect(r.checks.at(-1)!.name).toBe("Response schema");
  });
  it("malformed odds payload during ingestion is a classified error", async () => {
    await expect(theOddsApi.fetchOdds({ apiKey: "k", fetchImpl: mockFetch({ "/odds": { body: [{ id: 1 }] }, "/sports": { body: sportsBody } }) }, "soccer_epl"))
      .rejects.toMatchObject({ kind: "malformed" });
  });
});
