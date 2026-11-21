import { describe, expect, it } from "vitest";
import { basisDate, inRange, localDateKey, periodKey, previousRange, resolveRange, tzOffsetMs, usesFallback, zonedMidnight } from "@/lib/finance/dates";
import { pnlByPeriod, type BetRecord } from "@/lib/finance/metrics";

const bet = (o: Partial<BetRecord>): BetRecord => ({
  id: "x", placedAt: "2026-03-10T10:00:00Z", settledAt: null, status: "pending", side: "back", kind: "single", odds: 2, stake: 10, liability: 10, profit: null,
  estProbability: null, openingOdds: null, closingOdds: null, isLive: false, sport: "Football", league: null, bookmaker: null, strategy: null, market: "M",
  marketCategory: null, eventName: "E", eventId: null, correlationGroup: null, bankrollId: "b", tags: [], ...o,
});

describe("date basis", () => {
  const b = bet({ placedAt: "2026-03-01T09:00:00Z", eventStart: "2026-03-05T19:00:00Z", settledAt: "2026-03-05T21:00:00Z", status: "won", profit: 10 });
  it("selects the right date per basis", () => {
    expect(basisDate(b, "placed")).toBe("2026-03-01T09:00:00Z");
    expect(basisDate(b, "event")).toBe("2026-03-05T19:00:00Z");
    expect(basisDate(b, "settled")).toBe("2026-03-05T21:00:00Z");
  });
  it("filters by placed vs event vs settlement", () => {
    const first = resolveRange("custom", new Date(), { from: "2026-03-01", to: "2026-03-01" }, "UTC", "placed");
    expect(inRange(b, first)).toBe(true);
    expect(inRange(b, { ...first, basis: "event" })).toBe(false);
    expect(inRange(b, resolveRange("custom", new Date(), { from: "2026-03-05", to: "2026-03-05" }, "UTC", "settled"))).toBe(true);
  });
  it("missing event date falls back to placement (and is flagged)", () => {
    const nb = bet({ placedAt: "2026-03-02T09:00:00Z" });
    expect(usesFallback(nb, "event")).toBe(true);
    expect(inRange(nb, resolveRange("custom", new Date(), { from: "2026-03-02", to: "2026-03-02" }, "UTC", "event"))).toBe(true);
  });
  it("pending bets have no settlement date: excluded from dated settlement ranges, kept in All time", () => {
    const p = bet({});
    expect(inRange(p, resolveRange("30d", new Date("2026-03-15T00:00:00Z"), undefined, "UTC", "settled"))).toBe(false);
    expect(inRange(p, resolveRange("all", new Date(), undefined, "UTC", "settled"))).toBe(true);
  });
  it("period grouping follows the basis", () => {
    const bets = [b, bet({ placedAt: "2026-03-01T10:00:00Z", eventStart: "2026-03-09T19:00:00Z", settledAt: "2026-03-09T21:00:00Z", status: "lost", profit: -10 })];
    expect(pnlByPeriod(bets, "day", { basis: "placed" }).map((r) => [r.period, r.profit])).toEqual([["2026-03-01", 0]]);
    expect(pnlByPeriod(bets, "day", { basis: "event" }).map((r) => r.period)).toEqual(["2026-03-05", "2026-03-09"]);
  });
});

describe("time-zone boundaries", () => {
  it("local midnight in Europe/Ljubljana (CET +1 winter, CEST +2 summer)", () => {
    expect(zonedMidnight(2026, 1, 15, "Europe/Ljubljana").toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(zonedMidnight(2026, 7, 15, "Europe/Ljubljana").toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(zonedMidnight(2026, 3, 1, "America/New_York").toISOString()).toBe("2026-03-01T05:00:00.000Z");
  });
  it("DST change days have correct boundaries (Europe 29 Mar 2026: 23-hour day)", () => {
    const r = resolveRange("custom", new Date(), { from: "2026-03-29", to: "2026-03-29" }, "Europe/Ljubljana");
    expect(r.from!.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(r.to!.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(tzOffsetMs(new Date("2026-03-29T12:00:00Z"), "Europe/Ljubljana")).toBe(7_200_000);
  });
  it("'Today' is the user's day: 23:30 UTC on 9 Mar is 10 Mar in Ljubljana", () => {
    const now = new Date("2026-03-09T23:30:00Z");
    const r = resolveRange("today", now, undefined, "Europe/Ljubljana");
    expect(r.from!.toISOString()).toBe("2026-03-09T23:00:00.000Z");
    expect(inRange(bet({ placedAt: "2026-03-09T23:10:00Z" }), r)).toBe(true);
    expect(inRange(bet({ placedAt: "2026-03-09T22:50:00Z" }), r)).toBe(false);
    expect(resolveRange("today", now, undefined, "UTC").from!.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
  it("presets: this month, last month (across a year boundary), this year", () => {
    const now = new Date("2026-01-20T12:00:00Z");
    expect(resolveRange("mtd", now, undefined, "UTC").from!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    const lm = resolveRange("last_month", now, undefined, "UTC");
    expect([lm.from!.toISOString(), lm.to!.toISOString()]).toEqual(["2025-12-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
    expect(resolveRange("ytd", now, undefined, "Europe/Ljubljana").from!.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });
  it("local day keys and ISO weeks use the user's zone", () => {
    expect(localDateKey("2026-03-09T23:30:00Z", "Europe/Ljubljana")).toBe("2026-03-10");
    expect(periodKey("2026-03-15T23:30:00Z", "week", "Europe/Ljubljana")).toBe("2026-03-16"); // Monday 16th locally
    expect(periodKey("2026-03-15T23:30:00Z", "week", "UTC")).toBe("2026-03-09");
  });
  it("previous range keeps basis and zone", () => {
    const r = resolveRange("7d", new Date("2026-03-15T12:00:00Z"), undefined, "Europe/Ljubljana", "event");
    expect(previousRange(r)).toMatchObject({ basis: "event", timeZone: "Europe/Ljubljana" });
  });
  it("invalid zones fall back to UTC instead of crashing", () => {
    expect(resolveRange("today", new Date("2026-03-09T12:00:00Z"), undefined, "Mars/Olympus").timeZone).toBe("UTC");
  });
});
