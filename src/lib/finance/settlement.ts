/**
 * Bet settlement maths — the TypeScript mirror of private.bet_profit / settle_bet in
 * supabase/migrations/…_financial_engine.sql. The database is authoritative for stored
 * results; this module powers previews, the fast-entry form and analytics, and is
 * parity-tested against the SQL functions (tests/parity.db.test.ts).
 */
import { d, money, type Dec, type Num } from "./decimal";

export type BetStatus = "pending" | "won" | "lost" | "void" | "half_won" | "half_lost" | "cashed_out" | "partial_win" | "partial_loss" | "break_even";
export type LegStatus = "pending" | "won" | "lost" | "void" | "half_won" | "half_lost";
export type Side = "back" | "lay";

export const SETTLED_STATUSES: BetStatus[] = ["won", "lost", "void", "half_won", "half_lost", "cashed_out", "partial_win", "partial_loss", "break_even"];

export class SettlementError extends Error {}

function assertOdds(odds: Num) {
  if (!d(odds).isFinite() || d(odds).lte(1)) throw new SettlementError(`Decimal odds must be > 1 (got ${odds})`);
}

/** Return multiplier for a result: won → odds, half_won → (1+odds)/2, void → 1, half_lost → ½, lost → 0. */
export function legFactor(status: LegStatus, odds: Num): Dec {
  assertOdds(odds);
  switch (status) {
    case "won": return d(odds);
    case "half_won": return d(odds).plus(1).div(2);
    case "void": return d(1);
    case "half_lost": return d("0.5");
    case "lost": return d(0);
    case "pending": throw new SettlementError("Pending legs have no settlement factor");
  }
}

/** Amount reserved from the bankroll: stake (back) or liability = stake × (odds − 1) (lay). */
export function liability(side: Side, odds: Num, stake: Num): Dec {
  assertOdds(odds);
  return side === "lay" ? money(d(stake).times(d(odds).minus(1))) : money(stake);
}

/** Gross return if the bet wins in full, net of commission on winnings. */
export function potentialPayout(side: Side, odds: Num, stake: Num, commission: Num = 0): Dec {
  const c = d(1).minus(commission);
  if (side === "lay") return liability("lay", odds, stake).plus(money(d(stake).times(c)));
  return money(stake).plus(money(d(stake).times(d(odds).minus(1)).times(c)));
}

export interface ProfitInput {
  side: Side;
  odds: Num;
  stake: Num;
  commission?: Num;
  status: BetStatus;
  /** Stake already closed by partial cash-outs (back bets). */
  cashedOutStake?: Num;
  /** Total received from cash-outs, including the final one for status cashed_out. */
  cashoutAmount?: Num;
  /** Accumulator: product of leg factors (overrides the single-bet factor). */
  factor?: Num;
}

/** Profit in bet currency, rounded to cents; null while pending. */
export function betProfit(i: ProfitInput): Dec | null {
  if (i.status === "pending") return null;
  assertOdds(i.odds);
  const c = d(i.commission ?? 0);
  if (c.lt(0) || c.gte(1)) throw new SettlementError("Commission must be in [0, 1)");
  const stake = d(i.stake);
  if (i.side === "lay") {
    const liab = liability("lay", i.odds, stake);
    switch (i.status) {
      case "won": return money(stake.times(d(1).minus(c)));
      case "half_won": return money(stake.div(2).times(d(1).minus(c)));
      case "lost": return liab.neg();
      case "half_lost": return money(liab.div(2)).neg();
      case "void": return d(0);
      case "cashed_out": throw new SettlementError("Lay bets cannot be cashed out");
    }
  }
  const cashed = d(i.cashedOutStake ?? 0);
  const cashAmt = d(i.cashoutAmount ?? 0);
  if (i.status === "cashed_out") return money(cashAmt.minus(stake));
  const open = stake.minus(cashed);
  if (i.factor === undefined && (i.status === "partial_win" || i.status === "partial_loss" || i.status === "break_even"))
    throw new SettlementError(`Status ${i.status} needs the accumulator factor`);
  const f = i.factor !== undefined ? d(i.factor) : legFactor(i.status as LegStatus, i.odds);
  let gross = open.times(f.minus(1));
  if (gross.gt(0)) gross = gross.times(d(1).minus(c));
  return money(gross).plus(money(cashAmt.minus(cashed)));
}

export interface LegResult { odds: Num; status: LegStatus }

/**
 * One path of an accumulator after splitting half-results: a half-won leg sends half of the
 * running stake on at the leg odds and returns half at 1.00; a half-lost leg returns half at
 * 1.00 and loses half. Components multiply out to exactly stake × Π leg factors.
 */
export interface AccaComponent { stake: Dec; odds: Dec; payout: Dec; path: string[] }

