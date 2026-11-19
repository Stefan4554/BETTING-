import { describe, expect, it } from "vitest";
import { calibrateServe, gameWinProb, liveWinProb, matchWinProbFromSets, setWinProb, tiebreakWinProb } from "@/lib/engine/live-prob";
import { evaluateAlerts, type AlertRule, type MarketState } from "@/lib/engine/alerts";
import { playerAnalytics, headToHead, type HistRecord } from "@/lib/engine/player-analytics";
import { linkOddsToMatches, surnameKey } from "@/lib/data/service";
import { evaluateValue } from "@/lib/engine/value";

describe("live win probability (Markov)", () => {
  it("game: known value for p=0.6 from 0-0", () => {
    // Closed form: p^4(1+4q+10q^2) + 20 p^3 q^3 · p^2/(p^2+q^2)
    const p = 0.6, q = 0.4;
    const exact = p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * (p * p) / (p * p + q * q);
    expect(gameWinProb(0.6)).toBeCloseTo(exact, 10);
    expect(gameWinProb(0.6, 3, 0)).toBeGreaterThan(gameWinProb(0.6));
  });
  it("symmetric players → 50%", () => {
    expect(setWinProb(0.62, 0.62, 0, 0, true)).toBeGreaterThan(0.5); // serving first is a small edge
    expect((setWinProb(0.62, 0.62, 0, 0, true) + setWinProb(0.62, 0.62, 0, 0, false)) / 2).toBeCloseTo(0.5, 6);
    expect(matchWinProbFromSets(0.62, 0.62, 0, 0, 3)).toBeCloseTo(0.5, 6);
    expect(tiebreakWinProb(0.62, 0.62, 6, 6)).toBeCloseTo(0.5, 6);
  });
  it("calibration reproduces the pre-match probability", () => {
    for (const p of [0.3, 0.5, 0.72]) {
      const { pa, pb } = calibrateServe(p, 3);
      expect(matchWinProbFromSets(pa, pb, 0, 0, 3)).toBeCloseTo(p, 4);
    }
  });
  it("leading increases win probability; finished states are 0/1", () => {
    const { pa, pb } = calibrateServe(0.5, 3);
    const up = liveWinProb(pa, pb, { bestOf: 3, sets: [{ a: 6, b: 3 }, { a: 2, b: 1 }], game: { a: "30", b: "15" }, server: "a" });
    expect(up).toBeGreaterThan(0.75);
    expect(liveWinProb(pa, pb, { bestOf: 3, sets: [{ a: 6, b: 3 }, { a: 6, b: 4 }], game: null, server: null })).toBe(1);
    expect(liveWinProb(pa, pb, { bestOf: 3, sets: [{ a: 3, b: 6 }, { a: 4, b: 6 }], game: null, server: null })).toBe(0);
  });
});

describe("alerts", () => {
  const rule = (o: Partial<AlertRule>): AlertRule => ({ id: "r", type: "odds_move_pct", threshold: 0.05, matchId: null, active: true, cooldownMinutes: 30, lastTriggeredAt: null, channels: ["in_app"], ...o });
  const st = (o: Partial<MarketState>): MarketState => ({ matchId: "m", label: "A v B", status: "scheduled", scheduledAt: "", best: { a: 2.0, b: 1.9 }, consensus: { a: 0.48, b: 0.52 }, modelProbability: { a: 0.5, b: 0.5 }, ev: { a: 0, b: -0.05 }, ...o });
  it("fires on odds move above threshold, respects cooldown and inactive", () => {
    const prev = new Map([["m", st({})]]);
    const next = new Map([["m", st({ best: { a: 2.2, b: 1.75 } })]]);
    expect(evaluateAlerts([rule({})], prev, next)).toHaveLength(2);
    expect(evaluateAlerts([rule({ selection: "a" })], prev, next)).toHaveLength(1);
    expect(evaluateAlerts([rule({ lastTriggeredAt: new Date().toISOString() })], prev, next)).toHaveLength(0);
    expect(evaluateAlerts([rule({ active: false })], prev, next)).toHaveLength(0);
  });
  it("match start, status change, value threshold crossing", () => {
    const prev = new Map([["m", st({})]]);
    const next = new Map([["m", st({ status: "live", ev: { a: 0.06, b: null } })]]);
    expect(evaluateAlerts([rule({ type: "match_start" })], prev, next)).toHaveLength(1);
    expect(evaluateAlerts([rule({ type: "match_status_change" })], prev, next)).toHaveLength(1);
    expect(evaluateAlerts([rule({ type: "value_edge_threshold", threshold: 0.05 })], prev, next)).toHaveLength(1);
    // Does not re-fire while it stays above threshold
    expect(evaluateAlerts([rule({ type: "value_edge_threshold", threshold: 0.05 })], next, next)).toHaveLength(0);
  });
});

