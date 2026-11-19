/**
 * DEMO DATA — deterministic synthetic dataset for demo mode only.
 *
 * Everything here is fictional: player names, tournaments and bookmakers are invented
 * so that no real person or bookmaker is attributed numbers they never produced.
 * Every object carries source.provider = "demo" and the UI shows a DEMO banner.
 */
import type {
  LiveScore, Match, MatchStatistics, MatchStatus, OddsQuote, OddsSnapshot, Player, PlayerMatchStats, Surface, Tour, Tournament,
} from "../domain";
import { expectedScore } from "../engine/elo";

export const DEMO_PROVIDER = "demo";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_M = ["Aron", "Bastien", "Corin", "Dario", "Emil", "Fabian", "Goran", "Henrik", "Ivo", "Jonas", "Kai", "Lior", "Matteo", "Nils", "Oskar", "Pavel", "Quentin", "Rafe", "Soren", "Tomas", "Ulrich", "Vito", "Wim", "Yannick"];
const FIRST_W = ["Alina", "Bianca", "Chiara", "Daria", "Elena", "Freya", "Greta", "Hana", "Ilse", "Jana", "Kira", "Lena", "Mila", "Nora", "Olga", "Petra", "Rhea", "Sara", "Tea", "Una", "Vera", "Wanda", "Yara", "Zoe"];
const LAST = ["Varga", "Lindqvist", "Moreau", "Castell", "Brenner", "Okafor", "Halvorsen", "Rinaldi", "Duarte", "Kovacs", "Novak", "Ferreira", "Sato", "Mahler", "Petrov", "Alonso", "Berg", "Costa", "Dahl", "Eriksen", "Fontaine", "Gallo", "Horvat", "Ivanov", "Jensen", "Keller", "Laurent", "Marin"];
const COUNTRIES = ["ESP", "FRA", "ITA", "GER", "SRB", "USA", "AUS", "ARG", "GBR", "SWE", "NOR", "CZE", "POL", "JPN", "CAN", "CRO"];

export const DEMO_BOOKMAKERS: { key: string; name: string; margin: number; sharp: boolean; noise: number }[] = [
  { key: "demo_sharpline", name: "Sharpline (demo)", margin: 0.025, sharp: true, noise: 0.004 },
  { key: "demo_exchange", name: "Exchange X (demo)", margin: 0.02, sharp: true, noise: 0.005 },
  { key: "demo_northbet", name: "Northbet (demo)", margin: 0.05, sharp: false, noise: 0.008 },
  { key: "demo_baseline", name: "Baseline Sports (demo)", margin: 0.055, sharp: false, noise: 0.01 },
  { key: "demo_courtside", name: "Courtside (demo)", margin: 0.06, sharp: false, noise: 0.01 },
  { key: "demo_matchpoint", name: "Matchpoint (demo)", margin: 0.065, sharp: false, noise: 0.012 },
  { key: "demo_topspin", name: "Topspin Bet (demo)", margin: 0.07, sharp: false, noise: 0.014 },
  { key: "demo_ace", name: "AceOdds (demo)", margin: 0.075, sharp: false, noise: 0.015 },
];

export interface DemoPlayer extends Player {
  strength: number;
  surfaceBias: Partial<Record<Surface, number>>;
}

export interface HistoryMatch {
  id: string;
  date: string;
  tournamentId: string;
  surface: Surface;
  bestOf: 3 | 5;
  winnerId: string;
  loserId: string;
  sets: { w: number; l: number; tb: boolean }[];
  durationMin: number | null;
  winnerRankAtTime: number | null;
  loserRankAtTime: number | null;
  /** Service/return aggregates per side (winner/loser). */
  svc: { w: { held: number; played: number }; l: { held: number; played: number } } | null;
}

export interface DemoDataset {
  generatedAt: string;
  players: DemoPlayer[];
  tournaments: Tournament[];
  history: HistoryMatch[];
  today: Match[];
  trueProb: Record<string, number>;
  stats: Record<string, MatchStatistics>;
  odds: Record<string, OddsSnapshot[]>;
  momentum: Record<string, { point: number; value: number }[]>;
}

