/**
 * Builds betting-board rows from odds snapshots. Pure and shared by demo + live modes.
 */
import type { MarketKey, Match, OddsQuote, OddsSnapshot } from "../domain";
import { marketConsensus } from "../engine/consensus";
import { impliedProbability, oddsMovementPct } from "../engine/odds";
import { DEMO_BOOKMAKERS } from "../demo/generator";

const SHARP = new Set(["pinnacle", "betfair_ex_eu", "betfair_ex_uk", "matchbook", "smarkets", ...DEMO_BOOKMAKERS.filter((b) => b.sharp).map((b) => b.key)]);

export interface SelectionRow {
  selection: string;
  label: string;
  bestOdds: number | null;
  bestBookmaker: string | null;
  bestUpdatedAt: string | null;
  averageOdds: number | null;
  openingOdds: number | null; // earliest observed best price
  currentOdds: number | null; // current best price
  movementPct: number | null;
  impliedProbability: number | null;
  consensusProbability: number | null;
}

export interface MarketRow {
  matchId: string;
  market: MarketKey;
  line: number | null;
  selections: SelectionRow[];
  overround: number | null;
  booksQuoting: number;
  lastUpdate: string | null;
  providers: string[];
}

export interface ComparisonRow {
  matchId: string;
  matchLabel: string;
  bookmaker: string;
  bookmakerName: string;
  market: MarketKey;
  line: number | null;
  selection: string;
  selectionLabel: string;
  currentOdds: number;
  openingOdds: number | null;
  isBest: boolean;
  bestAvailable: number;
  lastUpdate: string;
  movementPct: number | null;
  provider: string;
}

const key = (q: { market: string; line: number | null }) => `${q.market}|${q.line ?? ""}`;

function groupMarkets(quotes: OddsQuote[]) {
  const m = new Map<string, OddsQuote[]>();
  for (const q of quotes) {
    const k = key(q);
    (m.get(k) ?? m.set(k, []).get(k)!).push(q);
  }
  return m;
}

/** Handicap lines differ per side (−2.5 / +2.5); pair them by absolute value. */
function normalizeLine(q: OddsQuote): OddsQuote {
  return q.market === "game_handicap" || q.market === "set_handicap" ? { ...q, line: q.line === null ? null : Math.abs(q.line) } : q;
}

export function buildMarketRows(matchId: string, current: OddsQuote[], history: OddsSnapshot[] = []): MarketRow[] {
  const rows: MarketRow[] = [];
  const hist = history.map((h) => normalizeLine(h) as OddsSnapshot);
  for (const [, qs] of groupMarkets(current.map(normalizeLine))) {
    const first = qs[0]!;
    const selections = [...new Set(qs.map((q) => q.selection))];
    const books = [...new Set(qs.map((q) => q.bookmaker))].map((b) => {
      const bq = qs.filter((q) => q.bookmaker === b);
      return {
        bookmaker: b,
        prices: Object.fromEntries(bq.map((q) => [q.selection, q.odds])),
        updatedAt: bq.reduce((a, q) => (q.updatedAt > a ? q.updatedAt : a), bq[0]!.updatedAt),
        sharp: SHARP.has(b),
      };
    });
    const consensus = selections.length >= 2 ? marketConsensus(books, selections) : null;
    const h = hist.filter((x) => x.market === first.market && (x.line ?? null) === (first.line ?? null));
    const sels: SelectionRow[] = selections.map((s) => {
      const sq = qs.filter((q) => q.selection === s);
      const best = sq.reduce((a, q) => (q.odds > a.odds ? q : a), sq[0]!);
      const avg = sq.reduce((a, q) => a + q.odds, 0) / sq.length;
      const sh = h.filter((x) => x.selection === s).sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));
      const firstTs = sh[0]?.capturedAt;
      const opening = firstTs ? Math.max(...sh.filter((x) => x.capturedAt === firstTs).map((x) => x.odds)) : null;
      return {
        selection: s,
        label: best.selectionLabel,
        bestOdds: best.odds,
        bestBookmaker: best.bookmakerName,
        bestUpdatedAt: best.updatedAt,
        averageOdds: avg,
        openingOdds: opening,
        currentOdds: best.odds,
        movementPct: opening ? oddsMovementPct(opening, best.odds) : null,
        impliedProbability: impliedProbability(best.odds),
        consensusProbability: consensus?.probabilities[s] ?? null,
      };
    });
    const bestSum = sels.every((s) => s.bestOdds) ? sels.reduce((a, s) => a + 1 / s.bestOdds!, 0) - 1 : null;
    rows.push({
      matchId,
      market: first.market,
      line: first.line,
      selections: sels,
      overround: bestSum,
      booksQuoting: books.length,
      lastUpdate: qs.reduce((a, q) => (q.updatedAt > a ? q.updatedAt : a), qs[0]!.updatedAt),
      providers: [...new Set(qs.map((q) => q.provider))],
    });
  }
  const order: MarketKey[] = ["match_winner", "set_winner", "game_handicap", "set_handicap", "total_games", "total_sets", "correct_score", "player_prop"];
  return rows.sort((a, b) => order.indexOf(a.market) - order.indexOf(b.market));
}

