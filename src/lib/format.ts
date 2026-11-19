/** Display formatting. `null`/`undefined` always render as an explicit missing marker. */
export const MISSING = "—";

export function fmtOdds(x: number | null | undefined) {
  return x == null ? MISSING : x.toFixed(2);
}
export function fmtPct(x: number | null | undefined, digits = 1, signed = false) {
  if (x == null || !Number.isFinite(x)) return MISSING;
  const s = (x * 100).toFixed(digits) + "%";
  return signed && x > 0 ? "+" + s : s;
}
export function fmtNum(x: number | null | undefined, digits = 0) {
  return x == null || !Number.isFinite(x) ? MISSING : x.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtMoney(x: number | null | undefined, ccy = "EUR") {
  if (x == null) return MISSING;
  return x.toLocaleString("en-GB", { style: "currency", currency: ccy, maximumFractionDigits: 2 });
}
export function fmtTime(iso: string | null | undefined) {
  if (!iso) return MISSING;
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + "Z";
}
export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return MISSING;
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) + " " + fmtTime(iso);
}
export function fmtAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return MISSING;
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export function ratio(a: number | null | undefined, b: number | null | undefined) {
  return a == null || b == null || b === 0 ? null : a / b;
}
export const SURFACE_LABEL: Record<string, string> = { hard: "Hard", clay: "Clay", grass: "Grass", indoor_hard: "Indoor", carpet: "Carpet", unknown: "Unknown" };
export const MARKET_LABEL: Record<string, string> = {
  match_winner: "Match winner", set_winner: "Set winner", game_handicap: "Game handicap", set_handicap: "Set handicap",
  total_games: "Total games", total_sets: "Total sets", correct_score: "Correct score", player_prop: "Player prop",
};
export const TOUR_LABEL: Record<string, string> = { atp: "ATP", wta: "WTA", challenger: "Challenger", itf_men: "ITF M", itf_women: "ITF W", grand_slam: "Grand Slam", other: "Other" };
