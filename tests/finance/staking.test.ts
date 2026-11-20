import { describe, expect, it } from "vitest";
import { expectedValuePerUnit, fullKellyFraction, kellyTable, probabilityEdge, recommendStake } from "@/lib/finance/staking";

describe("Kelly", () => {
  it("f* = (b·p − q) / b", () => {
    // odds 2.5 (b = 1.5), p = 0.5: (0.75 − 0.5) / 1.5 = 1/6
    expect(fullKellyFraction(0.5, 2.5)).toBeCloseTo(1 / 6, 12);
    // even money, 55%: 0.1
    expect(fullKellyFraction(0.55, 2)).toBeCloseTo(0.1, 12);
  });
  it("never negative", () => {
    expect(fullKellyFraction(0.4, 2)).toBe(0);
    expect(fullKellyFraction(0.5, 2)).toBe(0);
  });
  it("rejects invalid inputs", () => {
    expect(() => fullKellyFraction(1, 2)).toThrow();
    expect(() => fullKellyFraction(0.5, 1)).toThrow();
    expect(() => fullKellyFraction(Number.NaN, 2)).toThrow();
  });
  it("table with fractions and expected profit", () => {
    const t = kellyTable(1000, 2.5, 0.5);
    expect(t.implied).toBeCloseTo(0.4, 12);
    expect(t.edge).toBeCloseTo(0.1, 12);
    expect(t.ev).toBeCloseTo(0.25, 12);
    expect(t.rows.map((r) => r.stake)).toEqual([166.66, 83.33, 41.66, 16.66]);
    expect(t.rows[1]!.expectedProfit).toBe(20.83);
  });
});

describe("EV & edge", () => {
  it("EV = p(odds − 1) − (1 − p)", () => {
    expect(expectedValuePerUnit(0.5, 2.5)).toBeCloseTo(0.25, 12);
    expect(expectedValuePerUnit(0.4, 2)).toBeCloseTo(-0.2, 12);
  });
  it("edge = p − 1/odds", () => expect(probabilityEdge(0.55, 2)).toBeCloseTo(0.05, 12));
});

describe("staking systems & limits", () => {
  const ctx = { bankroll: 1000, odds: 2.5, probability: 0.5 };
  it("flat", () => expect(recommendStake({ type: "flat", amount: 25 }, ctx).stake).toBe(25));
  it("percentage", () => expect(recommendStake({ type: "percentage", pct: 0.02 }, ctx).stake).toBe(20));
  it("units", () => expect(recommendStake({ type: "units", units: 3, unitSize: 10 }, ctx).stake).toBe(30));
  it("fixed profit", () => expect(recommendStake({ type: "custom", formula: "fixed_profit", target: 30 }, ctx).stake).toBe(20));
  it("fractional Kelly", () => expect(recommendStake({ type: "kelly", fraction: 0.25 }, ctx).stake).toBe(41.66));
  it("max stake cap", () => {
    const r = recommendStake({ type: "kelly", fraction: 1 }, ctx, { maxStake: 50 });
    expect(r.stake).toBe(50);
    expect(r.cappedBy).toContain("max_stake");
  });
  it("max % of bankroll cap", () => expect(recommendStake({ type: "kelly", fraction: 1 }, ctx, { maxStakePct: 0.05 }).stake).toBe(50));
  it("exposure headroom cap, never negative", () => {
    expect(recommendStake({ type: "flat", amount: 100 }, ctx, { maxExposureRemaining: 30 }).stake).toBe(30);
    expect(recommendStake({ type: "flat", amount: 100 }, ctx, { maxExposureRemaining: -10 }).stake).toBe(0);
  });
  it("negative edge recommends zero", () => {
    const r = recommendStake({ type: "kelly", fraction: 0.5 }, { bankroll: 1000, odds: 2, probability: 0.45 });
    expect(r.stake).toBe(0);
    expect(r.cappedBy).toContain("negative_edge");
  });
  it("Kelly requires a probability", () => expect(() => recommendStake({ type: "kelly", fraction: 0.5 }, { bankroll: 1, odds: 2 })).toThrow());
});
