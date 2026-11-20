import { describe, expect, it } from "vitest";
import {
  change, cumulativeCurve, drawdown, groupBy, inRange, oddsBucket, pnlByPeriod, previousRange, resolveRange, streaks, summarize,
  type BetRecord,
} from "@/lib/finance/metrics";
import { calibrate, wilson } from "@/lib/finance/calibration";
import { checkLimits, preTradeCheck, riskState } from "@/lib/finance/risk";
import { FxTable } from "@/lib/finance/fx";
import { americanToDecimal, decimalToFractional, fractionalToDecimal, parseOdds } from "@/lib/finance/odds";

let n = 0;
function bet(o: Partial<BetRecord>): BetRecord {
  n++;
  return {
    id: `b${n}`, ref: n, placedAt: `2026-03-${String(1 + (n % 27)).padStart(2, "0")}T10:00:00Z`, settledAt: null, status: "pending",
    side: "back", kind: "single", odds: 2, stake: 10, liability: 10, profit: null, estProbability: null, openingOdds: null, closingOdds: null,
    isLive: false, sport: "Football", league: null, bookmaker: "Pinnacle", strategy: null, market: "Match Winner", marketCategory: "result",
    eventName: `Event ${n}`, eventId: null, correlationGroup: null, bankrollId: "main", tags: [], ...o,
  };
}
const settled = (status: BetRecord["status"], profit: number, o: Partial<BetRecord> = {}) =>
  bet({ status, profit, settledAt: o.settledAt ?? `2026-03-${String(1 + (n % 27)).padStart(2, "0")}T12:00:00Z`, ...o });

describe("summary edge cases", () => {
  it("no bets: nothing misleading", () => {
    const s = summarize([]);
    expect(s.roi).toBeNull();
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.averageOdds).toBeNull();
    expect(s.sharpe).toBeNull();
    expect(s.averageClv).toBeNull();
    expect(s.riskOfRuin).toBeNull();
    expect(s.lowSample).toBe(true);
  });
  it("only pending bets: exposure but no ROI", () => {
    const s = summarize([bet({ stake: 10, liability: 10 }), bet({ side: "lay", stake: 10, odds: 3, liability: 20 })]);
    expect(s.pendingBets).toBe(2);
    expect(s.openExposure).toBe(30);
    expect(s.roi).toBeNull();
  });
  it("no losses: profit factor null (∞), win rate 100%", () => {
    const s = summarize([settled("won", 10), settled("won", 5)]);
    expect(s.profitFactor).toBeNull();
    expect(s.grossLoss).toBe(0);
    expect(s.winRate).toBe(1);
  });
  it("no wins: profit factor 0", () => expect(summarize([settled("lost", -10)]).profitFactor).toBe(0));
  it("void only: zero profit, no win rate", () => {
    const s = summarize([settled("void", 0)]);
    expect(s.winRate).toBeNull();
    expect(s.roi).toBe(0);
    expect(s.averageOdds).toBeNull();
  });
});

describe("summary maths", () => {
  const bets = [
    settled("won", 15, { odds: 2.5, stake: 10, settledAt: "2026-03-01T12:00:00Z" }),
    settled("lost", -10, { odds: 1.8, stake: 10, settledAt: "2026-03-02T12:00:00Z" }),
    settled("lost", -20, { odds: 2.0, stake: 20, settledAt: "2026-03-03T12:00:00Z" }),
    settled("half_won", 4.5, { odds: 1.9, stake: 10, settledAt: "2026-03-04T12:00:00Z" }),
    settled("void", 0, { odds: 3, stake: 5, settledAt: "2026-03-05T12:00:00Z" }),
    settled("cashed_out", 3, { odds: 3, stake: 10, settledAt: "2026-03-06T12:00:00Z" }),
    bet({ stake: 7, liability: 7 }),
  ];
  const s = summarize(bets, { capital: 100 });
  it("counts", () => {
    expect([s.totalBets, s.settledBets, s.pendingBets, s.voidBets, s.wins, s.losses]).toEqual([7, 6, 1, 1, 3, 2]);
  });
  it("ROI = yield = profit / settled stake", () => {
    expect(s.totalStake).toBe(65);
    expect(s.netProfit).toBe(-7.5);
    expect(s.roi).toBeCloseTo(-7.5 / 65, 12);
    expect(s.yield).toBe(s.roi);
  });
  it("win rate excludes voids", () => expect(s.winRate).toBeCloseTo(3 / 5, 12));
  it("profit factor", () => expect(s.profitFactor).toBeCloseTo(22.5 / 30, 12));
  it("average odds of settled non-void selections", () => expect(s.averageOdds).toBeCloseTo((2.5 + 1.8 + 2 + 1.9 + 3) / 5, 12));
  it("average win / loss", () => {
    expect(s.averageWin).toBeCloseTo(22.5 / 3, 12);
    expect(s.averageLoss).toBe(-15);
  });
  it("drawdown on P/L path: peak 15 → trough −15", () => {
    expect(s.drawdown.maxAmount).toBe(30);
    expect(s.drawdown.maxPct).toBeCloseTo(30 / 115, 12);
    expect(s.recoveryFactor).toBeCloseTo(-7.5 / 30, 12);
  });
  it("streaks ignore voids", () => {
    expect(s.longestLossStreak).toBe(2);
    expect(s.longestWinStreak).toBe(2); // half_won, (void), cashed_out +3
  });
  it("Sharpe and Sortino per bet", () => {
    const r = [1.5, -1, -1, 0.45, 0.3];
    const m = r.reduce((a, b) => a + b) / 5;
    const sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / 4);
    const dd = Math.sqrt(r.reduce((a, x) => a + Math.min(0, x) ** 2, 0) / 5);
    expect(s.sharpe).toBeCloseTo(m / sd, 12);
    expect(s.sortino).toBeCloseTo(m / dd, 12);
    expect(s.varianceReturn).toBeCloseTo(sd * sd, 12);
  });
  it("small samples flagged", () => expect(s.lowSample).toBe(true));
});

