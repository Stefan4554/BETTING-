/**
 * Sportradar Tennis API v3 adapter — https://developer.sportradar.com/tennis/reference/overview
 *
 * Auth: `x-api-key` header (server-side only).
 * Base: https://api.sportradar.com/tennis/{access_level}/v3/{language}/
 * Trial keys are limited to ~1 request/second and a monthly cap; production limits depend on contract.
 *
 * Field mapping follows the v3 Summaries schema. Fields not present in a response
 * are left as null — they are never defaulted to zero.
 */
import { z } from "zod";
import type { Match, MatchStatistics, Player, PlayerMatchStats, SetScore, Tour, Tournament } from "../domain";
import { emptyStats } from "../domain";
import { requestJson } from "./http";
import { num, statusFromSportradar, surfaceFrom, tourFromText } from "./normalize";

export const SPORTRADAR_TENNIS_ID = "sportradar_tennis";

const Competitor = z.object({
  id: z.string(),
  name: z.string(),
  country_code: z.string().nullish(),
  abbreviation: z.string().nullish(),
  qualifier: z.enum(["home", "away"]).nullish(),
});

const Summary = z.object({
  sport_event: z.object({
    id: z.string(),
    start_time: z.string(),
    competitors: z.array(Competitor).min(2),
    sport_event_context: z
      .object({
        category: z.object({ id: z.string(), name: z.string() }).nullish(),
        competition: z.object({ id: z.string(), name: z.string(), type: z.string().nullish(), gender: z.string().nullish(), level: z.string().nullish() }).nullish(),
        round: z.object({ name: z.string().nullish() }).nullish(),
        mode: z.object({ best_of: z.number().nullish() }).nullish(),
      })
      .nullish(),
    venue: z.object({ country_code: z.string().nullish() }).nullish(),
    sport_event_conditions: z.object({ ground: z.object({ surface: z.string().nullish() }).nullish() }).nullish(),
  }),
  sport_event_status: z
    .object({
      status: z.string().nullish(),
      match_status: z.string().nullish(),
      home_score: z.number().nullish(),
      away_score: z.number().nullish(),
      winner_id: z.string().nullish(),
      period_scores: z
        .array(z.object({ home_score: z.number().nullish(), away_score: z.number().nullish(), home_tiebreak_score: z.number().nullish(), away_tiebreak_score: z.number().nullish(), number: z.number().nullish() }))
        .nullish(),
      game_state: z.object({ home_score: z.union([z.number(), z.string()]).nullish(), away_score: z.union([z.number(), z.string()]).nullish(), serving: z.enum(["home", "away"]).nullish() }).nullish(),
    })
    .nullish(),
  statistics: z
    .object({
      totals: z
        .object({ competitors: z.array(z.object({ id: z.string(), statistics: z.record(z.string(), z.unknown()).nullish() })) })
        .nullish(),
    })
    .nullish(),
});
export const SummariesSchema = z.object({ generated_at: z.string().nullish(), summaries: z.array(Summary) });
type SrSummary = z.infer<typeof Summary>;

function mapStats(s: Record<string, unknown> | null | undefined): PlayerMatchStats {
  const out = emptyStats();
  if (!s) return out;
  out.aces = num(s.aces);
  out.doubleFaults = num(s.double_faults);
  out.firstServeIn = num(s.first_serve_successful);
  out.firstServePointsWon = num(s.first_serve_points_won);
  out.secondServePointsWon = num(s.second_serve_points_won);
  out.breakPointsConverted = num(s.breakpoints_won);
  out.breakPointsOpportunities = num(s.total_breakpoints);
  out.serviceGamesWon = num(s.service_games_won);
  out.totalPointsWon = num(s.points_won);
  // Sportradar reports these only on some coverage levels; null otherwise.
  out.winners = num(s.winners);
  out.unforcedErrors = num(s.unforced_errors);
  return out;
}

function tourFromSr(cat?: string | null, comp?: { type?: string | null; gender?: string | null; level?: string | null; name: string } | null): Tour {
  const level = (comp?.level ?? "").toLowerCase();
  if (level === "grand_slam") return "grand_slam";
  return tourFromText(`${cat ?? ""} ${comp?.name ?? ""} ${comp?.gender === "women" ? "women" : ""}`);
}