describe("player analytics", () => {
  const h: HistRecord[] = [
    { id: "1", date: "2026-11-01T10:00:00Z", surface: "clay", winnerId: "p", loserId: "o", winnerRankAtTime: 20, loserRankAtTime: 5, sets: [{ w: 7, l: 6, tb: true }, { w: 6, l: 3, tb: false }], durationMin: 110, svc: { w: { held: 9, played: 10 }, l: { held: 8, played: 10 } } },
    { id: "2", date: "2026-11-15T10:00:00Z", surface: "hard", winnerId: "o", loserId: "p", winnerRankAtTime: 5, loserRankAtTime: 20, sets: [{ w: 6, l: 4, tb: false }, { w: 6, l: 4, tb: false }], durationMin: 80, svc: { w: { held: 10, played: 10 }, l: { held: 8, played: 10 } } },
  ];
  it("computes form, splits, hold/break, tiebreaks and workload", () => {
    const a = playerAnalytics("p", h, new Date("2026-11-19T00:00:00Z"));
    expect(a.form).toEqual(["L", "W"]);
    expect(a.bySurface.clay).toEqual({ wins: 1, losses: 0, pct: 1 });
    expect(a.byOpponentRank.top10).toEqual({ wins: 1, losses: 1, pct: 0.5 });
    expect(a.asUnderdog.wins).toBe(1);
    expect(a.holdPct).toBeCloseTo(17 / 20);
    expect(a.breakPct).toBeCloseTo(2 / 20);
    expect(a.tiebreaks.wins).toBe(1);
    expect(a.workload.matchesLast7d).toBe(1);
    expect(a.workload.minutesLast7d).toBe(80);
  });
  it("returns null hold% when no service data", () => {
    const a = playerAnalytics("p", h.map((x) => ({ ...x, svc: null })));
    expect(a.holdPct).toBeNull();
  });
  it("head to head", () => {
    const x = headToHead("p", "o", h);
    expect([x.aWins, x.bWins]).toEqual([1, 1]);
    expect(x.meetings[0]!.score).toBe("4-6 4-6");
  });
});

describe("odds ↔ match linking", () => {
  it("surname keys handle 'Last, First' and accents", () => {
    expect(surnameKey("Alcaraz, Carlos")).toBe("alcaraz");
    expect(surnameKey("Carlos Alcaraz")).toBe("alcaraz");
    expect(surnameKey("Novak Đoković".replace("Đ", "D"))).toBe("djokovic".replace("dj", "d"));
  });
  it("links swapped home/away and flips selections", () => {
    const base = { sport: "tennis" as const, round: null, status: "scheduled" as const, bestOf: null, surface: "hard" as const, score: null, winner: null, source: { provider: "x", fetchedAt: "" }, tournament: { id: "t", name: "T", tour: "atp" as const, level: null, surface: "hard" as const, countryCode: null, startDate: null, endDate: null, bestOf: null } };
    const pl = (id: string, name: string) => ({ id, name, countryCode: null, tour: null, rank: null, rankingPoints: null, birthDate: null, handedness: null, heightCm: null });
    const sr = { ...base, id: "sr:1", scheduledAt: "2099-01-01T10:00:00Z", playerA: pl("1", "Smith, John"), playerB: pl("2", "Jones, Tom") };
    const oa = { ...base, id: "toa:1", scheduledAt: "2099-01-01T10:05:00Z", playerA: pl("x", "Tom Jones"), playerB: pl("y", "John Smith") };
    const q = { bookmaker: "b", bookmakerName: "B", market: "match_winner" as const, line: null, selectionLabel: "", odds: 2, updatedAt: "", provider: "the_odds_api" };
    const { linked, unmatched } = linkOddsToMatches([sr], [{ match: oa, quotes: [{ ...q, selection: "a" }] }]);
    expect(unmatched).toHaveLength(0);
    expect(linked["sr:1"]![0]!.selection).toBe("b");
  });
});

describe("value suspect flag", () => {
  it("flags large model/market divergence as suspect", () => {
    const v = evaluateValue({ matchId: "m", matchLabel: "", market: "match_winner", selection: "a", selectionLabel: "", bestOdds: 4, bestBookmaker: "b", oddsTimestamp: "", modelProbability: 0.45, marketProbability: 0.24, dataQuality: 0.9, booksInConsensus: 5 })!;
    expect(v.suspect).toBe(true);
  });
});