describe("expected value and CLV", () => {
  const bets = [
    settled("won", 10, { odds: 2, stake: 10, estProbability: 0.55, closingOdds: 1.9 }),
    settled("lost", -10, { odds: 2, stake: 10, estProbability: 0.55, closingOdds: 2.1 }),
    settled("won", 10, { odds: 2, stake: 10 }),
  ];
  it("EV only from bets with estimates", () => {
    const s = summarize(bets);
    expect(s.evSample).toBe(2);
    expect(s.expectedProfit).toBeCloseTo(2 * 10 * 0.1, 12);
    expect(s.expectedRoi).toBeCloseTo(0.1, 12);
    expect(s.realizedRoiOnEvSample).toBe(0);
  });
  it("CLV average over bets with closing odds only, both conventions", () => {
    const so = summarize(bets, { convention: "odds" });
    expect(so.clvSample).toBe(2);
    expect(so.averageClv).toBeCloseTo((2 / 1.9 - 1 + 2 / 2.1 - 1) / 2, 12);
    expect(so.positiveClvRate).toBe(0.5);
    const sp = summarize(bets, { convention: "probability" });
    expect(sp.averageClv).toBeCloseTo((1 / 1.9 - 0.5 + 1 / 2.1 - 0.5) / 2, 12);
  });
});

describe("risk of ruin", () => {
  it("needs 30+ bets and a bankroll", () => {
    const few = Array.from({ length: 10 }, (_, i) => settled(i % 2 ? "won" : "lost", i % 2 ? 11 : -10));
    expect(summarize(few, { bankroll: 1000 }).riskOfRuin).toBeNull();
  });
  it("exp(−2μB/σ²) for a positive edge; 1 for a negative edge", () => {
    const many = Array.from({ length: 40 }, (_, i) => settled(i % 2 ? "won" : "lost", i % 2 ? 11 : -10));
    const s = summarize(many, { bankroll: 100 });
    const mu = 0.5, varP = (40 / 39) * 110.25;
    expect(s.riskOfRuin).toBeCloseTo(Math.exp((-2 * mu * 100) / varP), 10);
    const losing = Array.from({ length: 40 }, (_, i) => settled(i % 2 ? "won" : "lost", i % 2 ? 9 : -10));
    expect(summarize(losing, { bankroll: 100 }).riskOfRuin).toBe(1);
  });
});

describe("drawdown", () => {
  it("no drawdown on a rising path", () => {
    const d = drawdown([{ at: "a", cum: 1 }, { at: "b", cum: 2 }], 100);
    expect(d.maxAmount).toBe(0);
    expect(d.maxPct).toBe(0);
  });
  it("tracks recovery", () => {
    const d = drawdown([{ at: "a", cum: 10 }, { at: "b", cum: -5 }, { at: "c", cum: 12 }], 0);
    expect(d.maxAmount).toBe(15);
    expect(d.maxPct).toBeCloseTo(1.5, 12);
    expect(d.recovered).toBe(true);
    expect(d.peakAt).toBe("a");
    expect(d.troughAt).toBe("b");
  });
  it("deposits are not part of the P/L path", () => {
    // capital only scales the percentage, never the amount
    expect(drawdown([{ at: "a", cum: -50 }], 1000).maxAmount).toBe(50);
    expect(drawdown([{ at: "a", cum: -50 }], 1000).maxPct).toBeCloseTo(0.05, 12);
  });
});

