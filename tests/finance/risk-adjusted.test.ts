import { describe, expect, it } from "vitest";
import { riskAdjusted } from "@/lib/finance/risk-adjusted";
import type { BetRecord } from "@/lib/finance/metrics";

let n = 0;
const settled = (day: string, profit: number, stake = 100): BetRecord => ({
  id: `b${++n}`, ref: n, placedAt: `${day}T10:00:00Z`, settledAt: `${day}T12:00:00Z`, status: profit > 0 ? "won" : profit < 0 ? "lost" : "void", side: "back", kind: "single",
  odds: 2, stake, liability: stake, profit, estProbability: null, openingOdds: null, closingOdds: null, isLive: false, sport: "F", league: null, bookmaker: null,
  strategy: null, market: "M", marketCategory: null, eventName: "E", eventId: null, correlationGroup: null, bankrollId: "b", tags: [],
});
const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

/** Deterministic pattern: alternating +20 / −10 every day for `days` days. */
const pattern = (days: number) => Array.from({ length: days }, (_, i) => settled(day(i), i % 2 ? -10 : 20));

describe("daily return series", () => {
  it("returns = daily P/L ÷ equity at start of day, zero-filled calendar days", () => {
    const r = riskAdjusted([settled(day(0), 100), settled(day(3), -50)], { capital: 1000 });
    expect(r.series.map((x) => [x.day, x.pnl, x.equityStart])).toEqual([[day(0), 100, 1000], [day(1), 0, 1100], [day(2), 0, 1100], [day(3), -50, 1100]]);
    expect(r.series[0]!.ret).toBeCloseTo(0.1, 12);
    expect(r.series[3]!.ret).toBeCloseTo(-50 / 1100, 12);
  });
  it("several bets on one local day are one observation", () => {
    const r = riskAdjusted([settled(day(0), 10), settled(day(0), -4)], { capital: 100 });
    expect(r.series).toHaveLength(1);
    expect(r.series[0]!.pnl).toBe(6);
  });
});

describe("Sharpe & Sortino", () => {
  const bets = pattern(120);
  const r = riskAdjusted(bets, { capital: 1000 });
  const rets = r.series.map((x) => x.ret);
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, x) => a + (x - m) ** 2, 0) / (rets.length - 1));
  const dd = Math.sqrt(rets.reduce((a, x) => a + Math.min(0, x) ** 2, 0) / rets.length);
  it("daily Sharpe = mean / sample sd (rf = 0)", () => expect(r.daily.sharpe.value).toBeCloseTo(m / sd, 10));
  it("annualised Sharpe = daily × √365", () => expect(r.annualized.sharpe.value).toBeCloseTo((m / sd) * Math.sqrt(365), 10));
  it("daily Sortino = mean / downside deviation (MAR 0)", () => expect(r.daily.sortino.value).toBeCloseTo(m / dd, 10));
  it("annualised Sortino = daily × √365", () => expect(r.annualized.sortino.value).toBeCloseTo((m / dd) * Math.sqrt(365), 10));
  it("risk-free rate and MAR are converted per period and subtracted", () => {
    const x = riskAdjusted(bets, { capital: 1000, riskFreeAnnual: 0.04, marAnnual: 0.04 });
    const rf = 1.04 ** (1 / 365) - 1;
    const ex = rets.map((v) => v - rf);
    const mex = ex.reduce((a, b) => a + b, 0) / ex.length;
    const sdex = Math.sqrt(ex.reduce((a, v) => a + (v - mex) ** 2, 0) / (ex.length - 1));
    expect(x.daily.sharpe.value).toBeCloseTo(mex / sdex, 10);
    expect(x.daily.sharpe.value!).toBeLessThan(r.daily.sharpe.value!);
    expect(x.assumptions.riskFreePerPeriod).toBeCloseTo(rf, 15);
  });
  it("252-day convention annualises with √252", () => {
    const x = riskAdjusted(bets, { capital: 1000, periodsPerYear: 252 });
    expect(x.annualized.factor).toBeCloseTo(Math.sqrt(252), 12);
    expect(x.series.every((s) => { const d = new Date(s.day + "T00:00:00Z").getUTCDay(); return d !== 0 && d !== 6; })).toBe(true);
    expect(x.series.reduce((a, s) => a + s.pnl, 0)).toBeCloseTo(bets.reduce((a, b) => a + (b.profit ?? 0), 0), 6); // weekend P/L rolled forward, not lost
  });
  it("per-bet ratios use profit ÷ stake", () => {
    const rb = bets.map((b) => b.profit! / b.stake);
    const mb = rb.reduce((a, b) => a + b, 0) / rb.length;
    const sb = Math.sqrt(rb.reduce((a, v) => a + (v - mb) ** 2, 0) / (rb.length - 1));
    expect(r.perBet.sharpe.value).toBeCloseTo(mb / sb, 10);
  });
});