function simulateMatch(r: () => number, pA: number, bestOf: 3 | 5) {
  // Convert match-level probability into an approximate per-set probability.
  const pSet = bestOf === 5 ? 0.5 + (pA - 0.5) * 0.75 : 0.5 + (pA - 0.5) * 0.82;
  const need = bestOf === 5 ? 3 : 2;
  const sets: { a: number; b: number; tb: boolean }[] = [];
  let wa = 0, wb = 0;
  while (wa < need && wb < need) {
    const aWins = r() < pSet;
    const loserGames = Math.floor(r() * 6);
    const tb = r() < 0.15;
    const set = tb ? { a: aWins ? 7 : 6, b: aWins ? 6 : 7, tb } : { a: aWins ? (loserGames === 5 ? 7 : 6) : loserGames, b: aWins ? loserGames : loserGames === 5 ? 7 : 6, tb };
    sets.push(set);
    if (aWins) wa++; else wb++;
  }
  return { aWon: wa > wb, sets };
}

function isoAt(base: Date, minutesOffset: number) {
  return new Date(base.getTime() + minutesOffset * 60_000).toISOString();
}

export function generateDemo(now = new Date()): DemoDataset {
  const daySeed = Math.floor(now.getTime() / 86_400_000);
  const r = rng(20261119);
  const generatedAt = now.toISOString();

  // Players --------------------------------------------------------------
  const players: DemoPlayer[] = [];
  const mkTour = (tour: Tour, firsts: string[]) => {
    for (let i = 0; i < 24; i++) {
      const strength = 1500 + r() * 330;
      const bias: Partial<Record<Surface, number>> = { clay: (r() - 0.5) * 120, grass: (r() - 0.5) * 120, hard: (r() - 0.5) * 60, indoor_hard: (r() - 0.5) * 80 };
      players.push({
        id: `demo:${tour}:${i}`,
        name: `${firsts[i]} ${LAST[(i * 7 + (tour === "wta" ? 3 : 0)) % LAST.length]}`,
        countryCode: COUNTRIES[Math.floor(r() * COUNTRIES.length)]!,
        tour,
        rank: null,
        rankingPoints: null,
        birthDate: new Date(Date.UTC(1993 + Math.floor(r() * 13), Math.floor(r() * 12), 1 + Math.floor(r() * 27))).toISOString().slice(0, 10),
        handedness: r() < 0.15 ? "left" : "right",
        heightCm: Math.round((tour === "atp" ? 178 : 168) + r() * 20),
        strength,
        surfaceBias: bias,
      });
    }
  };
  mkTour("atp", FIRST_M);
  mkTour("wta", FIRST_W);
  for (const tour of ["atp", "wta"] as const) {
    const ps = players.filter((p) => p.tour === tour).sort((a, b) => b.strength - a.strength);
    ps.forEach((p, i) => {
      p.rank = i * 3 + 1 + Math.floor(r() * 3);
      p.rankingPoints = Math.round(9000 * Math.exp(-i / 7) + 300);
    });
  }

  // Tournaments ----------------------------------------------------------
  const tdefs: [string, Tour, string, Surface, 3 | 5, string][] = [
    ["Demo Indoor Masters", "atp", "masters_1000", "indoor_hard", 3, "FRA"],
    ["Demo Indoor Open (W)", "wta", "wta_1000", "indoor_hard", 3, "CHN"],
    ["Demo Clay Classic", "atp", "500", "clay", 3, "ESP"],
    ["Demo Grass Championships", "wta", "500", "grass", 3, "GBR"],
    ["Demo Slam (hard)", "grand_slam", "grand_slam", "hard", 5, "AUS"],
    ["Demo Challenger Hard", "challenger", "challenger_125", "hard", 3, "USA"],
  ];
  const tournaments: Tournament[] = tdefs.map(([name, tour, level, surface, bestOf, cc], i) => ({
    id: `demo:t${i}`, name, tour, level, surface, countryCode: cc, startDate: null, endDate: null, bestOf,
  }));
  const surfaces: Surface[] = ["hard", "clay", "grass", "indoor_hard"];

  const effStrength = (p: DemoPlayer, s: Surface) => p.strength + (p.surfaceBias[s] ?? 0);

  // History (2 years) ----------------------------------------------------
  const history: HistoryMatch[] = [];
  const start = new Date(now.getTime() - 730 * 86_400_000);
  for (let d = 0; d < 728; d++) {
    const date = new Date(start.getTime() + d * 86_400_000);
    const surface = surfaces[Math.floor(d / 45) % surfaces.length]!;
    for (const tour of ["atp", "wta"] as const) {
      const pool = players.filter((p) => p.tour === tour);
      const n = 2 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        const a = pool[Math.floor(r() * pool.length)]!;
        let b = pool[Math.floor(r() * pool.length)]!;
        if (a.id === b.id) b = pool[(pool.indexOf(a) + 1) % pool.length]!;
        const bestOf: 3 | 5 = tour === "atp" && r() < 0.15 ? 5 : 3;
        const pA = expectedScore(effStrength(a, surface), effStrength(b, surface));
        const sim = simulateMatch(r, pA, bestOf);
        const [w, l] = sim.aWon ? [a, b] : [b, a];
        const sets = sim.sets.map((s) => (sim.aWon ? { w: s.a, l: s.b, tb: s.tb } : { w: s.b, l: s.a, tb: s.tb }));
        const games = sets.reduce((g, s) => g + s.w + s.l, 0);
        const svcW = Math.ceil(games / 2), svcL = Math.floor(games / 2);
        const breaksOfL = Math.max(0, Math.round(1 + r() * 2));
        const breaksOfW = Math.max(0, breaksOfL - 1 - Math.floor(r() * 2));
        history.push({
          id: `demo:h${history.length}`,
          date: isoAt(date, 600 + k * 120),
          tournamentId: tournaments[Math.floor(r() * tournaments.length)]!.id,
          surface,
          bestOf,
          winnerId: w.id,
          loserId: l.id,
          sets,
          durationMin: Math.round(games * (4.6 + r() * 1.2)),
          winnerRankAtTime: w.rank,
          loserRankAtTime: l.rank,
          svc: { w: { held: svcW - breaksOfW, played: svcW }, l: { held: svcL - breaksOfL, played: svcL } },
        });
      }
    }
  }

  // Today's slate --------------------------------------------------------
  const rd = rng(daySeed);
  const today: Match[] = [];
  const trueProb: Record<string, number> = {};
  const stats: Record<string, MatchStatistics> = {};
  const odds: Record<string, OddsSnapshot[]> = {};
  const momentum: Record<string, { point: number; value: number }[]> = {};
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const statusPlan: MatchStatus[] = [
    "completed", "completed", "completed", "completed", "completed", "retired",
    "live", "live", "live", "live", "suspended", "delayed",
    ...Array<MatchStatus>(16).fill("scheduled"),
  ];
  const used = new Set<string>();
  statusPlan.forEach((status, i) => {
    const t = tournaments[i % tournaments.length]!;
    const tourPool = players.filter((p) => (t.tour === "wta" ? p.tour === "wta" : t.tour === "grand_slam" ? p.tour === (i % 2 ? "atp" : "wta") : p.tour === "atp"));
    let a: DemoPlayer, b: DemoPlayer;
    let guard = 0;
    do {
      a = tourPool[Math.floor(rd() * tourPool.length)]!;
      b = tourPool[Math.floor(rd() * tourPool.length)]!;
    } while ((a.id === b.id || used.has(a.id) || used.has(b.id)) && ++guard < 50);
    used.add(a.id); used.add(b.id);
    const bestOf: 3 | 5 = t.tour === "grand_slam" && a.tour === "atp" ? 5 : 3;
    const nowMin = (now.getTime() - dayStart.getTime()) / 60_000;
    const scheduledMin =
      status === "completed" || status === "retired" ? nowMin - 300 + i * 25
      : status === "scheduled" ? nowMin + 30 + (i - 12) * 35
      : nowMin - 40 - i * 4;
    const id = `demo:m${daySeed}-${i}`;
    const p = expectedScore(effStrength(a, t.surface), effStrength(b, t.surface));
    trueProb[id] = p;

    let score: LiveScore | null = null;
    let winner: "a" | "b" | null = null;
    if (status !== "scheduled" && status !== "delayed") {
      const sim = simulateMatch(rd, p, bestOf);
      if (status === "completed") {
        score = { sets: sim.sets.map((s) => ({ a: s.a, b: s.b, tiebreakA: s.tb ? (s.a > s.b ? 7 : 4) : null, tiebreakB: s.tb ? (s.b > s.a ? 7 : 4) : null })), game: null, server: null };
        winner = sim.aWon ? "a" : "b";
      } else if (status === "retired") {
        const partial = sim.sets.slice(0, 1);
        score = { sets: [...partial.map((s) => ({ a: s.a, b: s.b })), { a: 2, b: 1 }], game: null, server: null };
        winner = "a";
      } else {
        const done = sim.sets.slice(0, Math.max(1, sim.sets.length - 1));
        const cur = { a: Math.floor(rd() * 5), b: Math.floor(rd() * 5) };
        const pts = ["0", "15", "30", "40"];
        score = { sets: [...done.map((s) => ({ a: s.a, b: s.b })), cur], game: { a: pts[Math.floor(rd() * 4)]!, b: pts[Math.floor(rd() * 4)]! }, server: rd() < 0.5 ? "a" : "b" };
      }
      const mk = (str: number): PlayerMatchStats => {
        const fsAtt = Math.round(40 + rd() * 40);
        const fsIn = Math.round(fsAtt * (0.55 + rd() * 0.15));
        const ssPlayed = fsAtt - fsIn;
        const svcPlayed = Math.round(8 + rd() * 6);
        const retPlayed = Math.round(8 + rd() * 6);
        const bpFaced = Math.round(rd() * 8);
        const bpOpp = Math.round(rd() * 9);
        const edge = (str - 1600) / 1000;
        return {
          aces: Math.round(rd() * 12), doubleFaults: Math.round(rd() * 5),
          firstServeIn: fsIn, firstServeAttempts: fsAtt,
          firstServePointsWon: Math.round(fsIn * (0.66 + edge * 0.2 + rd() * 0.1)), firstServePointsPlayed: fsIn,
          secondServePointsWon: Math.round(ssPlayed * (0.45 + edge * 0.2 + rd() * 0.1)), secondServePointsPlayed: ssPlayed,
          breakPointsSaved: Math.round(bpFaced * (0.5 + rd() * 0.4)), breakPointsFaced: bpFaced,
          breakPointsConverted: Math.round(bpOpp * (0.3 + rd() * 0.3)), breakPointsOpportunities: bpOpp,
          serviceGamesWon: Math.round(svcPlayed * (0.7 + rd() * 0.25)), serviceGamesPlayed: svcPlayed,
          returnGamesWon: Math.round(retPlayed * (0.1 + rd() * 0.25)), returnGamesPlayed: retPlayed,
          totalPointsWon: Math.round(60 + rd() * 50),
          // Winners/UE deliberately missing on some matches to exercise "not provided" UI.
          winners: i % 3 === 0 ? null : Math.round(15 + rd() * 25),
          unforcedErrors: i % 3 === 0 ? null : Math.round(12 + rd() * 25),
        };
      };
      stats[id] = { matchId: id, a: mk(a.strength), b: mk(b.strength), source: { provider: DEMO_PROVIDER, fetchedAt: generatedAt, updatedAt: generatedAt } };
      let m = 0;
      momentum[id] = Array.from({ length: 60 }, (_, k) => ({ point: k + 1, value: (m = Math.max(-10, Math.min(10, m + (rd() < p ? 1 : -1)))) }));
    }

    today.push({
      id,
      sport: "tennis",
      tournament: t,
      round: ["R64", "R32", "R16", "QF", "SF"][i % 5]!,
      playerA: stripDemo(a),
      playerB: stripDemo(b),
      scheduledAt: isoAt(dayStart, scheduledMin),
      status,
      bestOf,
      surface: t.surface,
      score,
      winner,
      source: { provider: DEMO_PROVIDER, fetchedAt: generatedAt, updatedAt: generatedAt },
    });

    // Odds history: 48 snapshots (every 30 min for the past 24h) per bookmaker ----------
    const snaps: OddsSnapshot[] = [];
    const steamAt = i % 4 === 0 ? 30 + Math.floor(rd() * 10) : -1; // inject a coordinated move in some markets
    const hasHistory = status !== "completed" && status !== "retired";
    const steps = hasHistory ? 48 : 40;
    const drift = (rd() - 0.5) * 0.05; // shared market drift over 24h
    for (const bk of DEMO_BOOKMAKERS) {
      let pa = p + (rd() - 0.5) * bk.noise * 2 - drift;
      const lineTotal = bestOf === 5 ? 38.5 : 22.5;
      const lineHcp = Math.round((p - 0.5) * 12) / 2 + 0.5 * Math.sign(p - 0.5 || 1);
      for (let s = 0; s < steps; s++) {
        pa += (rd() - 0.5) * 0.002 + drift / steps;
        if (s === steamAt) pa += 0.03 * (p > 0.5 ? 1 : -1);
        pa = Math.min(0.97, Math.max(0.03, pa));
        const at = new Date(now.getTime() - (steps - s) * 30 * 60_000).toISOString();
        const price = (q: number) => Math.max(1.01, Math.round((1 / (q * (1 + bk.margin))) * 100) / 100);
        const base = { bookmaker: bk.key, bookmakerName: bk.name, provider: DEMO_PROVIDER, updatedAt: at, capturedAt: at };
        snaps.push({ ...base, market: "match_winner", line: null, selection: "a", selectionLabel: a.name, odds: price(pa) });
        snaps.push({ ...base, market: "match_winner", line: null, selection: "b", selectionLabel: b.name, odds: price(1 - pa) });
        if (s % 4 === 0 || s === steps - 1) {
          const po = 0.5 + (rd() - 0.5) * 0.04;
          snaps.push({ ...base, market: "total_games", line: lineTotal, selection: "over", selectionLabel: `Over ${lineTotal}`, odds: price(po) });
          snaps.push({ ...base, market: "total_games", line: lineTotal, selection: "under", selectionLabel: `Under ${lineTotal}`, odds: price(1 - po) });
          const ph = 0.5 + (rd() - 0.5) * 0.04;
          snaps.push({ ...base, market: "game_handicap", line: -lineHcp, selection: "a", selectionLabel: `${a.name} ${-lineHcp > 0 ? "+" : ""}${-lineHcp}`, odds: price(ph) });
          snaps.push({ ...base, market: "game_handicap", line: lineHcp, selection: "b", selectionLabel: `${b.name} ${lineHcp > 0 ? "+" : ""}${lineHcp}`, odds: price(1 - ph) });
        }
      }
    }
    odds[id] = snaps;
  });

  return { generatedAt, players, tournaments, history, today, trueProb, stats, odds, momentum };
}

function stripDemo(p: DemoPlayer): Player {
  const { strength: _s, surfaceBias: _b, ...rest } = p;
  return rest;
}

/** Latest quote per (bookmaker, market, line, selection). */
export function latestQuotes(snaps: OddsSnapshot[]): OddsQuote[] {
  const m = new Map<string, OddsSnapshot>();
  for (const s of snaps) {
    const k = `${s.bookmaker}|${s.market}|${s.line}|${s.selection}`;
    const cur = m.get(k);
    if (!cur || cur.capturedAt < s.capturedAt) m.set(k, s);
  }
  return [...m.values()];
}

let cache: { day: number; data: DemoDataset } | null = null;
/** Cached per UTC hour so pages are consistent within a session. */
export function demoDataset(now = new Date()): DemoDataset {
  const key = Math.floor(now.getTime() / 3_600_000);
  if (!cache || cache.day !== key) cache = { day: key, data: generateDemo(new Date(key * 3_600_000 + 30 * 60_000)) };
  return cache.data;
}
