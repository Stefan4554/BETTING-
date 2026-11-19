import { describe, expect, it } from "vitest";
import { EloModel, expectedScore, kFactor, type HistoricalMatch } from "@/lib/engine/elo";
import { accuracy, backtestElo, brierScore, calibration, chronologicalSplit, logLoss } from "@/lib/engine/evaluation";
import { bankrollCurve, betProfit, betsToCsv, byPeriod, groupBy, summarize, type Bet } from "@/lib/engine/bets";

/** Deterministic PRNG so the synthetic test league is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

/** Synthetic league with known latent strengths — used ONLY to test the model code. */
function syntheticLeague(n = 3000, players = 40): HistoricalMatch[] {
  const r = rng(42);
  const strength = Array.from({ length: players }, (_, i) => 1300 + i * 15);
  const out: HistoricalMatch[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(r() * players);
    let b = Math.floor(r() * players);
    if (b === a) b = (b + 1) % players;
    const pA = expectedScore(strength[a]!, strength[b]!);
    const aWins = r() < pA;
    out.push({
      id: `m${i}`,
      date: new Date(Date.UTC(2020, 0, 1) + i * 3600_000 * 12).toISOString(),
      winnerId: `p${aWins ? a : b}`,
      loserId: `p${aWins ? b : a}`,
      surface: (["hard", "clay", "grass"] as const)[i % 3]!,
    });
  }
  return out;
}

describe("Elo", () => {
  it("expected score symmetric", () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
    expect(expectedScore(1600, 1500) + expectedScore(1500, 1600)).toBeCloseTo(1);
  });
  it("K decreases with experience", () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(100));
  });
  it("winner gains, loser loses, zero-sum on first match", () => {
    const m = new EloModel();
    m.update({ id: "1", date: "2026-01-01", winnerId: "a", loserId: "b", surface: "clay" });
    expect(m.get("a").overall).toBeGreaterThan(1500);
    expect(m.get("a").overall - 1500).toBeCloseTo(1500 - m.get("b").overall);
    expect(m.get("a").surface.clay!.matches).toBe(1);
  });
  it("refuses unsorted training data (leakage guard)", () => {
    expect(() =>
      new EloModel().fit([
        { id: "2", date: "2026-02-01", winnerId: "a", loserId: "b", surface: "hard" },
        { id: "1", date: "2026-01-01", winnerId: "a", loserId: "b", surface: "hard" },
      ]),
    ).toThrow(/chronologically/);
  });
  it("returns null with insufficient history", () => {
    const m = new EloModel();
    m.update({ id: "1", date: "2026-01-01", winnerId: "a", loserId: "b", surface: "hard" });
    expect(m.predict("a", "b", "hard")).toBeNull();
    expect(m.predict("a", "unknown", "hard")).toBeNull();
  });
  it("prediction interval contains point estimate", () => {
    const m = new EloModel().fit(syntheticLeague(2000));
    const p = m.predict("p39", "p0", "hard")!;
    expect(p.probA).toBeGreaterThan(0.5);
    expect(p.ciLow).toBeLessThan(p.probA);
    expect(p.ciHigh).toBeGreaterThan(p.probA);
  });
});

describe("evaluation", () => {
  it("brier, log loss, accuracy", () => {
    const f = [{ probability: 0.8, outcome: 1 as const }, { probability: 0.3, outcome: 0 as const }];
    expect(brierScore(f)).toBeCloseTo((0.04 + 0.09) / 2);
    expect(logLoss(f)).toBeCloseTo(-(Math.log(0.8) + Math.log(0.7)) / 2);
    expect(accuracy(f)).toBe(1);
  });
  it("calibration bins", () => {
    const bins = calibration([{ probability: 0.05, outcome: 0 }, { probability: 0.95, outcome: 1 }], 10);
    expect(bins[0]!.count).toBe(1);
    expect(bins[9]!.observedRate).toBe(1);
  });
  it("chronological split has no overlap", () => {
    const { train, test } = chronologicalSplit(syntheticLeague(100), "2020-01-26T00:00:00Z");
    expect(Date.parse(train.at(-1)!.date)).toBeLessThan(Date.parse(test[0]!.date));
  });
  it("walk-forward backtest beats coin flip on synthetic data with known strengths", () => {
    const res = backtestElo(syntheticLeague(3000), "2023-01-01T00:00:00Z");
    expect(res.testSize).toBeGreaterThan(0);
    expect(res.predicted + res.skippedInsufficientData).toBe(res.testSize);
    expect(res.brier).toBeLessThan(0.25);
    expect(res.accuracy).toBeGreaterThan(0.55);
    expect(res.ece).toBeLessThan(0.1);
  });
});

describe("bet tracker", () => {
  const mk = (o: Partial<Bet>): Bet => ({
    id: Math.random().toString(36), placedAt: "2026-11-10T10:00:00Z", settledAt: "2026-11-10T14:00:00Z",
    sport: "tennis", eventLabel: "A v B", market: "match_winner", selection: "A", bookmaker: "pinnacle",
    odds: 2, stake: 10, status: "won", ...o,
  });
  const bets = [
    mk({ odds: 2.5, stake: 10, status: "won", closingOdds: 2.3 }),
    mk({ odds: 1.8, stake: 20, status: "lost", bookmaker: "bet365", closingOdds: 1.9, settledAt: "2026-11-17T10:00:00Z" }),
    mk({ status: "void" }),
    mk({ status: "pending", settledAt: null }),
  ];
  it("profit by status (matches SQL trigger)", () => {
    expect(betProfit({ status: "won", odds: 2.5, stake: 10 })).toBe(15);
    expect(betProfit({ status: "lost", odds: 2.5, stake: 10 })).toBe(-10);
    expect(betProfit({ status: "half_won", odds: 3, stake: 10 })).toBe(10);
    expect(betProfit({ status: "half_lost", odds: 3, stake: 10 })).toBe(-5);
    expect(betProfit({ status: "pending", odds: 3, stake: 10 })).toBeNull();
    expect(betProfit({ status: "cashed_out", odds: 3, stake: 10, cashoutReturn: 14 })).toBe(4);
  });
  it("summary: profit, yield, win rate excluding voids, CLV", () => {
    const s = summarize(bets, 1000);
    expect(s.profit).toBe(-5);
    expect(s.totalStaked).toBe(40);
    expect(s.yield).toBeCloseTo(-5 / 40);
    expect(s.roi).toBeCloseTo(-0.005);
    expect(s.winRate).toBe(0.5);
    expect(s.pending).toBe(1);
    expect(s.averageClv).toBeCloseTo((2.5 / 2.3 - 1 + 1.8 / 1.9 - 1) / 2);
  });
  it("groups by bookmaker and week", () => {
    expect(groupBy(bets, (b) => b.bookmaker).bet365!.profit).toBe(-20);
    expect(Object.keys(byPeriod(bets, "week"))).toEqual(["2026-11-09", "2026-11-16"]);
  });
  it("bankroll curve", () => {
    expect(bankrollCurve(bets, 100).at(-1)!.bankroll).toBe(95);
  });
  it("CSV escapes quotes and neutralises formula injection", () => {
    const csv = betsToCsv([mk({ eventLabel: '=HYPERLINK("x")', notes: 'say "hi", ok' })]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"say ""hi"", ok"`);
  });
});
