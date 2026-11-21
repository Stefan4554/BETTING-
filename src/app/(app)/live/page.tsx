import { getContext } from "@/lib/server/context";
import { executionsOf, loadTrades } from "@/lib/server/data";
import { loadOddsBoard } from "@/lib/server/odds";
import { LiveTrading } from "@/components/live/trading";

export const metadata = { title: "Live Trading" };

export default async function LivePage() {
  const ctx = await getContext();
  const [trades, board, conns] = await Promise.all([loadTrades(ctx), loadOddsBoard(ctx, { hoursBack: 4 }), ctx.sb.from("api_connections").select("id", { count: "exact", head: true })]);
  const liveEvents = board.events.filter((e) => e.isLive);
  // Latest stored back price for linked trades (best across books, h2h market).
  const priceFor = (eventId: string | null, selection: string) => {
    const ev = board.events.find((e) => e.id === eventId);
    const sel = ev?.markets.find((m) => m.key === "h2h")?.selections.find((s) => s.name.toLowerCase() === selection.toLowerCase());
    return sel?.best ? { odds: sel.best.odds, at: sel.best.updatedAt, source: sel.best.provider } : null;
  };
  return <LiveTrading isDemo={ctx.isDemo} hasProvider={(conns.count ?? 0) > 0}
    trades={trades.map((t) => ({
      id: t.id, event: t.event_name, event_id: t.event_id, market: t.market, selection: t.selection, sport: t.sports?.name ?? "", bookmaker: t.bookmakers?.name ?? null,
      bankroll_id: t.bankroll_id, currency: t.currency, commission: Number(t.commission), status: t.status, outcome: t.outcome, opened_at: t.opened_at, closed_at: t.closed_at,
      realized: t.realized_pnl == null ? null : Number(t.realized_pnl), reserved: Number(t.reserved), realizedPartial: Number(t.realized_partial), notes: t.notes, executions: executionsOf(t), price: priceFor(t.event_id, t.selection),
    }))}
    liveEvents={liveEvents.map((e) => ({ id: e.id, name: e.name, sport: e.sport, sportId: e.sportId, start: e.start, provider: e.provider,
      prices: (e.markets.find((m) => m.key === "h2h")?.selections ?? []).map((s) => ({ name: s.name, odds: s.best?.odds ?? null, book: s.best?.bookmaker ?? null, at: s.best?.updatedAt ?? null, move: s.move?.changePct ?? null })) }))} />;
}
