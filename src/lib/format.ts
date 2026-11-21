/** Display formatting. null/undefined/non-finite always render as an explicit missing marker. */
export const MISSING = "—";
const ok = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

export function fmtOdds(x: number | null | undefined, digits = 2) { return ok(x) ? x.toFixed(digits) : MISSING; }
export function fmtPct(x: number | null | undefined, digits = 1, signed = false) {
  if (!ok(x)) return MISSING;
  const s = (x * 100).toFixed(digits) + "%";
  return signed && x > 0 ? "+" + s : s;
}
export function fmtPp(x: number | null | undefined, digits = 2) {
  if (!ok(x)) return MISSING;
  return (x > 0 ? "+" : "") + (x * 100).toFixed(digits) + "pp";
}
export function fmtNum(x: number | null | undefined, digits = 0) {
  return ok(x) ? x.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : MISSING;
}
export function fmtMoney(x: number | null | undefined, ccy = "EUR", signed = false) {
  if (!ok(x)) return MISSING;
  const s = Math.abs(x).toLocaleString("en-GB", { style: "currency", currency: ccy, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (x < 0 && Math.abs(x) >= 0.005) return "−" + s;
  return signed && x >= 0.005 ? "+" + s : s;
}
export function fmtCompactMoney(x: number | null | undefined, ccy = "EUR") {
  if (!ok(x)) return MISSING;
  return x.toLocaleString("en-GB", { style: "currency", currency: ccy, notation: "compact", maximumFractionDigits: 1 });
}
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return MISSING;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
}
export function fmtTime(iso: string | null | undefined) {
  if (!iso) return MISSING;
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return MISSING;
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return MISSING;
  const raw = Math.round((now - Date.parse(iso)) / 1000);
  const s = Math.abs(raw);
  const v = s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
  return raw < 0 ? `in ${v}` : `${v} ago`;
}
export const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", won: "Won", lost: "Lost", void: "Void", half_won: "Half won", half_lost: "Half lost", cashed_out: "Cashed out",
  partial_win: "Partial win", partial_loss: "Partial loss", break_even: "Break-even",
};
export const TX_LABEL: Record<string, string> = {
  deposit: "Deposit", withdrawal: "Withdrawal", bet_placement: "Bet placed", bet_settlement: "Bet settled", cashout: "Cash-out",
  bet_reversal: "Reversal", transfer_in: "Transfer in", transfer_out: "Transfer out", adjustment: "Adjustment", trade_settlement: "Trade closed",
  trade_reservation: "Trade reservation", trade_cashout: "Trade partial close",
};
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "AUD", "CAD", "SEK", "NOK", "DKK", "PLN", "CZK", "JPY", "BRL", "INR", "NZD", "ZAR"];
