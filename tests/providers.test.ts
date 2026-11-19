import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearProviderCache, ProviderError, redact, requestJson, usageStats } from "@/lib/providers/http";
import { TheOddsApi } from "@/lib/providers/the-odds-api";
import { SportradarTennis } from "@/lib/providers/sportradar-tennis";
import { ApiTennis } from "@/lib/providers/api-tennis";
import { statusFromApiTennis, statusFromSportradar, surfaceFrom } from "@/lib/providers/normalize";

/**
 * Fixtures below follow each provider's documented response shape. They are test inputs
 * for the normalization layer only — never shown in the app.
 */
const oddsSports = [
  { key: "tennis_atp_paris", group: "Tennis", title: "ATP Paris Masters", description: "Men's Singles", active: true, has_outrights: false },
  { key: "soccer_epl", group: "Soccer", title: "EPL", description: "", active: true, has_outrights: false },
];
const oddsEvents = [
  {
    id: "evt1", sport_key: "tennis_atp_paris", sport_title: "ATP Paris Masters", commence_time: "2099-11-19T14:00:00Z",
    home_team: "Player One", away_team: "Player Two",
    bookmakers: [
      {
        key: "pinnacle", title: "Pinnacle", last_update: "2099-11-19T12:00:00Z",
        markets: [
          { key: "h2h", last_update: "2099-11-19T12:00:00Z", outcomes: [{ name: "Player One", price: 1.65 }, { name: "Player Two", price: 2.35 }] },
          { key: "totals", last_update: "2099-11-19T12:00:00Z", outcomes: [{ name: "Over", price: 1.9, point: 22.5 }, { name: "Under", price: 1.9, point: 22.5 }] },
          { key: "spreads", last_update: "2099-11-19T12:00:00Z", outcomes: [{ name: "Player One", price: 1.95, point: -2.5 }, { name: "Player Two", price: 1.85, point: 2.5 }] },
        ],
      },
    ],
  },
];

function mockFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const [frag, fn] of Object.entries(routes)) if (url.includes(frag)) return fn();
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  clearProviderCache();
  usageStats.clear();
});

