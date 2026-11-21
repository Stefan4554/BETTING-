import { describe, expect, it, beforeAll } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { decryptSecret, encryptSecret, last4 } from "@/lib/server/crypto";
import { buildDemoDataset } from "@/lib/demo/generator";

describe("API key encryption", () => {
  beforeAll(() => { process.env.API_KEY_ENCRYPTION_KEY = "11".repeat(32); resetEnvCache(); });
  it("round-trips and never stores plaintext", () => {
    const c = encryptSecret("my-secret-key-123");
    expect(c).not.toContain("my-secret");
    expect(decryptSecret(c)).toBe("my-secret-key-123");
    expect(encryptSecret("x")).not.toBe(encryptSecret("x")); // random IV
  });
  it("detects tampering", () => {
    const c = Buffer.from(encryptSecret("abcdefgh"), "base64");
    c[c.length - 1] = c[c.length - 1]! ^ 1;
    expect(() => decryptSecret(c.toString("base64"))).toThrow();
  });
  it("masks keys", () => expect(last4("abcdef1234")).toBe("1234"));
});

describe("demo dataset", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const d = buildDemoDataset(now);
  it("is deterministic", () => expect(JSON.stringify(buildDemoDataset(now))).toBe(JSON.stringify(d)));
  it("covers football, tennis, basketball, live & pre-match, singles & accumulators", () => {
    const sports = new Set(d.bets.map((b) => b.sport_key));
    expect([...sports]).toEqual(expect.arrayContaining(["football", "tennis", "basketball"]));
    expect(d.bets.some((b) => b.is_live)).toBe(true);
    expect(d.bets.some((b) => !b.is_live)).toBe(true);
    expect(d.bets.some((b) => Array.isArray(b.legs))).toBe(true);
    expect(d.bets.some((b) => b.status === "pending")).toBe(true);
    expect(new Set(d.bets.map((b) => b.bookmaker_key)).size).toBeGreaterThan(3);
    expect(d.trades.length).toBeGreaterThan(10);
  });
  it("uses only fictional names and labels simulated prices", () => {
    expect(d.events.every((e) => !/Arsenal|Chelsea|Real Madrid|Lakers/.test(String(e.name)))).toBe(true);
    expect(d.bets.filter((b) => b.closing_odds).every((b) => b.closing_source === "demo:simulated")).toBe(true);
  });
  it("simulated books keep a positive margin except the one deliberate price error", () => {
    let negative = 0;
    for (const e of d.events) for (const m of e.markets as { snapshots: { bookmaker: string; selection: string; odds: number; at: string }[] }[]) {
      const byBook = new Map<string, Map<string, number>>();
      for (const s of m.snapshots) { if (s.at !== m.snapshots.at(-1)!.at) continue; (byBook.get(s.bookmaker) ?? byBook.set(s.bookmaker, new Map()).get(s.bookmaker)!).set(s.selection, s.odds); }
      for (const [, sel] of byBook) if ([...sel.values()].reduce((a, o) => a + 1 / o, 0) < 1) negative++;
    }
    expect(negative).toBeLessThanOrEqual(1);
  });
});

import { DEMO_LEAGUES } from "@/lib/demo/generator";
import { groupBy, type BetRecord } from "@/lib/finance/metrics";

describe("demo leagues", () => {
  const d = buildDemoDataset(new Date("2026-11-20T12:00:00Z"));
  const singles = d.bets.filter((b) => !Array.isArray(b.legs));
  it("every single bet, event and trade has a league of its own sport", () => {
    for (const b of singles) expect(DEMO_LEAGUES[String(b.sport_key)], `${b.sport_key}`).toContain(b.league_name);
    for (const e of d.events) expect(DEMO_LEAGUES.football).toContain(e.league_name);
    for (const t of d.trades) expect(DEMO_LEAGUES[String(t.sport_key)]).toContain(t.league_name);
  });
  it("covers the required competitions", () => {
    const used = new Set(singles.map((b) => b.league_name));
    for (const l of ["English Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "UEFA Champions League", "UEFA Europa League", "Slovenian PrvaLiga",
      "NBA", "EuroLeague", "EuroCup", "NCAA", "ATP Tour", "WTA Tour", "Grand Slam", "Challenger Tour", "NHL", "KHL", "SHL"]) expect(used.has(l), l).toBe(true);
  });
  it("domestic fixtures pair clubs of the same league; a club never plays in two domestic leagues", () => {
    const clubLeague = new Map<string, string>();
    for (const b of singles.filter((x) => x.sport_key === "football" && !String(x.league_name).startsWith("UEFA"))) {
      for (const team of [b.home, b.away] as string[]) {
        const prev = clubLeague.get(team);
        expect(prev === undefined || prev === b.league_name, `${team}: ${prev} vs ${b.league_name}`).toBe(true);
        clubLeague.set(team, String(b.league_name));
      }
    }
  });
  it("league filtering and aggregation add up", () => {
    const recs = singles.filter((b) => b.status && b.status !== "pending").map((b, i) => ({
      id: String(i), placedAt: String(b.placed_at), settledAt: String(b.settled_at ?? b.placed_at), status: b.status as BetRecord["status"], side: "back", kind: "single",
      odds: Number(b.odds), stake: Number(b.stake), liability: Number(b.stake), profit: b.status === "won" ? Number(b.stake) * (Number(b.odds) - 1) : b.status === "lost" ? -Number(b.stake) : 0,
      estProbability: null, openingOdds: null, closingOdds: null, isLive: false, sport: String(b.sport_key), league: String(b.league_name), bookmaker: null, strategy: null,
      market: String(b.market), marketCategory: null, eventName: String(b.event_name), eventId: null, correlationGroup: null, bankrollId: "x", tags: [],
    } as BetRecord));
    const byLeague = groupBy(recs, (r) => r.league);
    expect(byLeague.reduce((a, g) => a + g.bets, 0)).toBe(recs.length);
    expect(byLeague.reduce((a, g) => a + g.profit, 0)).toBeCloseTo(recs.reduce((a, r) => a + (r.profit ?? 0), 0), 6);
    const nba = recs.filter((r) => r.sport === "basketball" && r.league === "NBA");
    expect(nba.every((r) => r.sport === "basketball")).toBe(true);
    expect(byLeague.find((g) => g.key === "NBA")!.bets).toBe(nba.length);
  });
});
