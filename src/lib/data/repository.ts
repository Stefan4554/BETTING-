import "server-only";
/**
 * Persistence for ingested provider data (service-role, server-only).
 * Writes normalized matches + odds snapshots so line history, closing odds and
 * model training data accumulate over time.
 */
import type { Match, OddsQuote, OddsSnapshot } from "../domain";
import type { HistoryMatch } from "../demo/generator";
import { supabaseAdmin } from "../supabase/server";
import { onUsage } from "../providers/http";

let usageHooked = false;
/** Mirror provider usage into api_logs when Supabase is configured. */
export function hookUsageLogging() {
  if (usageHooked) return;
  usageHooked = true;
  onUsage(async (r) => {
    const sb = supabaseAdmin();
    if (!sb || r.cacheHit) return;
    await sb.from("api_logs").insert({
      provider_id: r.provider, endpoint: r.endpoint, status_code: r.status, duration_ms: r.durationMs,
      cost_units: r.costUnits, cache_hit: r.cacheHit, error: r.error, requested_at: r.at,
    });
  });
}

async function upsertPlayer(sb: NonNullable<ReturnType<typeof supabaseAdmin>>, p: Match["playerA"], provider: string) {
  const { data, error } = await sb
    .from("players")
    .upsert({ full_name: p.name, country_code: p.countryCode, tour: p.tour, provider, provider_ref: p.id }, { onConflict: "provider,provider_ref" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Upsert a match (and its players/tournament). Returns the DB uuid. */
export async function upsertMatch(m: Match): Promise<string | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const provider = m.source.provider;
  const [a, b] = await Promise.all([upsertPlayer(sb, m.playerA, provider), upsertPlayer(sb, m.playerB, provider)]);
  const { data: t, error: te } = await sb
    .from("tournaments")
    .upsert({ name: m.tournament.name, tour: m.tournament.tour, level: m.tournament.level, surface: m.tournament.surface, best_of: m.tournament.bestOf, provider, provider_ref: m.tournament.id }, { onConflict: "provider,provider_ref" })
    .select("id")
    .single();
  if (te) throw te;
  const { data, error } = await sb
    .from("matches")
    .upsert({
      tournament_id: t.id, round: m.round, player_a_id: a, player_b_id: b, scheduled_at: m.scheduledAt, status: m.status,
      best_of: m.bestOf, surface: m.surface, winner_id: m.winner === "a" ? a : m.winner === "b" ? b : null,
      score: m.score, provider, provider_ref: m.id, data_updated_at: m.source.fetchedAt,
    }, { onConflict: "provider,provider_ref" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Append odds snapshots. Skips unchanged prices to keep the table lean. */
export async function insertOddsSnapshots(matchDbId: string, quotes: OddsQuote[], isLive: boolean): Promise<number> {
  const sb = supabaseAdmin();
  if (!sb || quotes.length === 0) return 0;
  const books = [...new Map(quotes.map((q) => [q.bookmaker, { id: q.bookmaker, name: q.bookmakerName }])).values()];
  await sb.from("bookmakers").upsert(books, { onConflict: "id", ignoreDuplicates: true });

  const marketKeys = [...new Map(quotes.map((q) => [`${q.market}|${q.line}`, { match_id: matchDbId, market: q.market, line: q.line }])).values()];
  const { data: markets, error } = await sb.from("betting_markets").upsert(marketKeys, { onConflict: "match_id,market,line,period" }).select("id,market,line");
  if (error) throw error;
  const marketId = (q: OddsQuote) => markets!.find((m) => m.market === q.market && (m.line === null ? q.line === null : Number(m.line) === q.line))?.id;

  const { data: latest } = await sb.from("odds_latest").select("market_id,bookmaker_id,selection,price").in("market_id", markets!.map((m) => m.id));
  const last = new Map((latest ?? []).map((l) => [`${l.market_id}|${l.bookmaker_id}|${l.selection}`, Number(l.price)]));

  const rows = quotes
    .map((q) => ({ market_id: marketId(q), bookmaker_id: q.bookmaker, selection: q.selection, price: q.odds, is_live: isLive, bookmaker_updated_at: q.updatedAt, provider: q.provider }))
    .filter((r) => r.market_id && last.get(`${r.market_id}|${r.bookmaker_id}|${r.selection}`) !== r.price);
  if (!rows.length) return 0;
  const { error: ie } = await sb.from("odds_snapshots").insert(rows);
  if (ie) throw ie;
  return rows.length;
}

/** Read stored odds history for a provider match id. */
export async function oddsHistory(provider: string, providerRef: string, sinceIso?: string): Promise<OddsSnapshot[] | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data: match } = await sb.from("matches").select("id").eq("provider", provider).eq("provider_ref", providerRef).maybeSingle();
  if (!match) return [];
  let q = sb
    .from("odds_snapshots")
    .select("price,selection,bookmaker_id,captured_at,bookmaker_updated_at,provider,betting_markets!inner(match_id,market,line),bookmakers(name)")
    .eq("betting_markets.match_id", match.id)
    .order("captured_at", { ascending: true })
    .limit(20000);
  if (sinceIso) q = q.gte("captured_at", sinceIso);
  const { data, error } = await q;
  if (error) throw error;
  type Row = { price: number; selection: string; bookmaker_id: string; captured_at: string; bookmaker_updated_at: string | null; provider: string; betting_markets: { market: OddsQuote["market"]; line: number | null }; bookmakers: { name: string } | null };
  return (data as unknown as Row[]).map((r) => ({
    bookmaker: r.bookmaker_id, bookmakerName: r.bookmakers?.name ?? r.bookmaker_id, market: r.betting_markets.market,
    line: r.betting_markets.line === null ? null : Number(r.betting_markets.line), selection: r.selection, selectionLabel: r.selection,
    odds: Number(r.price), updatedAt: r.bookmaker_updated_at ?? r.captured_at, capturedAt: r.captured_at, provider: r.provider,
  }));
}

/** Completed matches stored in the DB, for model training. */
export async function completedHistory(limit = 50000): Promise<HistoryMatch[] | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("matches")
    .select("id,scheduled_at,surface,best_of,player_a_id,player_b_id,winner_id,score,tournament_id,pa:players!matches_player_a_id_fkey(provider_ref),pb:players!matches_player_b_id_fkey(provider_ref)")
    .in("status", ["completed", "retired"])
    .not("winner_id", "is", null)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  // Ratings are keyed by provider player ref (e.g. "sr:competitor:123") so they line up with live matches.
  type Row = { id: string; scheduled_at: string; surface: HistoryMatch["surface"]; best_of: number | null; player_a_id: string; player_b_id: string; winner_id: string | null; score: unknown; tournament_id: string | null; pa: { provider_ref: string } | null; pb: { provider_ref: string } | null };
  return ((data ?? []) as unknown as Row[]).map((m) => {
    const aWon = m.winner_id === m.player_a_id;
    const refA = m.pa?.provider_ref ?? m.player_a_id;
    const refB = m.pb?.provider_ref ?? m.player_b_id;
    const sets = ((m.score as { sets?: { a: number; b: number }[] } | null)?.sets ?? []).map((s) => ({ w: aWon ? s.a : s.b, l: aWon ? s.b : s.a, tb: (s.a === 7 && s.b === 6) || (s.a === 6 && s.b === 7) }));
    return {
      id: m.id, date: m.scheduled_at, tournamentId: m.tournament_id ?? "", surface: m.surface, bestOf: (m.best_of ?? 3) as 3 | 5,
      winnerId: aWon ? refA : refB, loserId: aWon ? refB : refA, sets, durationMin: null,
      winnerRankAtTime: null, loserRankAtTime: null, svc: null,
    };
  });
}
