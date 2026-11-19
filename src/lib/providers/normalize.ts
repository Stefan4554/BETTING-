import type { MatchStatus, Surface, Tour, Tournament } from "../domain";

export function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Grand Slams have a known surface and format; other events stay "unknown" unless the provider says. */
const SLAMS: { match: RegExp; name: string; surface: Surface }[] = [
  { match: /aus(tralian)?[ _]open/i, name: "Australian Open", surface: "hard" },
  { match: /french[ _]open|roland/i, name: "Roland Garros", surface: "clay" },
  { match: /wimbledon/i, name: "Wimbledon", surface: "grass" },
  { match: /us[ _]open/i, name: "US Open", surface: "hard" },
];

export function tournamentFromTitle(id: string, title: string, tour: Tour): Tournament {
  const slam = SLAMS.find((s) => s.match.test(id) || s.match.test(title));
  const men = /atp/i.test(id) || /atp/i.test(title);
  return {
    id: `t:${slug(id)}`,
    name: title,
    tour: slam ? "grand_slam" : tour,
    level: slam ? "grand_slam" : null,
    surface: slam?.surface ?? "unknown",
    countryCode: null,
    startDate: null,
    endDate: null,
    bestOf: slam ? (men ? 5 : 3) : null,
  };
}

export function surfaceFrom(raw: string | null | undefined): Surface {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("indoor")) return "indoor_hard";
  if (s.includes("clay") || s.includes("red_clay") || s.includes("green_clay")) return "clay";
  if (s.includes("grass")) return "grass";
  if (s.includes("carpet")) return "carpet";
  if (s.includes("hard")) return "hard";
  return "unknown";
}

export function statusFromSportradar(status?: string | null, matchStatus?: string | null): MatchStatus {
  const ms = (matchStatus ?? "").toLowerCase();
  if (ms === "retired") return "retired";
  if (ms === "walkover") return "walkover";
  switch ((status ?? "").toLowerCase()) {
    case "not_started": return "scheduled";
    case "live": return "live";
    case "closed":
    case "ended": return "completed";
    case "interrupted": return "interrupted";
    case "suspended": return "suspended";
    case "delayed": return "delayed";
    case "postponed": return "postponed";
    case "cancelled":
    case "abandoned": return "cancelled";
    default: return "unknown";
  }
}

export function statusFromApiTennis(status: string | null | undefined, live: string | null | undefined): MatchStatus {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "finished") return "completed";
  if (s.startsWith("retired")) return "retired";
  if (s.includes("walk over") || s === "walkover") return "walkover";
  if (s === "cancelled") return "cancelled";
  if (s === "postponed") return "postponed";
  if (s === "interrupted") return "interrupted";
  if (s === "suspended") return "suspended";
  if (live === "1" || /^set \d/.test(s)) return "live";
  if (s === "") return "scheduled";
  return "unknown";
}

export function tourFromText(text: string): Tour {
  const t = text.toLowerCase();
  if (t.includes("challenger")) return "challenger";
  if (t.includes("itf") && t.includes("women")) return "itf_women";
  if (t.includes("itf")) return "itf_men";
  if (t.includes("wta")) return "wta";
  if (t.includes("atp")) return "atp";
  return "other";
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
