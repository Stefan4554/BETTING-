import { describe, expect, it } from "vitest";
import {
  americanToDecimal, closingLineValue, decimalToAmerican, edgeProbability, expectedValue, fairOdds,
  impliedProbability, oddsMovementPct, OddsError, overround, removeVig,
} from "@/lib/engine/odds";
import { fractionalKelly, fullKelly, kellyStake, shrinkProbability } from "@/lib/engine/kelly";
import { marketConsensus, type BookPrice } from "@/lib/engine/consensus";
import { evaluateValue, findValue, DEFAULT_VALUE_SETTINGS, type ValueInput } from "@/lib/engine/value";
import { detectSteamMoves, direction, reverseLineMovement } from "@/lib/engine/movement";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("odds math", () => {
  it("implied probability = 1/odds", () => {
    expect(impliedProbability(2)).toBe(0.5);
    expect(impliedProbability(1.25)).toBeCloseTo(0.8);
  });
  it("rejects invalid odds and probabilities", () => {
    expect(() => impliedProbability(1)).toThrow(OddsError);
    expect(() => impliedProbability(0.5)).toThrow(OddsError);
    expect(() => impliedProbability(NaN)).toThrow(OddsError);
    expect(() => fairOdds(0)).toThrow(OddsError);
    expect(() => fairOdds(1)).toThrow(OddsError);
  });
  it("EV = p × odds − 1", () => {
    expect(expectedValue(0.55, 2.0)).toBeCloseTo(0.1);
    expect(expectedValue(0.4, 2.0)).toBeCloseTo(-0.2);
  });
  it("fair odds = 1/p", () => expect(fairOdds(0.4)).toBeCloseTo(2.5));
  it("edge in probability space", () => expect(edgeProbability(0.55, 2.0)).toBeCloseTo(0.05));
  it("overround", () => expect(overround([1.91, 1.91])).toBeCloseTo(0.04712, 4));
  it("odds movement %", () => {
    expect(oddsMovementPct(2.0, 1.8)).toBeCloseTo(-0.1);
    expect(direction(2.0, 1.8)).toBe("shortening");
    expect(direction(2.0, 2.2)).toBe("drifting");
    expect(direction(2.0, 2.01)).toBe("stable");
  });
  it("CLV", () => expect(closingLineValue(2.1, 2.0)).toBeCloseTo(0.05));
  it("american conversion round trips", () => {
    expect(americanToDecimal(150)).toBeCloseTo(2.5);
    expect(americanToDecimal(-200)).toBeCloseTo(1.5);
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(1.5)).toBe(-200);
  });
});

describe("de-vig", () => {
  const book = [1.5, 2.6];
  for (const m of ["multiplicative", "additive", "power", "shin"] as const) {
    it(`${m} sums to 1 and preserves favourite ordering`, () => {
      const p = removeVig(book, m);
      expect(sum(p)).toBeCloseTo(1, 9);
      expect(p[0]!).toBeGreaterThan(p[1]!);
      // Fair probabilities are never higher than the raw implied ones for every outcome.
      expect(p[0]!).toBeLessThan(1 / 1.5);
    });
  }
  it("multiplicative matches hand calculation", () => {
    const p = removeVig([1.91, 1.91]);
    expect(p[0]).toBeCloseTo(0.5);
  });
  it("power and shin shift more margin onto the longshot than multiplicative", () => {
    const mult = removeVig([1.2, 5.0], "multiplicative");
    const pow = removeVig([1.2, 5.0], "power");
    const shin = removeVig([1.2, 5.0], "shin");
    expect(pow[1]!).toBeLessThan(mult[1]!);
    expect(shin[1]!).toBeLessThan(mult[1]!);
  });
  it("shin handles 3-way markets", () => {
    const p = removeVig([2.2, 3.4, 3.5], "shin");
    expect(sum(p)).toBeCloseTo(1, 9);
  });
});

describe("Kelly", () => {
  it("full Kelly (b·p − q)/b", () => {
    expect(fullKelly(0.55, 2.0)).toBeCloseTo(0.1);
    expect(fullKelly(0.4, 2.0)).toBe(0); // negative edge → no bet
  });
  it("fractional + cap", () => {
    const r = fractionalKelly(0.6, 2.0, { fraction: 0.25, maxStakePct: 0.02 });
    expect(r.fullKelly).toBeCloseTo(0.2);
    expect(r.stakePct).toBe(0.02);
    expect(r.capped).toBe(true);
    expect(kellyStake(1000, r)).toBeCloseTo(20);
  });
  it("model confidence shrinks towards market", () => {
    expect(shrinkProbability(0.6, 0.5, 0.5)).toBeCloseTo(0.55);
    const r = fractionalKelly(0.6, 2.0, { fraction: 1, maxStakePct: 1, modelConfidence: 0, marketProbability: 0.5 });
    expect(r.stakePct).toBe(0);
  });
  it("validates params", () => {
    expect(() => fractionalKelly(0.6, 2, { fraction: 0, maxStakePct: 0.1 })).toThrow();
  });
});

