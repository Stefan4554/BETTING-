import { closingLineValue } from "./odds";

export type BetStatus = "pending" | "won" | "lost" | "void" | "half_won" | "half_lost" | "cashed_out";

export interface Bet {
  id: string;
  placedAt: string;
  settledAt?: string | null;
  sport: string;
  eventLabel: string;
  market: string;
  selection: string;
  bookmaker: string;
  odds: number;
  stake: number;
  closingOdds?: number | null;
  status: BetStatus;
  /** Only used for cashed_out bets, where the return is user-entered. */
  cashoutReturn?: number | null;
  notes?: string | null;
}

/** Mirrors the SQL trigger compute_bet_profit(). */
export function betProfit(b: Pick<Bet, "status" | "odds" | "stake" | "cashoutReturn">): number | null {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  switch (b.status) {
    case "won":
      return r2(b.stake * (b.odds - 1));
    case "lost":
      return -b.stake;
    case "void":
      return 0;
    case "half_won":
      return r2((b.stake / 2) * (b.odds - 1));
    case "half_lost":
      return r2(-b.stake / 2);
    case "cashed_out":
      return b.cashoutReturn != null ? r2(b.cashoutReturn - b.stake) : null;
    case "pending":
      return null;
  }
}

export interface PerformanceSummary {
  bets: number;
  settled: number;
  pending: number;
  totalStaked: number;
  profit: number;
  /** Profit / total settled stake. (Yield and ROI on turnover are the same measure.) */
  yield: number;
  /** Profit / starting bankroll, if provided. */
  roi: number | null;
  winRate: number;
  averageOdds: number;
  /** Mean CLV across bets that have a recorded closing price. */
  averageClv: number | null;
  clvSample: number;
}

export function summarize(bets: Bet[], startingBankroll?: number): PerformanceSummary {
  const settled = bets.filter((b) => b.status !== "pending");
  const decided = settled.filter((b) => b.status !== "void");
  const profit = settled.reduce((s, b) => s + (betProfit(b) ?? 0), 0);
  const staked = settled.reduce((s, b) => s + b.stake, 0);
  const wins = decided.filter((b) => b.status === "won" || b.status === "half_won").length;
  const clvBets = bets.filter((b) => b.closingOdds && b.closingOdds > 1);
  return {
    bets: bets.length,
    settled: settled.length,
    pending: bets.length - settled.length,
    totalStaked: staked,
    profit: Math.round(profit * 100) / 100,
    yield: staked ? profit / staked : 0,
    roi: startingBankroll ? profit / startingBankroll : null,
    winRate: decided.length ? wins / decided.length : 0,
    averageOdds: bets.length ? bets.reduce((s, b) => s + b.odds, 0) / bets.length : 0,
    averageClv: clvBets.length
      ? clvBets.reduce((s, b) => s + closingLineValue(b.odds, b.closingOdds!), 0) / clvBets.length
      : null,
    clvSample: clvBets.length,
  };
}

export function groupBy(bets: Bet[], key: (b: Bet) => string): Record<string, PerformanceSummary> {
  const groups: Record<string, Bet[]> = {};
  for (const b of bets) (groups[key(b)] ??= []).push(b);
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, summarize(v)]));
}

export type Period = "day" | "week" | "month";

function periodKey(iso: string, period: Period): string {
  const d = new Date(iso);
  if (period === "day") return d.toISOString().slice(0, 10);
  if (period === "month") return d.toISOString().slice(0, 7);
  // ISO week start (Monday), UTC
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

export function byPeriod(bets: Bet[], period: Period) {
  return groupBy(
    bets.filter((b) => b.status !== "pending"),
    (b) => periodKey(b.settledAt ?? b.placedAt, period),
  );
}

/** Running bankroll curve from settled bets in settlement order. */
export function bankrollCurve(bets: Bet[], starting: number): { at: string; bankroll: number; profit: number }[] {
  const settled = bets
    .filter((b) => b.status !== "pending")
    .sort((a, b) => Date.parse(a.settledAt ?? a.placedAt) - Date.parse(b.settledAt ?? b.placedAt));
  let bank = starting;
  return settled.map((b) => {
    const p = betProfit(b) ?? 0;
    bank += p;
    return { at: b.settledAt ?? b.placedAt, bankroll: Math.round(bank * 100) / 100, profit: p };
  });
}

const CSV_COLUMNS: (keyof Bet | "profit")[] = [
  "id", "placedAt", "settledAt", "sport", "eventLabel", "market", "selection", "bookmaker",
  "odds", "stake", "closingOdds", "status", "profit", "notes",
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Guard against CSV/formula injection when opened in spreadsheets.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function betsToCsv(bets: Bet[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const b of bets) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(c === "profit" ? betProfit(b) : b[c])).join(","));
  }
  return lines.join("\n");
}
