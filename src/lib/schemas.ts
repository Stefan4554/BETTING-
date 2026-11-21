/** Validation schemas shared by forms (client) and server actions (authoritative). */
import { z } from "zod";

const num = (msg: string) => z.coerce.number({ message: msg }).refine(Number.isFinite, msg);
const optNum = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().optional());
const optStr = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().optional());
const optUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().uuid().optional());
const ccy = z.string().regex(/^[A-Z]{3}$/, "3-letter currency code");

export const betStatus = z.enum(["pending", "won", "lost", "void", "half_won", "half_lost", "cashed_out"]);
export const legStatus = z.enum(["pending", "won", "lost", "void", "half_won", "half_lost"]);

export const legSchema = z.object({
  event_name: z.string().trim().min(1, "Event required").max(300),
  market: optStr,
  selection: z.string().trim().min(1, "Selection required").max(200),
  line: optNum,
  odds: num("Odds required").refine((v) => v > 1, "Odds must be > 1"),
  status: legStatus.default("pending"),
});

export const betSchema = z.object({
  client_ref: optUuid,
  bankroll_id: z.string().uuid("Choose a bankroll"),
  placed_at: optStr,
  sport_id: z.string().uuid("Choose a sport"),
  league_id: optUuid,
  event_id: optUuid,
  market_id: optUuid,
  event_name: z.string().trim().min(1, "Event required").max(300),
  home: optStr,
  away: optStr,
  event_start: optStr,
  is_live: z.coerce.boolean().default(false),
  market_type_id: optUuid,
  market_category: optStr,
  market: z.string().trim().min(1, "Market required").max(120),
  selection: z.string().trim().max(200).default(""),
  line: optNum,
  side: z.enum(["back", "lay"]).default("back"),
  bookmaker_id: optUuid,
  odds: optNum,
  stake: num("Stake required").refine((v) => v > 0, "Stake must be > 0").refine((v) => v <= 10_000_000, "Stake too large"),
  currency: ccy.optional(),
  fx_rate: optNum.refine((v) => v == null || v > 0, "FX rate must be > 0"),
  commission: optNum.refine((v) => v == null || (v >= 0 && v < 1), "Commission is a fraction in [0, 1)"),
  est_probability: optNum.refine((v) => v == null || (v > 0 && v < 1), "Probability must be between 0 and 1"),
  opening_odds: optNum.refine((v) => v == null || v > 1, "Odds must be > 1"),
  closing_odds: optNum.refine((v) => v == null || v > 1, "Odds must be > 1"),
  strategy_id: optUuid,
  confidence: optNum.refine((v) => v == null || (Number.isInteger(v) && v >= 1 && v <= 5), "Confidence 1–5"),
  units: optNum.refine((v) => v == null || v > 0, "Units must be > 0"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  notes: z.string().max(4000).optional(),
  correlation_group: optStr,
  status: betStatus.default("pending"),
  cashout_amount: optNum.refine((v) => v == null || v >= 0, "Cash-out amount must be ≥ 0"),
  settled_at: optStr,
  legs: z.array(legSchema).max(30).default([]),
}).superRefine((b, ctx) => {
  if (b.legs.length === 1) ctx.addIssue({ code: "custom", path: ["legs"], message: "An accumulator needs at least 2 legs" });
  if (b.legs.length === 0) {
    if (b.odds == null || !(b.odds > 1)) ctx.addIssue({ code: "custom", path: ["odds"], message: "Odds must be > 1" });
    if (!b.selection) ctx.addIssue({ code: "custom", path: ["selection"], message: "Selection required" });
  } else if (b.side === "lay") ctx.addIssue({ code: "custom", path: ["side"], message: "Accumulators are back bets" });
  if (b.status === "cashed_out" && b.cashout_amount == null) ctx.addIssue({ code: "custom", path: ["cashout_amount"], message: "Enter the cash-out amount" });
  if (b.status === "cashed_out" && b.side === "lay") ctx.addIssue({ code: "custom", path: ["status"], message: "Lay bets cannot be cashed out" });
});
export type BetInput = z.input<typeof betSchema>;

export const settleSchema = z.object({
  bet_id: z.string().uuid(),
  status: betStatus.exclude(["pending"]).optional(),
  legs: z.array(z.object({ leg_no: z.number().int().min(1), status: legStatus })).optional(),
  closing_odds: optNum.refine((v) => v == null || v > 1, "Odds must be > 1"),
  cashout_amount: optNum.refine((v) => v == null || v >= 0, "Must be ≥ 0"),
  settled_at: optStr,
});

export const txSchema = z.object({
  bankroll_id: z.string().uuid(),
  type: z.enum(["deposit", "withdrawal", "adjustment"]),
  amount: num("Amount required").refine((v) => v !== 0, "Amount must be non-zero"),
  note: z.string().max(500).optional(),
  occurred_at: optStr,
}).refine((t) => t.type === "adjustment" || t.amount > 0, { path: ["amount"], message: "Amount must be positive" })
  .refine((t) => t.type !== "adjustment" || (t.note ?? "").trim().length > 0, { path: ["note"], message: "Adjustments need a note" });

export const transferSchema = z.object({
  from: z.string().uuid(), to: z.string().uuid(), amount: num("Amount required").refine((v) => v > 0, "Amount must be positive"),
  fx_rate: optNum, note: z.string().max(500).optional(),
}).refine((t) => t.from !== t.to, { path: ["to"], message: "Choose a different bankroll" });

export const bankrollSchema = z.object({
  name: z.string().trim().min(1).max(60), currency: ccy, kind: z.enum(["main", "sport", "live", "custom"]).default("custom"),
  sport_id: optUuid, opening_deposit: optNum.refine((v) => v == null || v >= 0, "Must be ≥ 0"), allow_negative: z.coerce.boolean().default(false),
});

export const strategySchema = z.object({
  id: optUuid,
  name: z.string().trim().min(1).max(80), description: z.string().max(4000).optional(), sport_id: optUuid, market_type_id: optUuid,
  entry_conditions: z.string().max(4000).optional(), min_odds: optNum, max_odds: optNum,
  est_probability: optNum.refine((v) => v == null || (v > 0 && v < 1), "0–1"),
  stake_type: z.enum(["flat", "percentage", "units", "kelly"]).default("flat"), stake_value: optNum,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#3987e5"), is_active: z.coerce.boolean().default(true),
}).refine((s) => s.min_odds == null || s.max_odds == null || s.min_odds <= s.max_odds, { path: ["max_odds"], message: "Max must be ≥ min" });

const optPos = optNum.refine((v) => v == null || v > 0, "Must be > 0");
const optFrac = optNum.refine((v) => v == null || (v > 0 && v <= 1), "Fraction in (0, 1]");
export const riskSchema = z.object({
  max_stake_per_bet: optPos, max_bet_pct_bankroll: optFrac, max_event_exposure: optPos, max_total_exposure_pct: optFrac,
  max_daily_loss: optPos, max_weekly_loss: optPos, max_drawdown_pct: optFrac, max_correlated_exposure: optPos, enforce: z.coerce.boolean().default(false),
});

export const tradeSchema = z.object({
  bankroll_id: z.string().uuid(), sport_id: z.string().uuid(), event_name: z.string().trim().min(1).max(300), market: z.string().trim().min(1).max(120),
  selection: z.string().trim().min(1).max(200), bookmaker_id: optUuid, commission: optNum.refine((v) => v == null || (v >= 0 && v < 1), "[0, 1)"),
  is_live: z.coerce.boolean().default(true), notes: z.string().max(4000).optional(), strategy_id: optUuid,
  side: z.enum(["back", "lay"]), odds: num("Odds").refine((v) => v > 1, "Odds > 1"), stake: num("Stake").refine((v) => v > 0, "Stake > 0"),
});

export const executionSchema = z.object({
  trade_id: z.string().uuid(), side: z.enum(["back", "lay", "cashout"]), odds: optNum, stake: num("Stake").refine((v) => v > 0, "Stake > 0"),
  amount: optNum, note: z.string().max(500).optional(),
}).refine((e) => e.side === "cashout" ? e.amount != null && e.amount >= 0 : e.odds != null && e.odds > 1, { path: ["odds"], message: "Odds > 1 (or amount for cash-out)" });
