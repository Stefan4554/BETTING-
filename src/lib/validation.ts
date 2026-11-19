import { z } from "zod";

export const BetInput = z.object({
  eventLabel: z.string().trim().min(1).max(200),
  sport: z.enum(["tennis", "football", "basketball", "ice_hockey"]).default("tennis"),
  market: z.enum(["match_winner", "set_winner", "game_handicap", "set_handicap", "total_games", "total_sets", "correct_score", "player_prop"]).default("match_winner"),
  selection: z.string().trim().min(1).max(120),
  bookmaker: z.string().trim().min(1).max(80),
  odds: z.coerce.number().gt(1).lt(1001),
  stake: z.coerce.number().gt(0).lt(1_000_000),
  closingOdds: z.coerce.number().gt(1).lt(1001).nullish(),
  status: z.enum(["pending", "won", "lost", "void", "half_won", "half_lost", "cashed_out"]).default("pending"),
  placedAt: z.string().datetime({ offset: true }).optional(),
  matchId: z.string().max(120).nullish(),
  notes: z.string().max(1000).nullish(),
});
export type BetInput = z.infer<typeof BetInput>;

export const BetPatch = BetInput.partial().extend({ id: z.string().uuid() });

export const AlertRuleInput = z.object({
  type: z.enum(["odds_move_pct", "best_odds_available", "value_edge_threshold", "market_change", "match_start", "match_status_change", "model_probability_change"]),
  threshold: z.coerce.number().min(0).max(1000).nullish(),
  matchId: z.string().max(120).nullish(),
  channels: z.array(z.enum(["in_app", "email"])).min(1).default(["in_app"]),
  cooldownMinutes: z.coerce.number().int().min(1).max(10080).default(30),
  active: z.boolean().default(true),
});
