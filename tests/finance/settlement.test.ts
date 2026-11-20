import { describe, expect, it } from "vitest";
import {
  accumulatorOdds, asianHandicapResult, betProfit, legFactor, liability, potentialPayout,
  settleAccumulator, settlementCredit, totalsResult, SettlementError,
} from "@/lib/finance/settlement";

const p = (x: Parameters<typeof betProfit>[0]) => betProfit(x)?.toNumber() ?? null;

describe("single back bets", () => {
  it("won: stake × (odds − 1)", () => expect(p({ side: "back", odds: 2.5, stake: 100, status: "won" })).toBe(150));
  it("lost: −stake", () => expect(p({ side: "back", odds: 1.8, stake: 50, status: "lost" })).toBe(-50));
  it("void: 0", () => expect(p({ side: "back", odds: 3, stake: 20, status: "void" })).toBe(0));
  it("half won: half stake wins, half returned", () => expect(p({ side: "back", odds: 1.9, stake: 100, status: "half_won" })).toBe(45));
  it("half lost: half stake lost", () => expect(p({ side: "back", odds: 1.9, stake: 100, status: "half_lost" })).toBe(-50));
  it("pending: null", () => expect(p({ side: "back", odds: 2, stake: 10, status: "pending" })).toBeNull());
  it("cashed out: amount − stake", () => expect(p({ side: "back", odds: 3, stake: 100, status: "cashed_out", cashedOutStake: 100, cashoutAmount: 140 })).toBe(40));
  it("commission only on winnings", () => {
    expect(p({ side: "back", odds: 2, stake: 100, status: "won", commission: 0.05 })).toBe(95);
    expect(p({ side: "back", odds: 2, stake: 100, status: "lost", commission: 0.05 })).toBe(-100);
  });
  it("partial cash-out then remaining stake wins", () => {
    // 100 @ 4.0; 40 stake cashed for 70 → open 60 wins 180 + realised 30
    expect(p({ side: "back", odds: 4, stake: 100, status: "won", cashedOutStake: 40, cashoutAmount: 70 })).toBe(210);
    expect(p({ side: "back", odds: 4, stake: 100, status: "lost", cashedOutStake: 40, cashoutAmount: 70 })).toBe(-30);
  });
  it("rounds half away from zero like PostgreSQL", () => {
    expect(p({ side: "back", odds: 1.333, stake: 10.05, status: "won" })).toBe(3.35); // 3.34665
    expect(p({ side: "back", odds: 2.005, stake: 1, status: "won" })).toBe(1.01);     // 1.005 exactly
  });
  it("is exact where floats are not", () => {
    // 0.1 + 0.2 style error: 3 × 0.1 stakes at 2.0
    expect(p({ side: "back", odds: 1.1, stake: 0.3, status: "won" })).toBe(0.03);
  });
  it("rejects invalid odds and commission", () => {
    expect(() => betProfit({ side: "back", odds: 1, stake: 1, status: "won" })).toThrow(SettlementError);
    expect(() => betProfit({ side: "back", odds: Number.NaN, stake: 1, status: "won" })).toThrow();
    expect(() => betProfit({ side: "back", odds: 2, stake: 1, status: "won", commission: 1 })).toThrow();
  });
});

describe("lay bets", () => {
  it("liability = stake × (odds − 1)", () => expect(liability("lay", 3, 50).toNumber()).toBe(100));
  it("won: backer's stake net of commission", () => expect(p({ side: "lay", odds: 3, stake: 50, status: "won", commission: 0.02 })).toBe(49));
  it("lost: −liability", () => expect(p({ side: "lay", odds: 4, stake: 20, status: "lost" })).toBe(-60));
  it("half results", () => {
    expect(p({ side: "lay", odds: 3, stake: 50, status: "half_won" })).toBe(25);
    expect(p({ side: "lay", odds: 3, stake: 50, status: "half_lost" })).toBe(-50);
  });
  it("cannot be cashed out", () => expect(() => betProfit({ side: "lay", odds: 3, stake: 5, status: "cashed_out" })).toThrow());
  it("payout = liability + net stake", () => expect(potentialPayout("lay", 3, 50, 0.02).toNumber()).toBe(149));
});

