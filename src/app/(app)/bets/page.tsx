import { getContext } from "@/lib/server/context";
import { loadBets } from "@/lib/server/data";
import { BetTracker, type BetView } from "@/components/bets/tracker";

export const metadata = { title: "Bet Tracker" };

export default async function BetsPage({ searchParams }: { searchParams: Promise<{ bet?: string; import?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const [rows, views] = await Promise.all([
    loadBets(ctx),
    ctx.sb.from("saved_views").select("id, name, config").eq("scope", "bets").order("name"),
  ]);
  const bets: BetView[] = rows.map((b) => ({
    id: b.id, ref: b.ref, placed_at: b.placed_at, settled_at: b.settled_at, status: b.status, kind: b.kind, side: b.side,
    sport_id: b.sport_id, sport: b.sports?.name ?? "Other", league_id: b.league_id, league: b.leagues?.name ?? null,
    event_name: b.event_name, home: b.home, away: b.away, event_start: b.event_start, is_live: b.is_live,
    market_type_id: b.market_type_id, market: b.market, market_category: b.market_category, selection: b.selection, line: b.line == null ? null : Number(b.line),
    bookmaker_id: b.bookmaker_id, bookmaker: b.bookmakers?.name ?? null, bankroll_id: b.bankroll_id, bankroll: b.bankrolls?.name ?? "",
    odds: Number(b.odds), stake: Number(b.stake), currency: b.currency, fx_rate: Number(b.fx_rate), commission: Number(b.commission),
    liability: Number(b.liability), potential_payout: Number(b.potential_payout), actual_payout: b.actual_payout == null ? null : Number(b.actual_payout),
    profit: b.profit == null ? null : Number(b.profit), cashout_amount: Number(b.cashout_amount), cashed_out_stake: Number(b.cashed_out_stake),
    est_probability: b.est_probability == null ? null : Number(b.est_probability), opening_odds: b.opening_odds == null ? null : Number(b.opening_odds),
    closing_odds: b.closing_odds == null ? null : Number(b.closing_odds), closing_source: b.closing_source,
    strategy_id: b.strategy_id, strategy: b.strategies?.name ?? null, confidence: b.confidence, units: b.units == null ? null : Number(b.units),
    tags: b.tags, notes: b.notes, correlation_group: b.correlation_group,
    legs: b.bet_legs.sort((x, y) => x.leg_no - y.leg_no).map((l) => ({ leg_no: l.leg_no, event_name: l.event_name, market: l.market, selection: l.selection, line: l.line == null ? null : Number(l.line), odds: Number(l.odds), status: l.status })),
  }));
  return <BetTracker bets={bets} views={(views.data ?? []) as { id: string; name: string; config: Record<string, unknown> }[]}
    convention={ctx.settings.clv_convention} focusBet={sp.bet} openImport={sp.import === "1"} truncated={rows.length >= 50_000} />;
}
