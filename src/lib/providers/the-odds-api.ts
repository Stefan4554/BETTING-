/**
 * The Odds API v4 adapter — https://the-odds-api.com/liveapi/guides/v4/
 *
 * Auth: `apiKey` query parameter (server-side only).
 * Quota: each call costs (#markets × #regions) credits; usage reported via
 *        x-requests-used / x-requests-remaining / x-requests-last headers.
 * Tennis sport keys are per tournament (e.g. tennis_atp_paris), so we first list
 * active sports in the "Tennis" group (that endpoint is free of quota cost).
 */
import { z } from "zod";
import type { Match, MarketKey, OddsQuote, Player, Tour } from "../domain";
import { requestJson } from "./http";
import { slug, tournamentFromTitle } from "./normalize";

export const ODDS_API_ID = "the_odds_api";
const BASE = "https://api.the-odds-api.com/v4";

const SportSchema = z.object({
  key: z.string(),
  group: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  active: z.boolean(),
  has_outrights: z.boolean().nullish(),
});

const OutcomeSchema = z.object({ name: z.string(), price: z.number(), point: z.number().nullish() });
const MarketSchema = z.object({ key: z.string(), last_update: z.string().nullish(), outcomes: z.array(OutcomeSchema) });
const BookmakerSchema = z.object({ key: z.string(), title: z.string(), last_update: z.string(), markets: z.array(MarketSchema) });
export const OddsEventSchema = z.object({
  id: z.string(),
  sport_key: z.string(),
  sport_title: z.string(),
  commence_time: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(BookmakerSchema).default([]),
});
export type OddsApiEvent = z.infer<typeof OddsEventSchema>;

export interface OddsApiConfig {
  apiKey: string;
  regions: string; // e.g. "eu,uk"
  markets: string; // e.g. "h2h,spreads,totals"
  fetchImpl?: typeof fetch;
}

const MARKET_MAP: Record<string, MarketKey> = {
  h2h: "match_winner",
  spreads: "game_handicap",
  totals: "total_games",
};

function tourFromSportKey(key: string): Tour {
  // Grand Slam detection happens in tournamentFromTitle().
  if (key.startsWith("tennis_atp")) return "atp";
  if (key.startsWith("tennis_wta")) return "wta";
  return "other";
}

function player(name: string, tour: Tour): Player {
  // The Odds API supplies names only. Everything else is explicitly unknown.
  return { id: `toa:${slug(name)}`, name, countryCode: null, tour, rank: null, rankingPoints: null, birthDate: null, handedness: null, heightCm: null };
}

export function normalizeOddsEvent(e: OddsApiEvent, fetchedAt: string): { match: Match; quotes: OddsQuote[] } {
  const tour = tourFromSportKey(e.sport_key);
  const a = player(e.home_team, tour);
  const b = player(e.away_team, tour);
  const t = tournamentFromTitle(e.sport_key, e.sport_title, tour);
  const started = Date.parse(e.commence_time) <= Date.parse(fetchedAt);
  const match: Match = {
    id: `toa:${e.id}`,
    sport: "tennis",
    tournament: t,
    round: null,
    playerA: a,
    playerB: b,
    scheduledAt: e.commence_time,
    // The odds feed has no score/status; past commence time we only know it has *probably* started.
    status: started ? "unknown" : "scheduled",
    bestOf: t.bestOf,
    surface: t.surface,
    score: null,
    winner: null,
    source: { provider: ODDS_API_ID, fetchedAt },
  };

  const quotes: OddsQuote[] = [];
  for (const bk of e.bookmakers) {
    for (const m of bk.markets) {
      const market = MARKET_MAP[m.key];
      if (!market) continue;
      for (const o of m.outcomes) {
        let selection: string;
        if (m.key === "totals") selection = o.name.toLowerCase() === "over" ? "over" : "under";
        else selection = o.name === e.home_team ? "a" : o.name === e.away_team ? "b" : slug(o.name);
        quotes.push({
          bookmaker: bk.key,
          bookmakerName: bk.title,
          market,
          line: o.point ?? null,
          selection,
          selectionLabel: m.key === "totals" ? `${o.name} ${o.point ?? ""}`.trim() : o.point != null ? `${o.name} ${o.point > 0 ? "+" : ""}${o.point}` : o.name,
          odds: o.price,
          updatedAt: m.last_update ?? bk.last_update,
          provider: ODDS_API_ID,
        });
      }
    }
  }
  return { match, quotes };
}

export class TheOddsApi {
  constructor(private readonly cfg: OddsApiConfig) {}

  private url(path: string, params: Record<string, string> = {}) {
    const u = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("apiKey", this.cfg.apiKey);
    return u.toString();
  }

  private req<T>(path: string, params: Record<string, string>, ttlMs: number) {
    return requestJson<T>({
      provider: ODDS_API_ID,
      url: this.url(path, params),
      ttlMs,
      rateLimitPerMinute: 30,
      costHeader: "x-requests-last",
      quotaHeaders: { used: "x-requests-used", remaining: "x-requests-remaining" },
      fetchImpl: this.cfg.fetchImpl,
    });
  }

  /** Active tennis tournaments (no quota cost). */
  async tennisSports() {
    const r = await this.req<unknown>("/sports", {}, 30 * 60_000);
    return z.array(SportSchema).parse(r.data).filter((s) => s.group === "Tennis" && s.active);
  }

  async oddsForSport(sportKey: string) {
    const r = await this.req<unknown>(`/sports/${encodeURIComponent(sportKey)}/odds`, {
      regions: this.cfg.regions,
      markets: this.cfg.markets,
      oddsFormat: "decimal",
      dateFormat: "iso",
    }, 5 * 60_000);
    const events = z.array(OddsEventSchema).parse(r.data);
    return events.map((e) => normalizeOddsEvent(e, r.fetchedAt));
  }

  /** All active tennis events with odds. Costs credits per active tournament. */
  async tennisOdds() {
    const sports = await this.tennisSports();
    const results = await Promise.allSettled(sports.map((s) => this.oddsForSport(s.key)));
    return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  }
}