describe("http layer", () => {
  it("redacts keys", () => {
    expect(redact("https://x/y?apiKey=SECRET&a=1")).toBe("https://x/y?apiKey=***&a=1");
    expect(redact("https://x/?method=m&APIkey=SECRET")).toBe("https://x/?method=m&APIkey=***");
  });
  it("retries 5xx then succeeds, caches the result", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n < 2 ? new Response("boom", { status: 503 }) : json({ ok: true }))) as unknown as typeof fetch;
    const r = await requestJson({ provider: "t", url: "https://x.test/a", fetchImpl: f, retries: 2 });
    expect(r.data).toEqual({ ok: true });
    expect(n).toBe(2);
    const again = await requestJson({ provider: "t", url: "https://x.test/a", fetchImpl: f });
    expect(again.cacheHit).toBe(true);
    expect(n).toBe(2);
    expect(usageStats.get("t")!.errors).toBe(1);
  });
  it("does not retry 401", async () => {
    const f = vi.fn(async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    await expect(requestJson({ provider: "t", url: "https://x.test/b", fetchImpl: f, retries: 3 })).rejects.toBeInstanceOf(ProviderError);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("The Odds API", () => {
  it("lists tennis sports, normalizes markets and tracks quota", async () => {
    const f = mockFetch({
      "/v4/sports/tennis_atp_paris/odds": () => json(oddsEvents, { "x-requests-used": "12", "x-requests-remaining": "488", "x-requests-last": "3" }),
      "/v4/sports": () => json(oddsSports),
    });
    const api = new TheOddsApi({ apiKey: "k", regions: "eu", markets: "h2h,spreads,totals", fetchImpl: f });
    const res = await api.tennisOdds();
    expect(res).toHaveLength(1);
    const { match, quotes } = res[0]!;
    expect(match.playerA.name).toBe("Player One");
    expect(match.playerA.rank).toBeNull(); // never invented
    expect(match.status).toBe("scheduled");
    expect(quotes.filter((q) => q.market === "match_winner").map((q) => [q.selection, q.odds])).toEqual([["a", 1.65], ["b", 2.35]]);
    expect(quotes.find((q) => q.market === "total_games" && q.selection === "over")!.line).toBe(22.5);
    expect(quotes.find((q) => q.market === "game_handicap" && q.selection === "a")!.line).toBe(-2.5);
    expect(usageStats.get("the_odds_api")!.quotaRemaining).toBe(488);
    expect(String((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]![0])).toContain("oddsFormat=decimal");
  });
});

describe("Sportradar Tennis", () => {
  it("normalizes summaries with scores and stats; uses header auth", async () => {
    const body = {
      generated_at: "2099-11-19T12:00:00Z",
      summaries: [
        {
          sport_event: {
            id: "sr:sport_event:1", start_time: "2099-11-19T10:00:00Z",
            competitors: [
              { id: "sr:competitor:1", name: "One, Player", country_code: "ESP", qualifier: "home" },
              { id: "sr:competitor:2", name: "Two, Player", country_code: "ITA", qualifier: "away" },
            ],
            sport_event_context: { category: { id: "c", name: "ATP" }, competition: { id: "sr:competition:1", name: "ATP Finals", level: "atp_1000" }, round: { name: "final" }, mode: { best_of: 3 } },
            sport_event_conditions: { ground: { surface: "hardcourt_indoor" } },
          },
          sport_event_status: {
            status: "live", match_status: "2nd_set", period_scores: [{ home_score: 6, away_score: 4, number: 1 }, { home_score: 2, away_score: 3, number: 2 }],
            game_state: { home_score: 30, away_score: 15, serving: "away" },
          },
          statistics: { totals: { competitors: [{ id: "sr:competitor:1", statistics: { aces: 5, double_faults: 1, breakpoints_won: 2 } }, { id: "sr:competitor:2", statistics: { aces: 3 } }] } },
        },
      ],
    };
    const f = vi.fn(async () => json(body)) as unknown as typeof fetch;
    const sr = new SportradarTennis({ apiKey: "k", accessLevel: "trial", fetchImpl: f });
    const [res] = await sr.dailySummaries("2099-11-19");
    const init = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(res!.match.status).toBe("live");
    expect(res!.match.surface).toBe("indoor_hard");
    expect(res!.match.score!.sets).toHaveLength(2);
    expect(res!.match.score!.server).toBe("b");
    expect(res!.stats!.a.aces).toBe(5);
    expect(res!.stats!.b.doubleFaults).toBeNull(); // missing stays missing
  });
});

describe("API-Tennis", () => {
  it("normalizes fixtures", async () => {
    const body = {
      success: 1,
      result: [
        {
          event_key: 123, event_date: "2099-11-19", event_time: "12:30", event_first_player: "P. One", first_player_key: 1,
          event_second_player: "P. Two", second_player_key: 2, event_final_result: "1 - 0", event_game_result: "40 - 30",
          event_serve: "First Player", event_winner: null, event_status: "Set 2", event_type_type: "Atp Singles",
          tournament_name: "Paris", tournament_key: 9, tournament_round: "ATP Paris - 1/8-finals", event_live: "1",
          scores: [{ score_first: "6", score_second: "3", score_set: "1" }, { score_first: "2", score_second: "1", score_set: "2" }],
        },
      ],
    };
    const api = new ApiTennis({ apiKey: "k", fetchImpl: vi.fn(async () => json(body)) as unknown as typeof fetch });
    const [m] = await api.fixtures("2099-11-19", "2099-11-19");
    expect(m!.status).toBe("live");
    expect(m!.tournament.tour).toBe("atp");
    expect(m!.score!.game).toEqual({ a: "40", b: "30" });
    expect(m!.score!.server).toBe("a");
  });
});

describe("status & surface mapping", () => {
  it("maps statuses", () => {
    expect(statusFromSportradar("closed", "retired")).toBe("retired");
    expect(statusFromSportradar("not_started", null)).toBe("scheduled");
    expect(statusFromSportradar("weird", null)).toBe("unknown");
    expect(statusFromApiTennis("Finished", "0")).toBe("completed");
    expect(statusFromApiTennis("", "0")).toBe("scheduled");
  });
  it("maps surfaces", () => {
    expect(surfaceFrom("Red clay")).toBe("clay");
    expect(surfaceFrom(null)).toBe("unknown");
  });
});
