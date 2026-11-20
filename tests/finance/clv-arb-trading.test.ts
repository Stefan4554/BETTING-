import { describe, expect, it } from "vitest";
import { clv, clvOdds, clvProbability, marketMovement } from "@/lib/finance/clv";
import { arbitrage, bestPriceArb, effectiveOdds } from "@/lib/finance/arbitrage";
import { greenUp, position, settlePosition, unrealisedPnl } from "@/lib/finance/trading";

describe("CLV", () => {
  it("odds-based: taken / closing − 1", () => {
    expect(clvOdds(2.1, 2.0)).toBeCloseTo(0.05, 12);
    expect(clvOdds(1.9, 2.0)).toBeCloseTo(-0.05, 12);
  });
  it("probability-based: closing implied − entry implied", () => {
    expect(clvProbability(2.1, 2.0)).toBeCloseTo(0.5 - 1 / 2.1, 12);
  });
  it("missing / invalid closing → null", () => {
    expect(clv(2, null, "odds")).toBeNull();
    expect(clvOdds(2, 1)).toBeNull();
  });
  it("lay bets want the price to shorten", () => {
    expect(clv(2.0, 2.1, "odds", "lay")).toBeCloseTo(0.05, 12);
    expect(clv(2.0, 2.1, "probability", "lay")).toBeCloseTo(-(1 / 2.1 - 0.5), 12);
  });
  it("market movement", () => expect(marketMovement(2.2, 2.0)).toBeCloseTo(-0.0909, 4));
});

describe("arbitrage", () => {
  it("two-way arb: 1/2.1 + 1/2.1 < 1", () => {
    const r = arbitrage([{ selection: "A", bookmaker: "x", odds: 2.1 }, { selection: "B", bookmaker: "y", odds: 2.1 }], 100);
    expect(r.isArb).toBe(true);
    expect(r.bookSum).toBeCloseTo(0.952381, 6);
    expect(r.margin).toBeCloseTo(0.05, 6);
    expect(r.legs.map((l) => l.stake)).toEqual([50, 50]);
    expect(r.guaranteedProfit).toBe(5);
    expect(r.status).toBe("theoretical");
  });
  it("no arb when the book is over 100%", () => {
    expect(arbitrage([{ selection: "A", bookmaker: "x", odds: 1.9 }, { selection: "B", bookmaker: "y", odds: 1.9 }], 100).isArb).toBe(false);
  });
  it("three-way market includes all outcomes", () => {
    const r = arbitrage([{ selection: "1", bookmaker: "a", odds: 3.2 }, { selection: "X", bookmaker: "b", odds: 3.6 }, { selection: "2", bookmaker: "c", odds: 3.4 }], 1000);
    expect(r.bookSum).toBeCloseTo(1 / 3.2 + 1 / 3.6 + 1 / 3.4, 12);
    expect(r.isArb).toBe(true);
    const returns = r.legs.map((l) => l.returnBase);
    expect(Math.max(...returns) - Math.min(...returns)).toBeLessThanOrEqual(0.02);
  });
  it("commission reduces effective odds and can remove the arb", () => {
    expect(effectiveOdds(2.1, 0.05)).toBeCloseTo(2.045, 12);
    const r = arbitrage([{ selection: "A", bookmaker: "x", odds: 2.05, commission: 0.05 }, { selection: "B", bookmaker: "y", odds: 2.0 }], 100);
    expect(r.isArb).toBe(false);
  });
  it("max stake limits scale the whole position", () => {
    const r = arbitrage([{ selection: "A", bookmaker: "x", odds: 2.1, maxStake: 20 }, { selection: "B", bookmaker: "y", odds: 2.1 }], 100);
    expect(r.limitedByMaxStake).toBe(true);
    expect(r.legs[0]!.stake).toBe(20);
    expect(r.totalStake).toBe(40);
  });
  it("currency conversion per leg", () => {
    const r = arbitrage([{ selection: "A", bookmaker: "x", odds: 2.1, fxToBase: 1.25 }, { selection: "B", bookmaker: "y", odds: 2.1 }], 100);
    expect(r.legs[0]!.stakeBase).toBe(50);
    expect(r.legs[0]!.stake).toBe(40);
  });
  it("best-price selection across books", () => {
    const r = bestPriceArb([
      { selection: "A", bookmaker: "x", odds: 2.0 }, { selection: "A", bookmaker: "y", odds: 2.15 },
      { selection: "B", bookmaker: "x", odds: 2.05 }, { selection: "B", bookmaker: "z", odds: 1.95 },
    ], ["A", "B"]);
    expect(r!.legs.map((l) => l.bookmaker)).toEqual(["y", "x"]);
    expect(bestPriceArb([{ selection: "A", bookmaker: "x", odds: 2 }], ["A", "B"])).toBeNull();
  });
});

describe("trading positions", () => {
  const ex = [{ side: "back" as const, odds: 3, stake: 100 }, { side: "lay" as const, odds: 2.4, stake: 120 }];
  it("scenario P/L (mirrors SQL trade_pnl)", () => {
    const p = position(ex);
    expect(p.ifWin).toBe(32);
    expect(p.ifLose).toBe(20);
    expect(p.exposure).toBe(0);
  });
  it("commission on positive net P/L", () => {
    expect(settlePosition(ex, "win", 0.05)).toBe(30.4);
    expect(settlePosition(ex, "lose", 0.05)).toBe(19);
    expect(settlePosition([{ side: "back", odds: 2, stake: 10 }], "lose", 0.05)).toBe(-10);
  });
  it("partial cash-out inside a trade", () => {
    const p = position([{ side: "back", odds: 4, stake: 100 }, { side: "cashout", stake: 50, amount: 80 }]);
    expect(p.ifWin).toBe(180);
    expect(p.ifLose).toBe(-20);
  });
  it("green up a long position by laying", () => {
    const g = greenUp([{ side: "back", odds: 3, stake: 100 }], { lay: 2 })!;
    expect(g.side).toBe("lay");
    expect(g.stake).toBe(150);
    expect(g.lockedPnl).toBe(50);
    const hedged = position([{ side: "back", odds: 3, stake: 100 }, { side: "lay", odds: 2, stake: g.stake }]);
    expect(hedged.ifWin).toBeCloseTo(hedged.ifLose, 2);
  });
  it("green up a short position by backing", () => {
    const g = greenUp([{ side: "lay", odds: 2, stake: 100 }], { back: 3 })!;
    expect(g.side).toBe("back");
    expect(g.lockedPnl).toBeCloseTo(33.33, 2);
  });
  it("unrealised P/L needs a price", () => {
    expect(unrealisedPnl([{ side: "back", odds: 3, stake: 100 }], {})).toBeNull();
  });
  it("cannot cash out more than backed", () => expect(() => position([{ side: "cashout", stake: 10, amount: 5 }])).toThrow());
});