describe("grouping, periods and curves", () => {
  const bets = [
    settled("won", 10, { sport: "Football", settledAt: "2026-03-02T10:00:00Z", odds: 2 }),
    settled("lost", -10, { sport: "Tennis", settledAt: "2026-03-02T18:00:00Z", odds: 1.4 }),
    settled("won", 20, { sport: "Football", settledAt: "2026-03-10T10:00:00Z", odds: 3, stake: 10 }),
  ];
  it("groupBy sorts by profit", () => {
    const g = groupBy(bets, (b) => b.sport);
    expect(g.map((x) => [x.key, x.profit])).toEqual([["Football", 30], ["Tennis", -10]]);
  });
  it("daily / weekly / monthly", () => {
    expect(pnlByPeriod(bets, "day").map((r) => [r.period, r.profit])).toEqual([["2026-03-02", 0], ["2026-03-10", 20]]);
    expect(pnlByPeriod(bets, "week").map((r) => r.period)).toEqual(["2026-03-02", "2026-03-09"]);
    expect(pnlByPeriod(bets, "month")[0]!.roi).toBeCloseTo(20 / 30, 12);
  });
  it("cumulative curve", () => {
    const c = cumulativeCurve(bets, { startingEquity: 100 });
    expect(c.map((x) => x.cumProfit)).toEqual([10, 0, 20]);
    expect(c.at(-1)!.equity).toBe(120);
    expect(c.at(-1)!.winRate).toBeCloseTo(2 / 3, 12);
  });
  it("odds buckets", () => {
    expect(oddsBucket(1.25)).toBe("1.01–1.49");
    expect(oddsBucket(2)).toBe("2.00–2.49");
    expect(oddsBucket(15)).toBe("10.00+");
  });
  it("streaks of an empty list", () => expect(streaks([])).toEqual({ longestWin: 0, longestLoss: 0, current: null }));
});

