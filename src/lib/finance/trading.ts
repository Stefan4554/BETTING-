/**
 * Position maths for back/lay trading on a single selection (mirror of private.trade_pnl).
 *   win  = Σback s(o−1)·(1 − cashed share) − Σlay s(o−1) + (Σcash-out − Σcashed stake)
 *   lose = −(Σback s − Σcashed stake) + Σlay s + (Σcash-out − Σcashed stake)
 * Commission is charged on positive net market P/L at settlement.
 */
import { money } from "./decimal";

export type ExecutionSide = "back" | "lay" | "cashout";
export interface Execution { side: ExecutionSide; odds?: number | null; stake: number; amount?: number | null; executedAt?: string }

export interface Position {
  backStake: number;
  layStake: number;
  layLiability: number;
  cashedStake: number;
  cashoutReceived: number;
  /** P/L if the selection wins / loses, before commission. */
  ifWin: number;
  ifLose: number;
  /** Worst case loss as a positive number (0 if the position cannot lose). */
  exposure: number;
  avgBackOdds: number | null;
  avgLayOdds: number | null;
}

export function position(executions: Execution[]): Position {
  let bs = 0, bw = 0, ls = 0, lw = 0, cs = 0, ca = 0;
  for (const e of executions) {
    if (e.side === "back") { bs += e.stake; bw += e.stake * ((e.odds ?? 1) - 1); }
    else if (e.side === "lay") { ls += e.stake; lw += e.stake * ((e.odds ?? 1) - 1); }
    else { cs += e.stake; ca += e.amount ?? 0; }
  }
  if (cs > bs + 1e-9) throw new Error("Cashed-out stake exceeds back stake");
  const realised = ca - cs;
  const ifWin = (bs > 0 ? bw * (1 - cs / bs) : 0) - lw + realised;
  const ifLose = -(bs - cs) + ls + realised;
  return {
    backStake: bs, layStake: ls, layLiability: lw, cashedStake: cs, cashoutReceived: ca,
    ifWin: money(ifWin).toNumber(), ifLose: money(ifLose).toNumber(),
    exposure: money(Math.max(0, -Math.min(ifWin, ifLose))).toNumber(),
    avgBackOdds: bs > 0 ? 1 + bw / bs : null,
    avgLayOdds: ls > 0 ? 1 + lw / ls : null,
  };
}

export type Outcome = "win" | "lose" | "void";

export function settlePosition(executions: Execution[], outcome: Outcome, commission = 0): number {
  const p = position(executions);
  if (outcome === "void") return money(p.cashoutReceived - p.cashedStake).toNumber();
  let pnl = outcome === "win" ? p.ifWin : p.ifLose;
  if (pnl > 0) pnl *= 1 - commission;
  return money(pnl).toNumber();
}

export interface GreenUp {
  /** 'lay' when the position is long the selection, 'back' when short. */
  side: "back" | "lay" | null;
  odds: number;
  stake: number;
  /** Locked P/L in both outcomes after the hedge, before commission. */
  lockedPnl: number;
}

/**
 * Equal-profit hedge at the current price ("green up"/"cash out" on an exchange).
 * Long: lay h = (win − lose) / layOdds. Short: back h = (lose − win) / backOdds.
 */
export function greenUp(executions: Execution[], prices: { back?: number | null; lay?: number | null }): GreenUp | null {
  const p = position(executions);
  const diff = p.ifWin - p.ifLose;
  if (Math.abs(diff) < 0.005) return { side: null, odds: 0, stake: 0, lockedPnl: p.ifLose };
  if (diff > 0) {
    if (!prices.lay || prices.lay <= 1) return null;
    const h = diff / prices.lay;
    return { side: "lay", odds: prices.lay, stake: money(h).toNumber(), lockedPnl: money(p.ifLose + h).toNumber() };
  }
  if (!prices.back || prices.back <= 1) return null;
  const h = -diff / prices.back;
  return { side: "back", odds: prices.back, stake: money(h).toNumber(), lockedPnl: money(p.ifLose - h).toNumber() };
}

/** Unrealised (mark-to-market) P/L: the locked P/L available by hedging now. */
export function unrealisedPnl(executions: Execution[], prices: { back?: number | null; lay?: number | null }): number | null {
  return greenUp(executions, prices)?.lockedPnl ?? null;
}