export function accumulatorComponents(stake: Num, legs: LegResult[]): AccaComponent[] {
  let comps: AccaComponent[] = [{ stake: d(stake), odds: d(1), payout: d(stake), path: [] }];
  legs.forEach((l, i) => {
    const o = d(l.odds);
    const next: AccaComponent[] = [];
    for (const c of comps) {
      const push = (share: Num, mult: Num, tag: string) => {
        const st = c.stake.times(share);
        next.push({ stake: st, odds: c.odds.times(mult), payout: st.times(c.odds).times(mult), path: [...c.path, `L${i + 1}:${tag}`] });
      };
      switch (l.status) {
        case "won": push(1, o, "won"); break;
        case "void": push(1, 1, "void"); break;
        case "lost": push(1, 0, "lost"); break;
        case "half_won": push("0.5", o, "won½"); push("0.5", 1, "void½"); break;
        case "half_lost": push("0.5", 1, "void½"); push("0.5", 0, "lost½"); break;
        case "pending": throw new SettlementError("Pending legs cannot be split");
      }
    }
    comps = next;
  });
  return comps;
}

/**
 * Accumulator result from the ACTUAL return, never from individual leg labels:
 *   lost (payout 0) · void (every leg void) · won (all non-void legs fully won) ·
 *   partial_win (payout > stake with half results) · break_even (payout = stake) · partial_loss (0 < payout < stake).
 */
export function settleAccumulator(legs: LegResult[]): { status: BetStatus; factor: Dec } | { status: "pending"; factor: null } {
  if (legs.length < 2) throw new SettlementError("An accumulator needs at least two legs");
  if (legs.some((l) => l.status === "lost")) return { status: "lost", factor: d(0) };
  if (legs.some((l) => l.status === "pending")) return { status: "pending", factor: null };
  const factor = legs.reduce((f, l) => f.times(legFactor(l.status, l.odds)), d(1));
  const halves = legs.some((l) => l.status === "half_won" || l.status === "half_lost");
  let status: BetStatus;
  if (factor.isZero()) status = "lost";
  else if (legs.every((l) => l.status === "void")) status = "void";
  else if (!halves && factor.gt(1)) status = "won";
  else if (factor.gt(1)) status = "partial_win";
  else if (factor.eq(1)) status = "break_even";
  else status = "partial_loss";
  return { status, factor };
}

export function accumulatorOdds(legOdds: Num[]): Dec {
  legOdds.forEach(assertOdds);
  return legOdds.reduce<Dec>((p, o) => p.times(o), d(1)).toDecimalPlaces(4);
}

/**
 * Amount credited to the bankroll by the settlement itself (bet currency). Earlier partial
 * cash-outs were credited when they happened. For a full cash-out pass the final amount.
 */
export function settlementCredit(i: ProfitInput & { finalCashout?: Num }): Dec {
  if (i.status === "cashed_out") return money(i.finalCashout ?? 0);
  const profit = betProfit(i);
  if (profit === null) throw new SettlementError("Pending bets have no settlement credit");
  if (i.side === "lay") return liability("lay", i.odds, i.stake).plus(profit);
  const open = d(i.stake).minus(i.cashedOutStake ?? 0);
  return open.plus(profit.minus(money(d(i.cashoutAmount ?? 0).minus(i.cashedOutStake ?? 0))));
}

// ── Asian handicap & quarter-line totals ────────────────────────────────────

type HalfResult = "win" | "push" | "lose";
const half = (x: Dec): HalfResult => (x.gt(0) ? "win" : x.isZero() ? "push" : "lose");

function combine(a: HalfResult, b: HalfResult): LegStatus {
  const key = [a, b].sort().join("+");
  switch (key) {
    case "win+win": return "won";
    case "push+win": return "half_won";
    case "push+push": return "void";
    case "lose+push": return "half_lost";
    case "lose+lose": return "lost";
    default: throw new SettlementError(`Inconsistent split result ${key}`);
  }
}

function splitLine(line: Num): [Dec, Dec] {
  const l = d(line);
  const quarters = l.times(4);
  if (!quarters.isInteger()) throw new SettlementError(`Line must be a multiple of 0.25 (got ${line})`);
  // x.25 / x.75 lines are split into the two neighbouring half-stakes
  if (quarters.mod(2).abs().eq(1)) return [l.minus("0.25"), l.plus("0.25")];
  return [l, l];
}

/**
 * Asian handicap result for the selection.
 * @param line handicap applied to the selection (e.g. -0.75)
 * @param selectionScore goals/points of the selection; @param opponentScore of the opponent
 */
export function asianHandicapResult(line: Num, selectionScore: number, opponentScore: number): LegStatus {
  const diff = d(selectionScore - opponentScore);
  const [a, b] = splitLine(line);
  return combine(half(diff.plus(a)), half(diff.plus(b)));
}

/** Over/under result with quarter-line support (e.g. Over 2.25). */
export function totalsResult(side: "over" | "under", line: Num, total: number): LegStatus {
  const [a, b] = splitLine(line);
  const t = d(total);
  const res = (l: Dec) => half(side === "over" ? t.minus(l) : l.minus(t));
  return combine(res(a), res(b));
}
