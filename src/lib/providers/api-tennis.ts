/**
 * API-Tennis adapter — https://api-tennis.com/documentation
 *
 * Auth: `APIkey` query parameter (server-side only).
 * Base: https://api.api-tennis.com/tennis/?method=<method>&APIkey=<key>
 * Methods used: get_fixtures, get_livescore, get_standings.
 */
import { z } from "zod";
import type { Match, Player, SetScore, Tournament } from "../domain";
import { requestJson } from "./http";
import { statusFromApiTennis, tourFromText } from "./normalize";

export const API_TENNIS_ID = "api_tennis";
const BASE = "https://api.api-tennis.com/tennis/";

const strOrNum = z.union([z.string(), z.number()]).transform(String);

const Fixture = z.object({
  event_key: strOrNum,
  event_date: z.string(),
  event_time: z.string().nullish(),
  event_first_player: z.string(),
  first_player_key: strOrNum,
  event_second_player: z.string(),
  second_player_key: strOrNum,
  event_final_result: z.string().nullish(),
  event_game_result: z.string().nullish(),
  event_serve: z.string().nullish(),
  event_winner: z.string().nullish(),
  event_status: z.string().nullish(),
  event_type_type: z.string().nullish(),
  tournament_name: z.string().nullish(),
  tournament_key: strOrNum.nullish(),
  tournament_round: z.string().nullish(),
  event_live: strOrNum.nullish(),
  scores: z.array(z.object({ score_first: strOrNum, score_second: strOrNum, score_set: strOrNum })).nullish(),
});
export const FixturesSchema = z.object({ success: z.number(), result: z.array(Fixture).default([]) });
type AtFixture = z.infer<typeof Fixture>;

export function normalizeFixture(f: AtFixture, fetchedAt: string): Match {
  const tour = tourFromText(f.event_type_type ?? "");
  const p = (key: string, name: string): Player => ({
    id: `at:${key}`, name, countryCode: null, tour, rank: null, rankingPoints: null, birthDate: null, handedness: null, heightCm: null,
  });
  const tournament: Tournament = {
    id: `at:${f.tournament_key ?? "unknown"}`,
    name: f.tournament_name ?? "Unknown tournament",
    tour, level: null, surface: "unknown", countryCode: null, startDate: null, endDate: null, bestOf: null,
  };
  const sets: SetScore[] = (f.scores ?? [])
    .sort((a, b) => Number(a.score_set) - Number(b.score_set))
    .map((s) => ({ a: parseInt(s.score_first, 10) || 0, b: parseInt(s.score_second, 10) || 0 }));
  const game = f.event_game_result && f.event_game_result.includes("-")
    ? (() => {
        const [a, b] = f.event_game_result!.split("-").map((x) => x.trim());
        return { a: a ?? "0", b: b ?? "0" };
      })()
    : null;
  const time = f.event_time && /^\d{2}:\d{2}$/.test(f.event_time) ? f.event_time : "00:00";
  return {
    id: `at:${f.event_key}`,
    sport: "tennis",
    tournament,
    round: f.tournament_round ?? null,
    playerA: p(f.first_player_key, f.event_first_player),
    playerB: p(f.second_player_key, f.event_second_player),
    // API-Tennis returns local times; we record them as UTC and flag via source.updatedAt=null.
    scheduledAt: new Date(`${f.event_date}T${time}:00Z`).toISOString(),
    status: statusFromApiTennis(f.event_status, f.event_live == null ? null : String(f.event_live)),
    bestOf: null,
    surface: "unknown",
    score: sets.length || game ? { sets, game, server: f.event_serve === "First Player" ? "a" : f.event_serve === "Second Player" ? "b" : null } : null,
    winner: f.event_winner === "First Player" ? "a" : f.event_winner === "Second Player" ? "b" : null,
    source: { provider: API_TENNIS_ID, fetchedAt, updatedAt: null },
  };
}

export interface ApiTennisConfig {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class ApiTennis {
  constructor(private readonly cfg: ApiTennisConfig) {}

  private req<T>(method: string, params: Record<string, string>, ttlMs: number) {
    const u = new URL(BASE);
    u.searchParams.set("method", method);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("APIkey", this.cfg.apiKey);
    return requestJson<T>({ provider: API_TENNIS_ID, url: u.toString(), ttlMs, rateLimitPerMinute: 60, fetchImpl: this.cfg.fetchImpl });
  }

  async fixtures(dateStart: string, dateStop: string) {
    const r = await this.req<unknown>("get_fixtures", { date_start: dateStart, date_stop: dateStop }, 2 * 60_000);
    const parsed = FixturesSchema.parse(r.data);
    return parsed.result.map((f) => normalizeFixture(f, r.fetchedAt));
  }

  async livescore() {
    const r = await this.req<unknown>("get_livescore", {}, 10_000);
    const parsed = FixturesSchema.parse(r.data);
    return parsed.result.map((f) => normalizeFixture(f, r.fetchedAt));
  }
}