export function buildComparisonRows(match: Match, current: OddsQuote[], history: OddsSnapshot[] = []): ComparisonRow[] {
  const label = `${match.playerA.name} v ${match.playerB.name}`;
  const best = new Map<string, number>();
  for (const q of current) {
    const k = `${q.market}|${q.line}|${q.selection}`;
    best.set(k, Math.max(best.get(k) ?? 0, q.odds));
  }
  return current.map((q) => {
    const k = `${q.market}|${q.line}|${q.selection}`;
    const h = history
      .filter((x) => x.bookmaker === q.bookmaker && x.market === q.market && x.line === q.line && x.selection === q.selection)
      .sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));
    const opening = h[0]?.odds ?? null;
    return {
      matchId: match.id,
      matchLabel: label,
      bookmaker: q.bookmaker,
      bookmakerName: q.bookmakerName,
      market: q.market,
      line: q.line,
      selection: q.selection,
      selectionLabel: q.selectionLabel,
      currentOdds: q.odds,
      openingOdds: opening,
      isBest: q.odds === best.get(k),
      bestAvailable: best.get(k)!,
      lastUpdate: q.updatedAt,
      movementPct: opening ? oddsMovementPct(opening, q.odds) : null,
      provider: q.provider,
    };
  });
}

export interface HistoryPoint {
  at: string;
  best: number;
  average: number;
  consensus: number | null;
  [bookmaker: string]: number | string | null;
}

/** Time series for a selection: per-book price, best, average and no-vig consensus. */
export function historySeries(history: OddsSnapshot[], market: MarketKey, line: number | null, selection: string): HistoryPoint[] {
  const h = history.filter((x) => x.market === market && (x.line ?? null) === line);
  const times = [...new Set(h.map((x) => x.capturedAt))].sort();
  const points: HistoryPoint[] = [];
  const lastByBook = new Map<string, Record<string, number>>();
  for (const t of times) {
    for (const x of h.filter((y) => y.capturedAt === t)) {
      const rec = lastByBook.get(x.bookmaker) ?? {};
      rec[x.selection] = x.odds;
      lastByBook.set(x.bookmaker, rec);
    }
    const sels = [...new Set(h.map((x) => x.selection))];
    const books = [...lastByBook.entries()].map(([b, prices]) => ({ bookmaker: b, prices, updatedAt: t, sharp: SHARP.has(b) }));
    const c = marketConsensus(books, sels);
    const prices = [...lastByBook.values()].map((p) => p[selection]).filter((x): x is number => typeof x === "number");
    if (!prices.length) continue;
    const pt: HistoryPoint = {
      at: t,
      best: Math.max(...prices),
      average: prices.reduce((a, b) => a + b, 0) / prices.length,
      consensus: c ? c.probabilities[selection] ?? null : null,
    };
    for (const [b, p] of lastByBook) if (p[selection]) pt[b] = p[selection]!;
    points.push(pt);
  }
  return points;
}
