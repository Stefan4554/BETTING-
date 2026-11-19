import "server-only";
/**
 * Data service: the single entry point pages and API routes use.
 *
 * - DEMO mode (NEXT_PUBLIC_DEMO_MODE=true): synthetic, clearly-labelled data.
 * - LIVE mode: real provider adapters. When a provider has no key it is NOT CONNECTED
 *   and the corresponding sections render empty with an explanation — there is no
 *   silent fallback to demo data.
 */
import { cache } from "react";
import type { Match, MatchStatistics, OddsQuote, OddsSnapshot, Player, Tournament } from "../domain";
import { FINISHED_STATUSES } from "../domain";
import { isDemoMode, isSupabaseConfigured } from "../env";
import { demoDataset, latestQuotes, type HistoryMatch, DEMO_PROVIDER } from "../demo/generator";
import { apiTennis, oddsApi, sportradarTennis } from "../providers/registry";
import { EloModel, type EloPrediction } from "../engine/elo";
import { backtestElo, type BacktestResult } from "../engine/evaluation";
import { buildMarketRows, type MarketRow } from "./board";
import { evaluateValue, type ValueOpportunity, type ValueSettings, DEFAULT_VALUE_SETTINGS } from "../engine/value";
import { headToHead, playerAnalytics, type HeadToHead, type PlayerAnalytics } from "../engine/player-analytics";
import { completedHistory, hookUsageLogging, oddsHistory } from "./repository";

export type Mode = "demo" | "live";
export interface Notice {
  level: "info" | "warn" | "error";
  text: string;
}

export interface Snapshot {
  mode: Mode;
  generatedAt: string;
  matches: Match[];
  quotes: Record<string, OddsQuote[]>;
  notices: Notice[];
}

export function mode(): Mode {
  return isDemoMode() ? "demo" : "live";
}

