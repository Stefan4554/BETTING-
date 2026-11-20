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
  it("test(): success reports quota from headers", async () => {
    const r = await theOddsApi.test({ apiKey: "k", fetchImpl: mockFetch({ "/sports": { body: [{ key: "soccer_epl", group: "Soccer", title: "EPL", active: true }], headers: { "x-requests-remaining": "480", "x-requests-used": "20" } } }) });
    expect(r.ok).toBe(true);
    expect(r.quota).toMatchObject({ remaining: 480, used: 20 });
  });
  it("test(): 401 is reported as an invalid key, not retried forever", async () => {
    const r = await theOddsApi.test({ apiKey: "bad", fetchImpl: mockFetch({ "/sports": { status: 401, body: { message: "bad key" } } }) });
    expect(r).toMatchObject({ ok: false, message: "Invalid API key (401)" });
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
  it("surfaces API errors returned with HTTP 200", async () => {
    const r = await apiFootball.test({ apiKey: "k", fetchImpl: mockFetch({ "/status": { body: { errors: { token: "Error/Missing application key" }, response: [] } } }) });
    expect(r).toMatchObject({ ok: false, message: "Error/Missing application key" });
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
