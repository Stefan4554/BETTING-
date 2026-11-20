import "server-only";
import type { AppContext } from "./context";
import { movements, type Snapshot } from "@/lib/finance/movement";
import { bestPriceArb } from "@/lib/finance/arbitrage";

export interface BoardQuote { bookmakerId: string; bookmaker: string; odds: number; opening: number; line: number | null; updatedAt: string; suspended: boolean; provider: string }
export interface BoardSelection { name: string; best: BoardQuote | null; quotes: BoardQuote[]; consensusProb: number | null; move: { direction: string; changePct: number; probShift: number; significant: boolean } | null }
export interface BoardMarket {
  id: string; key: string; name: string; line: number | null; selections: BoardSelection[]; bookmakers: string[];
  overround: Record<string, number>; arb: ReturnType<typeof bestPriceArb>; lastUpdated: string | null; history: { at: string; [book: string]: number | string }[] | null;
}
export interface BoardEvent { id: string; name: string; home: string | null; away: string | null; sportId: string; leagueId: string | null; sport: string; league: string | null; start: string; status: string; provider: string | null; isLive: boolean; markets: BoardMarket[] }

/** Odds comparison board from stored snapshots only — nothing is fabricated or interpolated. */
export async function loadOddsBoard(ctx: AppContext, opts: { sportId?: string; hoursBack?: number } = {}): Promise<{ events: BoardEvent[]; snapshotCount: number }> {
  const from = new Date(Date.now() - (opts.hoursBack ?? 6) * 3_600_000).toISOString();
  let q = ctx.sb.from("events").select("id, name, home, away, sport_id, league_id, start_time, status, provider, is_demo, sports(name), leagues(name), markets(id, key, name, line)")
    .eq("is_demo", ctx.isDemo).gte("start_time", from).order("start_time").limit(60);
  if (opts.sportId) q = q.eq("sport_id", opts.sportId);
  const { data: events } = await q;
  if (!events?.length) return { events: [], snapshotCount: 0 };
  const marketIds = events.flatMap((e) => (e.markets as { id: string }[]).map((m) => m.id));
  const snaps: { market_id: string; bookmaker_id: string; selection: string; line: number | null; odds: number; captured_at: string; suspended: boolean; is_live: boolean; provider: string; bookmakers: { name: string; default_commission: number } | null }[] = [];
  for (let i = 0; i < marketIds.length; i += 150) {
    for (let off = 0; off < 20000; off += 1000) {
      const { data } = await ctx.sb.from("odds_snapshots").select("market_id, bookmaker_id, selection, line, odds, captured_at, suspended, is_live, provider, bookmakers(name, default_commission)")
        .in("market_id", marketIds.slice(i, i + 150)).gte("captured_at", new Date(Date.now() - 72 * 3_600_000).toISOString()).order("captured_at").range(off, off + 999);
      snaps.push(...((data ?? []) as unknown as typeof snaps));
      if (!data || data.length < 1000) break;
    }
  }
  const bySel = new Map<string, typeof snaps>();
  for (const s of snaps) (bySel.get(s.market_id) ?? bySel.set(s.market_id, []).get(s.market_id)!).push(s);

  const out: BoardEvent[] = events.map((e) => {
    const markets: BoardMarket[] = (e.markets as { id: string; key: string; name: string; line: number | null }[]).map((m) => {
      const list = bySel.get(m.id) ?? [];
      const books = new Map<string, { name: string; comm: number }>();
      const latest = new Map<string, (typeof list)[number]>(), opening = new Map<string, (typeof list)[number]>();
      for (const s of list) {
        books.set(s.bookmaker_id, { name: s.bookmakers?.name ?? "?", comm: Number(s.bookmakers?.default_commission ?? 0) });
        const k = `${s.bookmaker_id}|${s.selection}`;
        if (!opening.has(k)) opening.set(k, s);
        latest.set(k, s);
      }
      const selNames = [...new Set(list.map((s) => s.selection))];
      const mv = movements(list.map<Snapshot>((s) => ({ marketId: m.id, bookmaker: s.bookmaker_id, selection: s.selection, line: s.line == null ? null : Number(s.line), odds: Number(s.odds), capturedAt: s.captured_at, suspended: s.suspended })));
      const selections: BoardSelection[] = selNames.map((name) => {
        const quotes = [...books.entries()].flatMap(([bid, b]) => {
          const l = latest.get(`${bid}|${name}`);
          if (!l) return [];
          return [{ bookmakerId: bid, bookmaker: b.name, odds: Number(l.odds), opening: Number(opening.get(`${bid}|${name}`)!.odds), line: l.line == null ? null : Number(l.line), updatedAt: l.captured_at, suspended: l.suspended, provider: l.provider }];
        });
        const live = quotes.filter((q) => !q.suspended);
        const best = live.length ? live.reduce((a, b) => (b.odds > a.odds ? b : a)) : null;
        const bm = mv.filter((x) => x.selection === name);
        const avgChange = bm.length ? bm.reduce((s, x) => s + x.changePct, 0) / bm.length : 0;
        const avgShift = bm.length ? bm.reduce((s, x) => s + x.probShift, 0) / bm.length : 0;
        return { name, best, quotes, consensusProb: null, move: bm.length ? { direction: avgChange <= -0.01 ? "shortening" : avgChange >= 0.01 ? "drifting" : "stable", changePct: avgChange, probShift: avgShift, significant: bm.some((x) => x.significant) } : null };
      });
      // Overround per book (complete books only) and no-vig consensus from complete books.
      const overround: Record<string, number> = {};
      const fair: number[][] = [];
      for (const [bid, b] of books) {
        const prices = selNames.map((n) => latest.get(`${bid}|${n}`));
        if (prices.some((p) => !p || p.suspended) || selNames.length < 2) continue;
        const inv = prices.map((p) => 1 / Number(p!.odds));
        const sum = inv.reduce((a, x) => a + x, 0);
        overround[b.name] = sum - 1;
        fair.push(inv.map((x) => x / sum));
      }
      if (fair.length) selections.forEach((s, i) => { s.consensusProb = fair.reduce((a, f) => a + f[i]!, 0) / fair.length; });
      const quotes = selections.flatMap((s) => s.quotes.filter((q) => !q.suspended).map((q) => ({ selection: s.name, bookmaker: q.bookmaker, odds: q.odds, commission: books.get(q.bookmakerId)?.comm ?? 0 })));
      const complete = (m.key === "h2h" || m.key === "totals" || m.key === "spreads" || m.key === "btts") && selNames.length >= 2;
      const arb = complete ? bestPriceArb(quotes, selNames, 100) : null;
      return {
        id: m.id, key: m.key, name: m.name, line: m.line == null ? null : Number(m.line), selections, bookmakers: [...books.values()].map((b) => b.name).sort(),
        overround, arb, lastUpdated: list.at(-1)?.captured_at ?? null, history: null,
      };
    }).filter((m) => m.selections.length);
    return { id: e.id, name: e.name, home: e.home, away: e.away, sportId: e.sport_id, leagueId: e.league_id, sport: (e.sports as { name: string } | null)?.name ?? "", league: (e.leagues as { name: string } | null)?.name ?? null, start: e.start_time,
      status: e.status, provider: e.provider, isLive: e.status === "live" || Date.parse(e.start_time) <= Date.now(), markets };
  }).filter((e) => e.markets.length);
  return { events: out, snapshotCount: snaps.length };
}

/** Full price history of one market for charting (per bookmaker, per selection). */
export async function loadMarketHistory(ctx: AppContext, marketId: string) {
  const { data } = await ctx.sb.from("odds_snapshots").select("selection, odds, captured_at, bookmakers(name)").eq("market_id", marketId).order("captured_at").limit(5000);
  return (data ?? []).map((s) => ({ selection: s.selection, odds: Number(s.odds), at: s.captured_at, bookmaker: (s.bookmakers as { name: string } | null)?.name ?? "?" }));
}