describe("market consensus", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const books: BookPrice[] = [
    { bookmaker: "pinnacle", prices: { a: 1.8, b: 2.1 }, updatedAt: "2026-11-19T11:59:00Z", sharp: true },
    { bookmaker: "bet365", prices: { a: 1.75, b: 2.1 }, updatedAt: "2026-11-19T11:58:00Z" },
    { bookmaker: "stale", prices: { a: 3.0, b: 1.4 }, updatedAt: "2026-11-18T08:00:00Z" },
    { bookmaker: "partial", prices: { a: 1.9 }, updatedAt: "2026-11-19T11:59:00Z" },
  ];
  it("excludes stale and incomplete books, finds best price", () => {
    const c = marketConsensus(books, ["a", "b"], { now, maxAgeMs: 3600_000 })!;
    expect(c.booksUsed).toBe(2);
    expect(c.best.a).toEqual({ odds: 1.8, bookmaker: "pinnacle", updatedAt: "2026-11-19T11:59:00Z" });
    expect(c.probabilities.a! + c.probabilities.b!).toBeCloseTo(1);
  });
  it("returns null when nothing is usable", () => {
    expect(marketConsensus([], ["a", "b"])).toBeNull();
  });
});

describe("value engine", () => {
  const base: ValueInput = {
    matchId: "m1", matchLabel: "A v B", market: "match_winner", selection: "a", selectionLabel: "A",
    bestOdds: 2.2, bestBookmaker: "pinnacle", oddsTimestamp: "2026-11-19T12:00:00Z",
    modelProbability: 0.52, modelIntervalWidth: 0.1, marketProbability: 0.46, dataQuality: 0.9, booksInConsensus: 5,
  };
  it("computes EV, fair odds, edge", () => {
    const v = evaluateValue(base)!;
    expect(v.expectedValue).toBeCloseTo(0.144);
    expect(v.fairOdds).toBeCloseTo(1 / 0.52);
    expect(v.edgePct).toBeCloseTo(0.52 - 1 / 2.2);
    expect(v.confidence).toBe("high");
    expect(v.kellyStakePct).toBeGreaterThan(0);
  });
  it("never fabricates a probability", () => {
    expect(evaluateValue({ ...base, modelProbability: null })).toBeNull();
  });
  it("flags uncertainty instead of declaring profit", () => {
    const v = evaluateValue({ ...base, modelIntervalWidth: 0.3, dataQuality: 0.4, booksInConsensus: 1 })!;
    expect(v.confidence).toBe("low");
    expect(v.warnings.length).toBeGreaterThanOrEqual(3);
  });
  it("findValue filters by threshold and quality", () => {
    const res = findValue([base, { ...base, selection: "b", bestOdds: 1.7, modelProbability: 0.48 }, { ...base, selection: "c", dataQuality: 0.2 }], DEFAULT_VALUE_SETTINGS);
    expect(res.map((r) => r.selection)).toEqual(["a"]);
  });
});

describe("line movement", () => {
  it("detects steam when several books move together", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 10, 19, 12, m)).toISOString();
    const pts = ["b1", "b2", "b3", "b4"].flatMap((b, i) => [
      { bookmaker: b, odds: 2.0, at: t(0) },
      { bookmaker: b, odds: 1.8, at: t(5 + i) },
    ]);
    const s = detectSteamMoves(pts);
    expect(s).toHaveLength(1);
    expect(s[0]!.booksMoved).toBe(4);
    expect(s[0]!.avgProbShift).toBeGreaterThan(0);
  });
  it("no steam from a single book", () => {
    expect(detectSteamMoves([
      { bookmaker: "x", odds: 2, at: "2026-11-19T12:00:00Z" },
      { bookmaker: "x", odds: 1.6, at: "2026-11-19T12:01:00Z" },
    ])).toHaveLength(0);
  });
  it("reverse line movement returns null without public betting data", () => {
    expect(reverseLineMovement(null, 2, 2.2)).toBeNull();
    expect(reverseLineMovement(0.7, 2, 2.2)).toBe(true);
  });
});
