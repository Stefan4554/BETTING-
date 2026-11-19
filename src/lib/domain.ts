/**
 * Normalized domain model shared by providers, demo data, the data service and the UI.
 * Provider adapters translate raw responses into these shapes. `null` always means
 * "the source did not provide this" and must be rendered as missing — never as 0.
 */

export type Sport = "tennis" | "football" | "basketball" | "ice_hockey";
export type Surface = "hard" | "clay" | "grass" | "indoor_hard" | "carpet" | "unknown";
export type Tour = "atp" | "wta" | "challenger" | "itf_men" | "itf_women" | "grand_slam" | "other";
export type MatchStatus =
  | "scheduled" | "live" | "suspended" | "interrupted" | "delayed"
  | "completed" | "retired" | "walkover" | "cancelled" | "postponed" | "unknown";
export type MarketKey =
  | "match_winner" | "set_winner" | "game_handicap" | "set_handicap"
  | "total_games" | "total_sets" | "correct_score" | "player_prop";

export const LIVE_STATUSES: MatchStatus[] = ["live", "suspended", "interrupted", "delayed"];
export const FINISHED_STATUSES: MatchStatus[] = ["completed", "retired", "walkover"];

/** Where a piece of data came from and when. Required on everything shown to users. */
export interface Source {
  provider: string; // provider id, or "demo"
  fetchedAt: string;
  updatedAt?: string | null; // provider's own timestamp, if given
}

export interface Player {
  id: string;
  name: string;
  countryCode: string | null;
  tour: Tour | null;
  rank: number | null;
  rankingPoints: number | null;
  birthDate: string | null;
  handedness: "right" | "left" | null;
  heightCm: number | null;
}

export interface Tournament {
  id: string;
  name: string;
  tour: Tour;
  level: string | null;
  surface: Surface;
  countryCode: string | null;
  startDate: string | null;
  endDate: string | null;
  bestOf: 3 | 5 | null;
}

export interface SetScore {
  a: number;
  b: number;
  tiebreakA?: number | null;
  tiebreakB?: number | null;
}

export interface LiveScore {
  sets: SetScore[];
  game: { a: string; b: string } | null; // "0","15","30","40","A"
  server: "a" | "b" | null;
}

export interface Match {
  id: string;
  sport: Sport;
  tournament: Tournament;
  round: string | null;
  playerA: Player;
  playerB: Player;
  scheduledAt: string;
  status: MatchStatus;
  bestOf: 3 | 5 | null;
  surface: Surface;
  score: LiveScore | null;
  winner: "a" | "b" | null;
  source: Source;
}

/** Per-player match statistics. Every numeric field is nullable = not provided. */
export interface PlayerMatchStats {
  aces: number | null;
  doubleFaults: number | null;
  firstServeIn: number | null;
  firstServeAttempts: number | null;
  firstServePointsWon: number | null;
  firstServePointsPlayed: number | null;
  secondServePointsWon: number | null;
  secondServePointsPlayed: number | null;
  breakPointsSaved: number | null;
  breakPointsFaced: number | null;
  breakPointsConverted: number | null;
  breakPointsOpportunities: number | null;
  serviceGamesWon: number | null;
  serviceGamesPlayed: number | null;
  returnGamesWon: number | null;
  returnGamesPlayed: number | null;
  totalPointsWon: number | null;
  winners: number | null;
  unforcedErrors: number | null;
}

export interface MatchStatistics {
  matchId: string;
  a: PlayerMatchStats;
  b: PlayerMatchStats;
  source: Source;
}

export interface OddsQuote {
  bookmaker: string;
  bookmakerName: string;
  market: MarketKey;
  line: number | null;
  selection: string; // "a" | "b" | "over" | "under" | score
  selectionLabel: string;
  odds: number;
  updatedAt: string; // bookmaker last update
  provider: string;
}

export interface OddsSnapshot extends OddsQuote {
  capturedAt: string;
}

export interface MatchOdds {
  matchId: string;
  quotes: OddsQuote[];
  source: Source;
}

export type ProviderStatus = "connected" | "not_connected" | "error" | "not_implemented";

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "odds" | "sports_data";
  status: ProviderStatus;
  statusDetail: string;
  envVar: string;
  subscription: string;
  docsUrl: string;
  capabilities: string[];
  usage?: { used: number | null; remaining: number | null; lastRequestAt: string | null; lastError: string | null };
}

export function emptyStats(): PlayerMatchStats {
  return {
    aces: null, doubleFaults: null, firstServeIn: null, firstServeAttempts: null,
    firstServePointsWon: null, firstServePointsPlayed: null, secondServePointsWon: null,
    secondServePointsPlayed: null, breakPointsSaved: null, breakPointsFaced: null,
    breakPointsConverted: null, breakPointsOpportunities: null, serviceGamesWon: null,
    serviceGamesPlayed: null, returnGamesWon: null, returnGamesPlayed: null,
    totalPointsWon: null, winners: null, unforcedErrors: null,
  };
}