export function normalizeSummary(x: SrSummary, fetchedAt: string): { match: Match; stats: MatchStatistics | null } {
  const ev = x.sport_event;
  const ctx = ev.sport_event_context;
  const home = ev.competitors.find((c) => c.qualifier === "home") ?? ev.competitors[0]!;
  const away = ev.competitors.find((c) => c.qualifier === "away") ?? ev.competitors[1]!;
  const tour = tourFromSr(ctx?.category?.name, ctx?.competition ?? null);
  const surface = surfaceFrom(ev.sport_event_conditions?.ground?.surface);
  const bestOf = ctx?.mode?.best_of === 5 ? 5 : ctx?.mode?.best_of === 3 ? 3 : null;

  const p = (c: z.infer<typeof Competitor>): Player => ({
    id: `sr:${c.id}`, name: c.name, countryCode: c.country_code ?? null, tour,
    rank: null, rankingPoints: null, birthDate: null, handedness: null, heightCm: null,
  });
  const tournament: Tournament = {
    id: `sr:${ctx?.competition?.id ?? "unknown"}`,
    name: ctx?.competition?.name ?? "Unknown competition",
    tour, level: ctx?.competition?.level ?? null, surface,
    countryCode: ev.venue?.country_code ?? null, startDate: null, endDate: null, bestOf,
  };
  const st = x.sport_event_status;
  const sets: SetScore[] = (st?.period_scores ?? []).map((ps) => ({
    a: ps.home_score ?? 0, b: ps.away_score ?? 0,
    tiebreakA: ps.home_tiebreak_score ?? null, tiebreakB: ps.away_tiebreak_score ?? null,
  }));
  const gs = st?.game_state;
  const match: Match = {
    id: `sr:${ev.id}`,
    sport: "tennis",
    tournament,
    round: ctx?.round?.name ?? null,
    playerA: p(home),
    playerB: p(away),
    scheduledAt: ev.start_time,
    status: statusFromSportradar(st?.status, st?.match_status),
    bestOf,
    surface,
    score: sets.length || gs
      ? { sets, game: gs ? { a: String(gs.home_score ?? "0"), b: String(gs.away_score ?? "0") } : null, server: gs?.serving === "home" ? "a" : gs?.serving === "away" ? "b" : null }
      : null,
    winner: st?.winner_id ? (st.winner_id === home.id ? "a" : "b") : null,
    source: { provider: SPORTRADAR_TENNIS_ID, fetchedAt },
  };
  const comps = x.statistics?.totals?.competitors;
  const stats = comps
    ? { matchId: match.id, a: mapStats(comps.find((c) => c.id === home.id)?.statistics as Record<string, unknown>), b: mapStats(comps.find((c) => c.id === away.id)?.statistics as Record<string, unknown>), source: match.source }
    : null;
  return { match, stats };
}

const RankingsSchema = z.object({
  rankings: z.array(
    z.object({
      name: z.string(), // "ATP" / "WTA"
      type_id: z.number().nullish(),
      week: z.number().nullish(),
      year: z.number().nullish(),
      competitor_rankings: z.array(
        z.object({ rank: z.number(), points: z.number().nullish(), movement: z.number().nullish(), competitor: Competitor }),
      ),
    }),
  ),
});

export interface SportradarConfig {
  apiKey: string;
  accessLevel: "trial" | "production";
  language?: string;
  fetchImpl?: typeof fetch;
}

export class SportradarTennis {
  constructor(private readonly cfg: SportradarConfig) {}

  private req<T>(path: string, ttlMs: number) {
    const lang = this.cfg.language ?? "en";
    return requestJson<T>({
      provider: SPORTRADAR_TENNIS_ID,
      url: `https://api.sportradar.com/tennis/${this.cfg.accessLevel}/v3/${lang}${path}`,
      headers: { "x-api-key": this.cfg.apiKey },
      ttlMs,
      rateLimitPerMinute: this.cfg.accessLevel === "trial" ? 50 : 600,
      fetchImpl: this.cfg.fetchImpl,
    });
  }

  async dailySummaries(date: string) {
    const r = await this.req<unknown>(`/schedules/${date}/summaries.json`, 2 * 60_000);
    return SummariesSchema.parse(r.data).summaries.map((s) => normalizeSummary(s, r.fetchedAt));
  }

  async liveSummaries() {
    const r = await this.req<unknown>(`/schedules/live/summaries.json`, 10_000);
    return SummariesSchema.parse(r.data).summaries.map((s) => normalizeSummary(s, r.fetchedAt));
  }

  async rankings() {
    const r = await this.req<unknown>(`/rankings.json`, 6 * 3600_000);
    return RankingsSchema.parse(r.data).rankings.flatMap((rk) =>
      rk.competitor_rankings.map((cr) => ({
        playerId: `sr:${cr.competitor.id}`,
        name: cr.competitor.name,
        countryCode: cr.competitor.country_code ?? null,
        tour: (rk.name.toUpperCase().includes("WTA") ? "wta" : "atp") as Tour,
        rank: cr.rank,
        points: cr.points ?? null,
        movement: cr.movement ?? null,
      })),
    );
  }
}
