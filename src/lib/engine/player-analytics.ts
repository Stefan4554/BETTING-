/**
 * Player analytics computed from completed-match history. Pure functions.
 * Any metric whose inputs are missing returns null so the UI can say "not available".
 */
import type { Surface } from "../domain";

export interface HistRecord {
  id: string;
  date: string;
  surface: Surface;
  winnerId: string;
  loserId: string;
  winnerRankAtTime: number | null;
  loserRankAtTime: number | null;
  sets: { w: number; l: number; tb: boolean }[];
  durationMin: number | null;
  svc?: { w: { held: number; played: number }; l: { held: number; played: number } } | null;
}

export interface WL {
  wins: number;
  losses: number;
  pct: number | null;
}

const wl = (wins: number, losses: number): WL => ({ wins, losses, pct: wins + losses ? wins / (wins + losses) : null });

export interface PlayerAnalytics {
  playerId: string;
  matches: number;
  overall: WL;
  bySurface: Record<string, WL>;
  last5: WL;
  last10: WL;
  last20: WL;
  form: ("W" | "L")[]; // most recent first
  byOpponentRank: Record<"top10" | "11-50" | "51-100" | "100+" | "unranked", WL>;
  /** Favourite determined by ranking at time of match (closing odds not stored for history). */
  asFavourite: WL;
  asUnderdog: WL;
  holdPct: number | null;
  breakPct: number | null;
  tiebreaks: WL;
  workload: { matchesLast7d: number; matchesLast14d: number; minutesLast7d: number | null; setsLast7d: number; daysSinceLastMatch: number | null };
}

function rankBand(r: number | null): keyof PlayerAnalytics["byOpponentRank"] {
  if (r === null) return "unranked";
  if (r <= 10) return "top10";
  if (r <= 50) return "11-50";
  if (r <= 100) return "51-100";
  return "100+";
}

export function playerAnalytics(playerId: string, history: HistRecord[], now = new Date()): PlayerAnalytics {
  const mine = history
    .filter((m) => (m.winnerId === playerId || m.loserId === playerId) && Date.parse(m.date) <= now.getTime())
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  const won = (m: HistRecord) => m.winnerId === playerId;
  const count = (ms: HistRecord[]) => wl(ms.filter(won).length, ms.filter((m) => !won(m)).length);

  const bySurface: Record<string, WL> = {};
  for (const s of ["hard", "clay", "grass", "indoor_hard"] as const) bySurface[s] = count(mine.filter((m) => m.surface === s));

  const byOpp = { top10: wl(0, 0), "11-50": wl(0, 0), "51-100": wl(0, 0), "100+": wl(0, 0), unranked: wl(0, 0) };
  const fav = { w: 0, l: 0 };
  const dog = { w: 0, l: 0 };
  let held = 0, svcPlayed = 0, broke = 0, retPlayed = 0, svcKnown = false;
  let tbW = 0, tbL = 0;

  for (const m of mine) {
    const iWon = won(m);
    const myRank = iWon ? m.winnerRankAtTime : m.loserRankAtTime;
    const oppRank = iWon ? m.loserRankAtTime : m.winnerRankAtTime;
    const band = rankBand(oppRank);
    const b = byOpp[band];
    byOpp[band] = wl(b.wins + (iWon ? 1 : 0), b.losses + (iWon ? 0 : 1));
    if (myRank !== null && oppRank !== null && myRank !== oppRank) {
      const bucket = myRank < oppRank ? fav : dog;
      if (iWon) bucket.w++; else bucket.l++;
    }
    if (m.svc) {
      svcKnown = true;
      const me = iWon ? m.svc.w : m.svc.l;
      const opp = iWon ? m.svc.l : m.svc.w;
      held += me.held; svcPlayed += me.played;
      broke += opp.played - opp.held; retPlayed += opp.played;
    }
    for (const s of m.sets) {
      if (!s.tb) continue;
      const iWonSet = iWon ? s.w > s.l : s.l > s.w;
      if (iWonSet) tbW++; else tbL++;
    }
  }

  const since = (days: number) => mine.filter((m) => now.getTime() - Date.parse(m.date) <= days * 86_400_000);
  const last7 = since(7);
  const minutesKnown = last7.every((m) => m.durationMin !== null);

  return {
    playerId,
    matches: mine.length,
    overall: count(mine),
    bySurface,
    last5: count(mine.slice(0, 5)),
    last10: count(mine.slice(0, 10)),
    last20: count(mine.slice(0, 20)),
    form: mine.slice(0, 10).map((m) => (won(m) ? "W" : "L")),
    byOpponentRank: byOpp,
    asFavourite: wl(fav.w, fav.l),
    asUnderdog: wl(dog.w, dog.l),
    holdPct: svcKnown && svcPlayed ? held / svcPlayed : null,
    breakPct: svcKnown && retPlayed ? broke / retPlayed : null,
    tiebreaks: wl(tbW, tbL),
    workload: {
      matchesLast7d: last7.length,
      matchesLast14d: since(14).length,
      minutesLast7d: minutesKnown ? last7.reduce((s, m) => s + (m.durationMin ?? 0), 0) : null,
      setsLast7d: last7.reduce((s, m) => s + m.sets.length, 0),
      daysSinceLastMatch: mine[0] ? Math.floor((now.getTime() - Date.parse(mine[0].date)) / 86_400_000) : null,
    },
  };
}

export interface HeadToHead {
  aWins: number;
  bWins: number;
  bySurface: Record<string, { aWins: number; bWins: number }>;
  meetings: { id: string; date: string; surface: Surface; winner: "a" | "b"; score: string }[];
}

export function headToHead(aId: string, bId: string, history: HistRecord[]): HeadToHead {
  const ms = history
    .filter((m) => (m.winnerId === aId && m.loserId === bId) || (m.winnerId === bId && m.loserId === aId))
    .sort((x, y) => Date.parse(y.date) - Date.parse(x.date));
  const bySurface: HeadToHead["bySurface"] = {};
  for (const m of ms) {
    const s = (bySurface[m.surface] ??= { aWins: 0, bWins: 0 });
    if (m.winnerId === aId) s.aWins++; else s.bWins++;
  }
  return {
    aWins: ms.filter((m) => m.winnerId === aId).length,
    bWins: ms.filter((m) => m.winnerId === bId).length,
    bySurface,
    meetings: ms.slice(0, 10).map((m) => ({
      id: m.id, date: m.date, surface: m.surface, winner: m.winnerId === aId ? "a" : "b",
      score: m.sets.map((s) => (m.winnerId === aId ? `${s.w}-${s.l}` : `${s.l}-${s.w}`)).join(" "),
    })),
  };
}
