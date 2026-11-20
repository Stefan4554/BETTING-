import "server-only";
import type { AppContext } from "./context";
import type { Tables } from "@/lib/supabase/database.types";
import { FxTable } from "@/lib/finance/fx";
import type { BetRecord } from "@/lib/finance/metrics";
import { position, type Execution } from "@/lib/finance/trading";

export const BET_SELECT =
  "*, sports(name,key), leagues(name), bookmakers(name,key), strategies(name,color), bankrolls(name,currency), bet_legs(*)";

export type BetRow = Tables<"bets"> & {
  sports: { name: string; key: string } | null;
  leagues: { name: string } | null;
  bookmakers: { name: string; key: string } | null;
  strategies: { name: string; color: string } | null;
  bankrolls: { name: string; currency: string } | null;
  bet_legs: Tables<"bet_legs">[];
};

const PAGE = 1000;
const MAX_ROWS = 50_000;

/** All non-deleted bets of the active workspace (paged past PostgREST's 1000-row cap). */
export async function loadBets(ctx: AppContext, opts: { from?: Date | null; to?: Date | null; status?: string[] } = {}): Promise<BetRow[]> {
  const out: BetRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q = ctx.sb.from("bets").select(BET_SELECT).eq("is_demo", ctx.isDemo).is("deleted_at", null)
      .order("placed_at", { ascending: false }).order("ref", { ascending: false }).range(offset, offset + PAGE - 1);
    if (opts.from) q = q.gte("placed_at", opts.from.toISOString());
    if (opts.to) q = q.lt("placed_at", opts.to.toISOString());
    if (opts.status?.length) q = q.in("status", opts.status as never);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as BetRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function loadFx(ctx: AppContext): Promise<FxTable> {
  const { data } = await ctx.sb.from("exchange_rates").select("base,quote,rate,as_of").order("as_of").limit(20000);
  return new FxTable((data ?? []).map((r) => ({ base: r.base, quote: r.quote, rate: Number(r.rate), asOf: r.as_of })));
}

export interface Converted { records: BetRecord[]; unconverted: number; currency: string }

/**
 * Convert bets into analysis records in the display currency.
 * bet currency → bankroll currency uses the rate locked on the bet at placement;
 * bankroll currency → display currency uses the historical snapshot on the placement date.
 */
export function toRecords(rows: BetRow[], fx: FxTable, displayCurrency: string): Converted {
  let unconverted = 0;
  const records: BetRecord[] = [];
  for (const b of rows) {
    const brCcy = b.bankrolls?.currency ?? b.currency;
    const toDisplay = fx.rate(brCcy, displayCurrency, b.placed_at.slice(0, 10));
    if (toDisplay == null) { unconverted++; continue; }
    const k = Number(b.fx_rate) * toDisplay;
    records.push({
      id: b.id, ref: b.ref, placedAt: b.placed_at, settledAt: b.settled_at, status: b.status, side: b.side, kind: b.kind,
      odds: Number(b.odds), stake: Number(b.stake) * k, liability: Number(b.liability) * k,
      profit: b.profit == null ? null : Number(b.profit) * k,
      estProbability: b.est_probability == null ? null : Number(b.est_probability),
      openingOdds: b.opening_odds == null ? null : Number(b.opening_odds),
      closingOdds: b.closing_odds == null ? null : Number(b.closing_odds),
      isLive: b.is_live, sport: b.sports?.name ?? "Other", league: b.leagues?.name ?? null,
      bookmaker: b.bookmakers?.name ?? null, strategy: b.strategies?.name ?? null, market: b.market,
      marketCategory: b.market_category, eventName: b.event_name, eventId: b.event_id, correlationGroup: b.correlation_group,
      bankrollId: b.bankroll_id, tags: b.tags,
    });
  }
  return { records, unconverted, currency: displayCurrency };
}

export type TradeRow = Tables<"trades"> & { trade_executions: Tables<"trade_executions">[]; sports: { name: string } | null; bookmakers: { name: string } | null };

export async function loadTrades(ctx: AppContext): Promise<TradeRow[]> {
  const { data, error } = await ctx.sb.from("trades").select("*, trade_executions(*), sports(name), bookmakers(name)")
    .eq("is_demo", ctx.isDemo).order("opened_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TradeRow[];
}

export function executionsOf(t: TradeRow): Execution[] {
  return [...t.trade_executions].sort((a, b) => a.executed_at.localeCompare(b.executed_at))
    .map((e) => ({ side: e.side, odds: e.odds == null ? null : Number(e.odds), stake: Number(e.stake), amount: e.amount == null ? null : Number(e.amount), executedAt: e.executed_at }));
}

export function openTradeExposures(trades: TradeRow[], fx: FxTable, ctx: AppContext) {
  return trades.filter((t) => t.status === "open").map((t) => {
    const br = ctx.bankrolls.find((b) => b.id === t.bankroll_id);
    const k = Number(t.fx_rate) * (fx.rate(br?.currency ?? t.currency, ctx.displayCurrency) ?? 1);
    return { id: t.id, eventName: t.event_name, sport: t.sports?.name ?? "Other", exposure: position(executionsOf(t)).exposure * k };
  });
}

export async function loadTransactions(ctx: AppContext, bankrollId?: string, limit = 5000) {
  let q = ctx.sb.from("bankroll_transactions").select("*").eq("is_demo", ctx.isDemo).order("occurred_at", { ascending: true }).order("id").limit(limit);
  if (bankrollId) q = q.eq("bankroll_id", bankrollId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadRiskLimits(ctx: AppContext) {
  const { data } = await ctx.sb.from("risk_limits").select("*").eq("is_demo", ctx.isDemo).maybeSingle();
  return data;
}

/** Sum of bankroll equity (cash + reserved stakes) in display currency. */
export function bankrollTotals(ctx: AppContext, fx: FxTable, pendingReserved: Map<string, number>) {
  let balance = 0, reserved = 0, missing = 0;
  for (const b of ctx.bankrolls.filter((x) => !x.archived)) {
    const r = fx.rate(b.currency, ctx.displayCurrency);
    if (r == null) { missing++; continue; }
    balance += Number(b.balance) * r;
    reserved += (pendingReserved.get(b.id) ?? 0) * r;
  }
  return { balance, reserved, equity: balance + reserved, missing };
}