describe("settlement credit (amount returned to bankroll)", () => {
  it("won back bet returns stake + profit", () => expect(settlementCredit({ side: "back", odds: 2.5, stake: 100, status: "won" }).toNumber()).toBe(250));
  it("lost returns 0", () => expect(settlementCredit({ side: "back", odds: 2.5, stake: 100, status: "lost" }).toNumber()).toBe(0));
  it("lay won returns liability + profit", () => expect(settlementCredit({ side: "lay", odds: 3, stake: 50, status: "won", commission: 0.02 }).toNumber()).toBe(149));
  it("after partial cash-out only the open stake is returned", () =>
    expect(settlementCredit({ side: "back", odds: 4, stake: 100, status: "won", cashedOutStake: 40, cashoutAmount: 70 }).toNumber()).toBe(240));
  it("full cash-out credits the final amount", () =>
    expect(settlementCredit({ side: "back", odds: 3, stake: 100, status: "cashed_out", finalCashout: 140 }).toNumber()).toBe(140));
});

describe("accumulators", () => {
  it("odds are the product of legs", () => expect(accumulatorOdds([2, 1.5, 3]).toNumber()).toBe(9));
  it("won × void × half_won", () => {
    const r = settleAccumulator([{ odds: 2, status: "won" }, { odds: 1.5, status: "void" }, { odds: 3, status: "half_won" }]);
    expect(r.status).toBe("won");
    expect(r.factor!.toNumber()).toBe(4);
    expect(p({ side: "back", odds: 9, stake: 10, status: "won", factor: r.factor! })).toBe(30);
  });
  it("any lost leg loses, even with legs pending", () => {
    expect(settleAccumulator([{ odds: 2, status: "lost" }, { odds: 2, status: "pending" }]).status).toBe("lost");
  });
  it("pending legs keep it open", () => expect(settleAccumulator([{ odds: 2, status: "won" }, { odds: 2, status: "pending" }]).status).toBe("pending"));
  it("all void → void", () => expect(settleAccumulator([{ odds: 2, status: "void" }, { odds: 3, status: "void" }]).status).toBe("void"));
  it("half lost leg halves the return", () => {
    const r = settleAccumulator([{ odds: 2, status: "won" }, { odds: 1.9, status: "half_lost" }]);
    expect(r.factor!.toNumber()).toBe(1);
    expect(p({ side: "back", odds: 3.8, stake: 10, status: "won", factor: r.factor! })).toBe(0);
  });
  it("needs two legs", () => expect(() => settleAccumulator([{ odds: 2, status: "won" }])).toThrow());
});

describe("leg factors", () => {
  it.each([["won", 2.5, 2.5], ["half_won", 2.5, 1.75], ["void", 2.5, 1], ["half_lost", 2.5, 0.5], ["lost", 2.5, 0]] as const)(
    "%s @ %s → %s", (s, o, f) => expect(legFactor(s, o).toNumber()).toBe(f));
});

describe("Asian handicap", () => {
  it.each([
    // line, selection score, opponent score, result
    [-0.5, 1, 0, "won"], [-0.5, 1, 1, "lost"],
    [0, 1, 1, "void"], [0, 2, 1, "won"],
    [-0.25, 1, 1, "half_lost"], [-0.25, 2, 1, "won"],
    [0.25, 1, 1, "half_won"], [0.25, 0, 1, "lost"],
    [-0.75, 2, 1, "half_won"], [-0.75, 3, 1, "won"], [-0.75, 1, 1, "lost"],
    [-1, 2, 1, "void"], [-1, 3, 1, "won"],
    [-1.25, 2, 1, "half_lost"], [1.5, 0, 1, "won"], [0.75, 0, 1, "half_lost"],
  ] as const)("line %s at %s-%s → %s", (line, a, b, r) => expect(asianHandicapResult(line, a, b)).toBe(r));
  it("rejects non-quarter lines", () => expect(() => asianHandicapResult(0.3, 1, 0)).toThrow());
});

describe("quarter-line totals", () => {
  it.each([
    ["over", 2.5, 3, "won"], ["over", 2.5, 2, "lost"], ["over", 2, 2, "void"],
    ["over", 2.25, 2, "half_lost"], ["over", 2.75, 3, "half_won"], ["under", 2.25, 2, "half_won"], ["under", 2.75, 3, "half_lost"],
  ] as const)("%s %s with %s → %s", (side, line, total, r) => expect(totalsResult(side, line, total)).toBe(r));
});