describe("date ranges", () => {
  const now = new Date("2026-03-15T15:00:00Z");
  it("presets", () => {
    expect(resolveRange("today", now).from!.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(resolveRange("yesterday", now).to!.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(resolveRange("7d", now).from!.toISOString()).toBe("2026-03-09T00:00:00.000Z");
    expect(resolveRange("ytd", now).from!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(resolveRange("all", now)).toEqual({ from: null, to: null });
    expect(resolveRange("custom", now, { from: "2026-02-01", to: "2026-02-28" }).to!.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
  it("previous period has the same length", () => {
    const r = resolveRange("7d", now);
    const p = previousRange(r)!;
    expect(p.to!.getTime()).toBe(r.from!.getTime());
    expect(p.to!.getTime() - p.from!.getTime()).toBe(r.to!.getTime() - r.from!.getTime());
    expect(previousRange(resolveRange("all", now))).toBeNull();
  });
  it("inRange and change", () => {
    expect(inRange(bet({ placedAt: "2026-03-14T10:00:00Z" }), resolveRange("7d", now))).toBe(true);
    expect(change(12, 10)).toBeCloseTo(0.2, 12);
    expect(change(5, 0)).toBeNull();
    expect(change(-5, -10)).toBeCloseTo(0.5, 12);
  });
});

describe("calibration", () => {
  it("Brier, log loss, buckets and market baseline", () => {
    const bets = [
      settled("won", 10, { estProbability: 0.6, odds: 2 }),
      settled("lost", -10, { estProbability: 0.6, odds: 2 }),
      settled("won", 10, { estProbability: 0.8, odds: 1.5 }),
      settled("void", 0, { estProbability: 0.5 }),
      settled("won", 10, {}),
    ];
    const c = calibrate(bets);
    expect(c.sample).toBe(3);
    expect(c.excluded).toBe(1);
    expect(c.brier).toBeCloseTo((0.16 + 0.36 + 0.04) / 3, 12);
    expect(c.logLoss).toBeCloseTo(-(Math.log(0.6) + Math.log(0.4) + Math.log(0.8)) / 3, 12);
    expect(c.marketBrier).toBeCloseTo((0.25 + 0.25 + (1 / 1.5 - 1) ** 2) / 3, 12);
    const b6 = c.buckets.find((b) => b.label === "60–70%")!;
    expect([b6.n, b6.actualRate]).toEqual([2, 0.5]);
    expect(c.lowSample).toBe(true);
  });
  it("empty calibration", () => {
    const c = calibrate([]);
    expect(c.brier).toBeNull();
    expect(c.buckets.every((b) => b.n === 0)).toBe(true);
  });
  it("Wilson interval", () => {
    const [lo, hi] = wilson(50, 100)!;
    expect(lo).toBeCloseTo(0.4038, 3);
    expect(hi).toBeCloseTo(0.5962, 3);
    expect(wilson(0, 0)).toBeNull();
  });
});

describe("risk", () => {
  const now = new Date("2026-03-15T15:00:00Z");
  const bets = [
    bet({ eventName: "A v B", liability: 50, stake: 50, sport: "Football", correlationGroup: "epl-sat" }),
    bet({ eventName: "a v b ", liability: 30, stake: 30, sport: "Football", market: "Over/Under", correlationGroup: "epl-sat" }),
    bet({ eventName: "C v D", side: "lay", liability: 40, stake: 20, odds: 3, sport: "Tennis" }),
    settled("lost", -60, { settledAt: "2026-03-15T09:00:00Z" }),
    settled("won", 20, { settledAt: "2026-03-10T09:00:00Z" }),
  ];
  const st = riskState(bets, [{ id: "t", eventName: "Live X", sport: "Tennis", exposure: 20 }], 1000, now);
  it("aggregates exposure (same event regardless of case/spacing)", () => {
    expect(st.totalExposure).toBe(140);
    expect(st.byEvent[0]).toMatchObject({ key: "A v B", exposure: 80, bets: 2 });
    expect(st.bySport.find((r) => r.key === "Tennis")!.exposure).toBe(60);
    expect(st.byCorrelationGroup[0]).toMatchObject({ key: "epl-sat", exposure: 80 });
    expect(st.exposurePctOfBankroll).toBeCloseTo(0.14, 12);
    expect(st.concentration).toBeCloseTo(80 / 140, 12);
  });
  it("daily & weekly realised P/L", () => {
    expect(st.dailyPnl).toBe(-60);
    expect(st.weeklyPnl).toBe(-40); // ISO week from Monday 2026-03-09 includes the +20 on the 10th
  });
  it("limit breaches: warning at 80%, critical over 100%", () => {
    const br = checkLimits(st, { maxEventExposure: 75, maxDailyLoss: 70, maxDrawdownPct: 0.2 }, { equity: 1000, drawdownPct: 0.1 });
    expect(br.find((b) => b.key === "event:A v B")!.severity).toBe("critical");
    expect(br.find((b) => b.type === "daily_loss")!.severity).toBe("warning");
    expect(br.find((b) => b.type === "drawdown")).toBeUndefined();
  });
  it("pre-trade check", () => {
    const issues = preTradeCheck({ stake: 30, liability: 30, eventKey: "A V B", correlationGroup: "epl-sat" }, st,
      { maxStakePerBet: 25, maxEventExposure: 100, maxCorrelatedExposure: 100, maxBetPctBankroll: 0.02 }, 1000);
    expect(issues).toHaveLength(4);
    expect(preTradeCheck({ stake: 5, liability: 5, eventKey: "Z" }, st, { maxStakePerBet: 25 }, 1000)).toEqual([]);
  });
});

describe("FX", () => {
  const fx = new FxTable([
    { base: "EUR", quote: "USD", rate: 1.1, asOf: "2026-01-01" },
    { base: "EUR", quote: "USD", rate: 1.2, asOf: "2026-02-01" },
    { base: "EUR", quote: "GBP", rate: 0.85, asOf: "2026-01-01" },
  ]);
  it("historical snapshot on or before the date", () => {
    expect(fx.rate("EUR", "USD", "2026-01-15")).toBe(1.1);
    expect(fx.rate("EUR", "USD", "2026-03-01")).toBe(1.2);
    expect(fx.rate("EUR", "USD", "2025-12-31")).toBeNull();
  });
  it("inverse and triangulated", () => {
    expect(fx.rate("USD", "EUR", "2026-02-15")).toBeCloseTo(1 / 1.2, 12);
    expect(fx.rate("USD", "GBP", "2026-02-15")).toBeCloseTo(0.85 / 1.2, 12);
    expect(fx.convert(100, "GBP", "GBP")).toBe(100);
  });
});

describe("odds formats", () => {
  it("parses decimal, American, fractional", () => {
    expect(parseOdds("2,5")).toBe(2.5);
    expect(parseOdds("+150")).toBe(2.5);
    expect(parseOdds("-200")).toBe(1.5);
    expect(parseOdds("5/2")).toBe(3.5);
    expect(() => parseOdds("0.9")).toThrow();
    expect(americanToDecimal(100)).toBe(2);
  });
  it("fractional round trip", () => {
    expect(decimalToFractional(3.5)).toBe("5/2");
    expect(decimalToFractional(1.5)).toBe("1/2");
    expect(fractionalToDecimal("11/10")).toBeCloseTo(2.1, 12);
  });
});