describe("insufficient or degenerate samples are not displayed", () => {
  it("too few days: daily and annualised withheld with a reason", () => {
    const r = riskAdjusted(pattern(10), { capital: 1000 });
    expect(r.daily.sharpe).toMatchObject({ value: null });
    expect(r.daily.sharpe.reason).toMatch(/≥ 30 daily observations/);
    expect(r.annualized.sharpe.value).toBeNull();
    expect(r.perBet.sharpe.reason).toMatch(/≥ 30 settled bets/);
  });
  it("enough for daily but not for annualising", () => {
    const r = riskAdjusted(pattern(45), { capital: 1000 });
    expect(r.daily.sharpe.value).not.toBeNull();
    expect(r.annualized.sharpe.reason).toMatch(/≥ 90 days/);
  });
  it("sparse activity (few active days over a long span)", () => {
    const sparse = Array.from({ length: 25 }, (_, i) => settled(day(i * 15), i % 2 ? -10 : 20));
    const r = riskAdjusted(sparse, { capital: 1000 });
    expect(r.daily.observations).toBe(361);
    expect(r.daily.activeDays).toBe(25);
    expect(r.daily.sharpe.value).not.toBeNull();
    expect(r.annualized.sharpe.reason).toMatch(/too sparse/);
  });
  it("zero volatility", () => {
    const flat = Array.from({ length: 40 }, (_, i) => settled(day(i), 0));
    const r = riskAdjusted(flat, { capital: 1000, minActiveDays: 0 });
    expect(r.daily.sharpe.reason).toBe("zero volatility");
  });
  it("no losses → Sortino undefined (downside deviation 0)", () => {
    const wins = Array.from({ length: 40 }, (_, i) => settled(day(i), 10 + (i % 3)));
    const r = riskAdjusted(wins, { capital: 1000 });
    expect(r.daily.sortino.value).toBeNull();
    expect(r.daily.sortino.reason).toMatch(/downside deviation 0/);
    expect(r.daily.sharpe.value).not.toBeNull();
  });
  it("no capital base / equity wiped out", () => {
    expect(riskAdjusted(pattern(40), { capital: 0 }).daily.sharpe.reason).toMatch(/no capital base/);
    const wipe = [settled(day(0), -1000), ...pattern(40).map((b, i) => ({ ...b, settledAt: `${day(i + 1)}T12:00:00Z` }))];
    expect(riskAdjusted(wipe, { capital: 1000 }).daily.sharpe.reason).toMatch(/equity fell/);
  });
  it("time zone decides the day of late-evening settlements", () => {
    const b = { ...settled(day(0), 10), settledAt: `${day(0)}T23:30:00Z` };
    expect(riskAdjusted([b], { capital: 100, timeZone: "UTC" }).series[0]!.day).toBe(day(0));
    expect(riskAdjusted([b], { capital: 100, timeZone: "Europe/Ljubljana" }).series[0]!.day).toBe(day(1));
  });
});