// --------------------------------------------------------------------------
// Name matching between odds feed (names only) and sports-data feed (ids).
// --------------------------------------------------------------------------
export function surnameKey(name: string): string {
  const n = name.includes(",") ? name.split(",")[0]! : name.trim().split(/\s+/).at(-1)!;
  return n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

export function linkOddsToMatches(matches: Match[], oddsEvents: { match: Match; quotes: OddsQuote[] }[]) {
  const out: Record<string, OddsQuote[]> = {};
  const unmatched: { match: Match; quotes: OddsQuote[] }[] = [];
  for (const ev of oddsEvents) {
    const ea = surnameKey(ev.match.playerA.name), eb = surnameKey(ev.match.playerB.name);
    const t = Date.parse(ev.match.scheduledAt);
    const m = matches.find((x) => {
      const xa = surnameKey(x.playerA.name), xb = surnameKey(x.playerB.name);
      const names = (xa === ea && xb === eb) || (xa === eb && xb === ea);
      return names && Math.abs(Date.parse(x.scheduledAt) - t) < 12 * 3600_000;
    });
    if (!m) {
      unmatched.push(ev);
      continue;
    }
    const swapped = surnameKey(m.playerA.name) !== ea;
    out[m.id] = ev.quotes.map((q) => ({
      ...q,
      selection: swapped && (q.selection === "a" || q.selection === "b") ? (q.selection === "a" ? "b" : "a") : q.selection,
    }));
  }
  return { linked: out, unmatched };
}

// --------------------------------------------------------------------------
// Snapshot
// --------------------------------------------------------------------------
async function liveSnapshot(): Promise<Snapshot> {
  hookUsageLogging();
  const notices: Notice[] = [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  let matches: Match[] = [];

  const sr = sportradarTennis();
  const at = apiTennis();
  const oa = oddsApi();

  try {
    if (sr) {
      const [d1, d2, live] = await Promise.all([sr.dailySummaries(today), sr.dailySummaries(tomorrow), sr.liveSummaries().catch(() => [])]);
      const byId = new Map<string, Match>();
      for (const x of [...d1, ...d2, ...live]) byId.set(x.match.id, x.match); // live overrides schedule
      matches = [...byId.values()];
    } else if (at) {
      matches = await at.fixtures(today, tomorrow);
    } else {
      notices.push({ level: "warn", text: "No tennis data provider connected (Sportradar or API-Tennis). Scores, statistics and rankings are unavailable." });
    }
  } catch (e) {
    notices.push({ level: "error", text: `Tennis data provider error: ${(e as Error).message}` });
  }

  let quotes: Record<string, OddsQuote[]> = {};
  if (oa) {
    try {
      const events = await oa.tennisOdds();
      if (matches.length) {
        const { linked, unmatched } = linkOddsToMatches(matches, events);
        quotes = linked;
        // Odds events we could not link still appear (names only, no stats).
        for (const u of unmatched) {
          matches.push(u.match);
          quotes[u.match.id] = u.quotes;
        }
      } else {
        matches = events.map((e) => e.match);
        quotes = Object.fromEntries(events.map((e) => [e.match.id, e.quotes]));
      }
    } catch (e) {
      notices.push({ level: "error", text: `Odds provider error: ${(e as Error).message}` });
    }
  } else {
    notices.push({ level: "warn", text: "No odds provider connected (The Odds API). Betting lines, value detection and line movement are unavailable." });
  }
  if (!isSupabaseConfigured()) notices.push({ level: "info", text: "Supabase not configured: odds history, bet storage and alerts persistence are disabled." });

  matches.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return { mode: "live", generatedAt: now.toISOString(), matches, quotes, notices };
}

function demoSnapshot(): Snapshot {
  const d = demoDataset();
  return {
    mode: "demo",
    generatedAt: d.generatedAt,
    matches: [...d.today].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    quotes: Object.fromEntries(
      Object.entries(d.odds).map(([id, snaps]) => {
        const m = d.today.find((x) => x.id === id)!;
        // Finished matches have no current market.
        return [id, FINISHED_STATUSES.includes(m.status) ? [] : latestQuotes(snaps)];
      }),
    ),
    notices: [{ level: "warn", text: "DEMO MODE — all players, bookmakers, odds and statistics are synthetic. Nothing on screen is live data." }],
  };
}

export const getSnapshot = cache(async (): Promise<Snapshot> => (isDemoMode() ? demoSnapshot() : liveSnapshot()));

export async function getMatch(id: string): Promise<Match | null> {
  const s = await getSnapshot();
  return s.matches.find((m) => m.id === id) ?? null;
}

export async function getOddsHistory(matchId: string): Promise<{ points: OddsSnapshot[]; note: string | null }> {
  if (isDemoMode()) return { points: demoDataset().odds[matchId] ?? [], note: null };
  const provider = matchId.split(":")[0];
  const providerId = provider === "sr" ? "sportradar_tennis" : provider === "at" ? "api_tennis" : "the_odds_api";
  const h = await oddsHistory(providerId, matchId).catch(() => null);
  if (h === null) return { points: [], note: "Odds history requires Supabase and the odds ingestion worker (see docs/DEPLOYMENT.md)." };
  if (h.length === 0) return { points: [], note: "No stored snapshots yet for this match. History accumulates each time the ingestion worker runs." };
  return { points: h, note: null };
}

export async function getMarketRows(matchId: string): Promise<MarketRow[]> {
  const s = await getSnapshot();
  const { points } = await getOddsHistory(matchId);
  return buildMarketRows(matchId, s.quotes[matchId] ?? [], points);
}

export async function getStats(matchId: string): Promise<MatchStatistics | null> {
  if (isDemoMode()) return demoDataset().stats[matchId] ?? null;
  const sr = sportradarTennis();
  if (!sr || !matchId.startsWith("sr:")) return null;
  const today = new Date().toISOString().slice(0, 10);
  const res = await sr.dailySummaries(today).catch(() => []);
  return res.find((r) => r.match.id === matchId)?.stats ?? null;
}

export function getMomentum(matchId: string) {
  return isDemoMode() ? demoDataset().momentum[matchId] ?? null : null;
}

// --------------------------------------------------------------------------
// Model
// --------------------------------------------------------------------------
export interface ModelBundle {
  model: EloModel | null;
  history: HistoryMatch[];
  report: BacktestResult | null;
  trainedThrough: string | null;
  note: string | null;
}

const MIN_HISTORY = 500;

export const getModel = cache(async (): Promise<ModelBundle> => {
  let history: HistoryMatch[] = [];
  if (isDemoMode()) history = demoDataset().history;
  else history = (await completedHistory().catch(() => null)) ?? [];
  if (history.length < MIN_HISTORY) {
    return {
      model: null, history, report: null, trainedThrough: null,
      note: `Insufficient history to train the model (${history.length} completed matches stored; ${MIN_HISTORY} required). Probabilities are not shown rather than guessed.`,
    };
  }
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const cutoff = sorted[Math.floor(sorted.length * 0.8)]!.date; // chronological 80/20 split
  const report = backtestElo(sorted.map(toElo), cutoff);
  const model = new EloModel().fit(sorted.map(toElo));
  return { model, history: sorted, report, trainedThrough: sorted.at(-1)!.date, note: null };
});

function toElo(h: HistoryMatch) {
  return { id: h.id, date: h.date, winnerId: h.winnerId, loserId: h.loserId, surface: h.surface, bestOf: h.bestOf };
}

export interface MatchPrediction {
  matchId: string;
  prediction: EloPrediction | null;
  reason: string | null;
}

export async function getPredictions(): Promise<MatchPrediction[]> {
  const [s, m] = await Promise.all([getSnapshot(), getModel()]);
  return s.matches.map((match) => {
    if (!m.model) return { matchId: match.id, prediction: null, reason: m.note };
    const p = m.model.predict(match.playerA.id, match.playerB.id, match.surface);
    return { matchId: match.id, prediction: p, reason: p ? null : "Insufficient match history for one or both players" };
  });
}

// --------------------------------------------------------------------------
// Value
// --------------------------------------------------------------------------
export async function getValueCandidates(settings: ValueSettings = DEFAULT_VALUE_SETTINGS): Promise<ValueOpportunity[]> {
  const [s, preds] = await Promise.all([getSnapshot(), getPredictions()]);
  const out: ValueOpportunity[] = [];
  for (const match of s.matches) {
    if (FINISHED_STATUSES.includes(match.status)) continue;
    const quotes = s.quotes[match.id] ?? [];
    if (!quotes.length) continue;
    const rows = buildMarketRows(match.id, quotes);
    const mw = rows.find((r) => r.market === "match_winner");
    if (!mw) continue;
    const pred = preds.find((p) => p.matchId === match.id)?.prediction ?? null;
    const freshness = Math.max(0, 1 - (Date.now() - Date.parse(mw.lastUpdate ?? s.generatedAt)) / (6 * 3600_000));
    const sampleQ = pred ? Math.min(1, Math.min(pred.sampleA, pred.sampleB) / 60) : 0;
    const dataQuality = Math.round((0.5 * freshness + 0.5 * sampleQ) * 100) / 100;
    for (const sel of mw.selections) {
      if (!sel.bestOdds || !sel.bestBookmaker) continue;
      const pModel = pred ? (sel.selection === "a" ? pred.probA : 1 - pred.probA) : null;
      const v = evaluateValue(
        {
          matchId: match.id,
          matchLabel: `${match.playerA.name} v ${match.playerB.name}`,
          market: "match_winner",
          selection: sel.selection,
          selectionLabel: sel.label,
          bestOdds: sel.bestOdds,
          bestBookmaker: sel.bestBookmaker,
          oddsTimestamp: sel.bestUpdatedAt ?? s.generatedAt,
          modelProbability: pModel,
          modelIntervalWidth: pred ? pred.ciHigh - pred.ciLow : null,
          marketProbability: sel.consensusProbability,
          dataQuality,
          booksInConsensus: mw.booksQuoting,
        },
        settings,
      );
      if (v) out.push(v);
    }
  }
  return out.sort((a, b) => b.expectedValue - a.expectedValue);
}

// --------------------------------------------------------------------------
// Players & tournaments
// --------------------------------------------------------------------------
export async function getPlayers(): Promise<Player[]> {
  if (isDemoMode()) return demoDataset().players.map(({ strength: _s, surfaceBias: _b, ...p }) => p);
  const sr = sportradarTennis();
  if (!sr) return [];
  const rk = await sr.rankings().catch(() => []);
  return rk.map((r) => ({ id: r.playerId, name: r.name, countryCode: r.countryCode, tour: r.tour, rank: r.rank, rankingPoints: r.points, birthDate: null, handedness: null, heightCm: null }));
}

export async function getPlayer(id: string): Promise<{ player: Player; analytics: PlayerAnalytics | null; recent: HistoryMatch[] } | null> {
  const [players, s, m] = await Promise.all([getPlayers(), getSnapshot(), getModel()]);
  const player = players.find((p) => p.id === id) ?? s.matches.flatMap((x) => [x.playerA, x.playerB]).find((p) => p.id === id);
  if (!player) return null;
  const mine = m.history.filter((h) => h.winnerId === id || h.loserId === id);
  return {
    player,
    analytics: mine.length ? playerAnalytics(id, m.history) : null,
    recent: mine.slice(-20).reverse(),
  };
}

export async function getHeadToHead(aId: string, bId: string): Promise<HeadToHead | null> {
  const m = await getModel();
  if (!m.history.length) return null;
  return headToHead(aId, bId, m.history);
}

export async function getTournaments(): Promise<Tournament[]> {
  if (isDemoMode()) return demoDataset().tournaments;
  const s = await getSnapshot();
  return [...new Map(s.matches.map((m) => [m.tournament.id, m.tournament])).values()];
}

export function isDemoProvider(p: string) {
  return p === DEMO_PROVIDER;
}
