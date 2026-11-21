import { getContext } from "@/lib/server/context";
import { loadBets, loadTrades, loadTransactions } from "@/lib/server/data";
import { drawdown } from "@/lib/finance/metrics";
import { BankrollView, type BankrollStats } from "@/components/bankroll/bankroll";

export const metadata = { title: "Bankroll Manager" };

export default async function BankrollPage() {
  const ctx = await getContext();
  const [bets, trades, txs] = await Promise.all([loadBets(ctx), loadTrades(ctx), loadTransactions(ctx, undefined, 20000)]);
  const stats: BankrollStats[] = ctx.bankrolls.map((br) => {
    const myTx = txs.filter((t) => t.bankroll_id === br.id);
    const myBets = bets.filter((b) => b.bankroll_id === br.id);
    const myTrades = trades.filter((t) => t.bankroll_id === br.id);
    const sum = (types: string[]) => myTx.filter((t) => types.includes(t.type)).reduce((s, t) => s + Number(t.amount), 0);
    const pending = myBets.filter((b) => b.status === "pending");
    const reserved = pending.reduce((s, b) => s + (Number(b.liability) - Number(b.cashout_amount)) * Number(b.fx_rate), 0);
    const openTrades = myTrades.filter((t) => t.status === "open");
    const tradeExposure = openTrades.reduce((s, t) => s + Number(t.reserved_base), 0);
    const realizedOpen = openTrades.reduce((s, t) => s + Number(t.realized_partial_base), 0);
    const settled = myBets.filter((b) => b.status !== "pending");
    const pnlEvents = [
      ...settled.map((b) => ({ at: b.settled_at ?? b.placed_at, p: Number(b.profit) * Number(b.fx_rate) })),
      ...myTrades.filter((t) => t.status !== "open").map((t) => ({ at: t.closed_at ?? t.opened_at, p: Number(t.realized_pnl) * Number(t.fx_rate) })),
      ...openTrades.filter((t) => Number(t.realized_partial_base) !== 0).map((t) => ({ at: t.opened_at, p: Number(t.realized_partial_base) })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    let cum = 0;
    const path = pnlEvents.map((e) => ({ at: e.at, cum: (cum += e.p) }));
    const capital = sum(["deposit", "withdrawal", "transfer_in", "transfer_out", "adjustment"]);
    const dd = drawdown(path, capital);
    const firstCapital = myTx.find((t) => ["deposit", "transfer_in", "adjustment"].includes(t.type));
    const peakPnl = path.reduce((m, p) => Math.max(m, p.cum), 0);
    const balance = Number(br.balance);
    return {
      id: br.id, name: br.name, kind: br.kind, currency: br.currency, archived: br.archived, allowNegative: br.allow_negative,
      balance, reserved, tradeExposure, equity: balance + reserved + tradeExposure, available: balance, openExposure: reserved + tradeExposure, realizedOpenTrades: realizedOpen,
      starting: firstCapital ? Number(firstCapital.amount) : 0,
      deposits: sum(["deposit"]), withdrawals: -sum(["withdrawal"]), transfers: sum(["transfer_in", "transfer_out"]), adjustments: sum(["adjustment"]),
      capital, totalStaked: settled.reduce((s, b) => s + Number(b.stake) * Number(b.fx_rate), 0),
      totalReturn: settled.reduce((s, b) => s + Number(b.actual_payout ?? 0) * Number(b.fx_rate), 0),
      netProfit: cum, growth: capital > 0 ? cum / capital : null, peak: capital + peakPnl,
      currentDrawdown: dd.currentAmount, currentDrawdownPct: dd.currentPct, maxDrawdown: dd.maxAmount, maxDrawdownPct: dd.maxPct,
      pendingBets: pending.length, openTrades: myTrades.filter((t) => t.status === "open").length,
      series: myTx.map((t) => ({ at: t.occurred_at, balance: Number(t.balance_after) })),
      pnl: path.map((p) => ({ at: p.at, cum: Math.round(p.cum * 100) / 100 })),
    };
  });
  const transactions = txs.slice(-2000).reverse().map((t) => ({
    id: t.id, bankroll_id: t.bankroll_id, type: t.type, amount: Number(t.amount), balance_after: Number(t.balance_after), occurred_at: t.occurred_at,
    note: t.note, bet_id: t.bet_id, trade_id: t.trade_id, original: t.original_amount == null ? null : `${Number(t.original_amount).toFixed(2)} ${t.original_currency} @ ${t.fx_rate}`,
  }));
  return <BankrollView stats={stats} transactions={transactions} sports={ctx.sports.map((s) => ({ id: s.id, name: s.name }))} />;
}
