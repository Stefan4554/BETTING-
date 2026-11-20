/** Pure column mapping & row validation for CSV/Excel bet imports. */
import { parseOdds } from "@/lib/finance/odds";

export const FIELDS: { key: string; label: string; required?: boolean; synonyms: string[] }[] = [
  { key: "placed_at", label: "Date placed", required: true, synonyms: ["placed_at", "date", "placed", "datetime", "time", "bet date", "date placed"] },
  { key: "event_name", label: "Event", required: true, synonyms: ["event", "event_name", "match", "fixture", "game"] },
  { key: "home", label: "Home / player 1", synonyms: ["home", "home team", "player1", "player 1"] },
  { key: "away", label: "Away / player 2", synonyms: ["away", "away team", "player2", "player 2"] },
  { key: "sport_key", label: "Sport", synonyms: ["sport"] },
  { key: "market", label: "Market", synonyms: ["market", "bet type", "market type"] },
  { key: "selection", label: "Selection", required: true, synonyms: ["selection", "pick", "bet", "outcome", "tip"] },
  { key: "line", label: "Line / handicap", synonyms: ["line", "handicap", "points", "hcp"] },
  { key: "side", label: "Back / lay", synonyms: ["side", "back/lay", "type"] },
  { key: "odds", label: "Odds", required: true, synonyms: ["odds", "price", "decimal odds", "odds taken"] },
  { key: "stake", label: "Stake", required: true, synonyms: ["stake", "amount", "risk", "wager"] },
  { key: "currency", label: "Currency", synonyms: ["currency", "ccy"] },
  { key: "bookmaker", label: "Bookmaker", synonyms: ["bookmaker", "book", "sportsbook", "bookie", "site"] },
  { key: "commission", label: "Commission", synonyms: ["commission", "comm"] },
  { key: "status", label: "Result / status", synonyms: ["status", "result", "outcome status", "w/l", "settled"] },
  { key: "settled_at", label: "Settled at", synonyms: ["settled_at", "settled date", "settlement date"] },
  { key: "cashout_amount", label: "Cash-out amount", synonyms: ["cashout", "cash out", "cashout_amount", "cash-out"] },
  { key: "is_live", label: "Live?", synonyms: ["live", "in-play", "inplay", "is_live", "timing"] },
  { key: "est_probability", label: "Estimated probability", synonyms: ["probability", "est_probability", "prob", "my prob", "model prob"] },
  { key: "opening_odds", label: "Opening odds", synonyms: ["opening", "opening odds", "open"] },
  { key: "closing_odds", label: "Closing odds", synonyms: ["closing", "closing odds", "close", "cl"] },
  { key: "strategy_name", label: "Strategy", synonyms: ["strategy", "system"] },
  { key: "tags", label: "Tags", synonyms: ["tags", "labels"] },
  { key: "notes", label: "Notes", synonyms: ["notes", "comment", "comments"] },
];

const STATUS_MAP: Record<string, string> = {
  w: "won", win: "won", won: "won", winner: "won", l: "lost", loss: "lost", lose: "lost", lost: "lost", loser: "lost",
  v: "void", void: "void", push: "void", refund: "void", cancelled: "void", "half won": "half_won", half_won: "half_won", "half win": "half_won", hw: "half_won",
  "half lost": "half_lost", half_lost: "half_lost", "half loss": "half_lost", hl: "half_lost", "cashed out": "cashed_out", cashout: "cashed_out", cashed_out: "cashed_out", "cash out": "cashed_out",
  pending: "pending", open: "pending", "": "pending", unsettled: "pending",
};

export type Raw = Record<string, string>;
interface Mapped { row: number; payload: Record<string, unknown>; errors: string[] }

function parseProb(s: string): number | undefined {
  if (!s.trim()) return undefined;
  const v = Number(s.replace("%", "").replace(",", "."));
  if (!Number.isFinite(v)) return Number.NaN;
  return s.includes("%") || v > 1 ? v / 100 : v;
}
function parseDate(s: string): string | undefined {
  if (!s.trim()) return undefined;
  const dmY = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s.trim());
  const d = dmY ? new Date(Date.UTC(+dmY[3]!, +dmY[2]! - 1, +dmY[1]!, +(dmY[4] ?? 12), +(dmY[5] ?? 0))) : new Date(s);
  return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
}

export function mapRow(raw: Raw, mapping: Record<string, string>, row: number): Mapped {
  const g = (k: string) => (mapping[k] ? String(raw[mapping[k]!] ?? "").trim() : "");
  const errors: string[] = [];
  const p: Record<string, unknown> = { _row: row };
  const placed = parseDate(g("placed_at"));
  if (!placed || placed === "invalid") errors.push("invalid date"); else p.placed_at = placed;
  const settled = parseDate(g("settled_at"));
  if (settled && settled !== "invalid") p.settled_at = settled;
  p.event_name = g("event_name") || (g("home") && g("away") ? `${g("home")} v ${g("away")}` : "");
  if (!p.event_name) errors.push("event missing");
  for (const k of ["home", "away", "sport_key", "market", "selection", "bookmaker", "strategy_name", "notes"]) if (g(k)) p[k] = g(k);
  if (!g("selection")) errors.push("selection missing");
  try { p.odds = parseOdds(g("odds")); } catch { errors.push("invalid odds"); }
  const stake = Number(g("stake").replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!(stake > 0)) errors.push("invalid stake"); else p.stake = stake;
  if (g("line")) { const l = Number(g("line").replace(",", ".")); if (Number.isFinite(l)) p.line = l; else errors.push("invalid line"); }
  if (g("currency")) p.currency = g("currency").toUpperCase();
  if (g("side")) p.side = /lay/i.test(g("side")) ? "lay" : "back";
  if (g("commission")) { const c = parseProb(g("commission")); if (c == null || !(c >= 0 && c < 1)) errors.push("invalid commission"); else p.commission = c; }
  const st = STATUS_MAP[g("status").toLowerCase()];
  if (st === undefined) errors.push(`unknown status "${g("status")}"`); else p.status = st;
  if (st === "cashed_out") { const c = Number(g("cashout_amount")); if (!(c >= 0) || !g("cashout_amount")) errors.push("cash-out amount missing"); else p.cashout_amount = c; }
  if (g("is_live")) p.is_live = /^(1|y|yes|true|live|in-?play)$/i.test(g("is_live"));
  const prob = parseProb(g("est_probability"));
  if (prob !== undefined) { if (!(prob > 0 && prob < 1)) errors.push("invalid probability"); else p.est_probability = prob; }
  for (const k of ["opening_odds", "closing_odds"]) if (g(k)) { try { p[k] = parseOdds(g(k)); } catch { errors.push(`invalid ${k.replace("_", " ")}`); } }
  if (g("tags")) p.tags = g("tags").split(/[|;,]/).map((t) => t.trim()).filter(Boolean);
  return { row, payload: p, errors };
}

export function guessMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of FIELDS) {
    const h = headers.find((x) => f.synonyms.includes(x.trim().toLowerCase()));
    if (h) m[f.key] = h;
  }
  return m;
}

