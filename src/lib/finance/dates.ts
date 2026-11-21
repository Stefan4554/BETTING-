/**
 * Date handling for analytics: date basis (placed / event start / settlement), time-zone
 * aware day boundaries and presets. Ranges are half-open [from, to) instants computed from
 * local midnights in the user's IANA time zone, so "Today" means the user's day, not UTC's.
 */
export type DateBasis = "placed" | "event" | "settled";
export type RangePreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "mtd" | "last_month" | "ytd" | "all" | "custom";

export interface DateRange { from: Date | null; to: Date | null; basis: DateBasis; timeZone: string }

export const BASIS_LABEL: Record<DateBasis, string> = { placed: "bet placed date", event: "event start date", settled: "settlement date" };
export const PRESET_LABEL: Record<Exclude<RangePreset, "custom">, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days",
  mtd: "This month", last_month: "Last month", ytd: "This year", all: "All time",
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(at: Date, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(at)) o[p.type] = p.value;
  return { y: +o.year!, m: +o.month!, d: +o.day!, h: +o.hour!, mi: +o.minute!, s: +o.second!, wd: o.weekday! };
}

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
const safeTz = (tz: string | undefined) => (tz && isValidTimeZone(tz) ? tz : "UTC");

/** Offset of `tz` from UTC at instant `at`, in ms (e.g. +3_600_000 for CET in winter). */
export function tzOffsetMs(at: Date, tz: string): number {
  const p = parts(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight y-m-d in tz (DST-safe; days may roll over via Date.UTC). */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);   // second pass corrects across DST changes
  return new Date(t);
}

export function zonedYMD(at: Date, tz: string) {
  const p = parts(at, safeTz(tz));
  return { y: p.y, m: p.m, d: p.d, dow: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.wd) };
}

/** Local calendar date YYYY-MM-DD of an instant. */
export function localDateKey(iso: string | Date, tz = "UTC"): string {
  const { y, m, d } = zonedYMD(typeof iso === "string" ? new Date(iso) : iso, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function resolveRange(preset: RangePreset, now = new Date(), custom?: { from?: string | null; to?: string | null }, timeZone = "UTC", basis: DateBasis = "placed"): DateRange {
  const tz = safeTz(timeZone);
  const { y, m, d } = zonedYMD(now, tz);
  const mid = (dd: number, mm = m, yy = y) => zonedMidnight(yy, mm, dd, tz);
  const r = (from: Date | null, to: Date | null): DateRange => ({ from, to, basis, timeZone: tz });
  switch (preset) {
    case "today": return r(mid(d), mid(d + 1));
    case "yesterday": return r(mid(d - 1), mid(d));
    case "7d": return r(mid(d - 6), mid(d + 1));
    case "30d": return r(mid(d - 29), mid(d + 1));
    case "90d": return r(mid(d - 89), mid(d + 1));
    case "mtd": return r(mid(1), mid(d + 1));
    case "last_month": return r(mid(1, m - 1), mid(1));
    case "ytd": return r(zonedMidnight(y, 1, 1, tz), mid(d + 1));
    case "all": return r(null, null);
    case "custom": {
      const ymd = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").map(Number) as [number, number, number] : null);
      const f = ymd(custom?.from), t = ymd(custom?.to);
      return r(f ? zonedMidnight(f[0], f[1], f[2], tz) : null, t ? zonedMidnight(t[0], t[1], t[2] + 1, tz) : null);
    }
  }
}

/** The equally long window immediately before `r` (null for open-ended ranges). */
export function previousRange(r: DateRange): DateRange | null {
  if (!r.from || !r.to) return null;
  const len = r.to.getTime() - r.from.getTime();
  return { ...r, from: new Date(r.from.getTime() - len), to: new Date(r.from) };
}

export interface Dated { placedAt: string; settledAt: string | null; eventStart?: string | null; status?: string }

/**
 * The date of a bet under a basis, for FILTERING.
 *   placed → placement · event → event start (falls back to placement when unknown) ·
 *   settled → settlement (pending bets have none → excluded).
 */
export function basisDate(b: Dated, basis: DateBasis): string | null {
  if (basis === "placed") return b.placedAt;
  if (basis === "event") return b.eventStart ?? b.placedAt;
  return b.settledAt;
}

/** Bets that had to use a fallback (event basis without an event date). */
export const usesFallback = (b: Dated, basis: DateBasis) => basis === "event" && !b.eventStart;

/** Time used to ORDER settled bets on charts under a basis. */
export function basisTime(b: Dated, basis: DateBasis): string {
  if (basis === "placed") return b.placedAt;
  if (basis === "event") return b.eventStart ?? b.settledAt ?? b.placedAt;
  return b.settledAt ?? b.placedAt;
}

export function inRange(b: Dated, r: DateRange | { from: Date | null; to: Date | null }): boolean {
  const basis = (r as DateRange).basis ?? "placed";
  const iso = basisDate(b, basis);
  if (!iso) return !r.from && !r.to;   // pending under settlement basis: only in "All time"
  const t = Date.parse(iso);
  return (!r.from || t >= r.from.getTime()) && (!r.to || t < r.to.getTime());
}

export type Granularity = "day" | "week" | "month";

/** Period key in the user's time zone; weeks are ISO weeks starting Monday. */
export function periodKey(iso: string, g: Granularity, tz = "UTC"): string {
  const { y, m, d, dow } = zonedYMD(new Date(iso), tz);
  if (g === "day") return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (g === "month") return `${y}-${String(m).padStart(2, "0")}`;
  const monday = new Date(Date.UTC(y, m - 1, d - dow));
  return monday.toISOString().slice(0, 10);
}
