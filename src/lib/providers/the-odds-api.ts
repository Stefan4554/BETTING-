/**
 * The Odds API v4 — https://the-odds-api.com/liveapi/guides/v4/
 * Auth: apiKey query parameter (server-side only). /sports is free; each /odds call costs
 * (#markets × #regions) credits. Usage arrives in x-requests-used / -remaining / -last headers.
 * In-play events are included in /odds once they have started (commence_time in the past).
 */
import { z } from "zod";
import { requestJson, ProviderError } from "./http";
import type { NormalizedEvent, OddsProvider, ProviderConfig, QuotaInfo } from "./types";

export const THE_ODDS_API = "the_odds_api";
const BASE = "https://api.the-odds-api.com/v4";

const SportSchema = z.object({ key: z.string(), group: z.string(), title: z.string(), active: z.boolean(), has_outrights: z.boolean().nullish() });
const Outcome = z.object({ name: z.string(), price: z.number(), point: z.number().nullish(), description: z.string().nullish() });
const Market = z.object({ key: z.string(), last_update: z.string().nullish(), outcomes: z.array(Outcome) });
const Book = z.object({ key: z.string(), title: z.string(), last_update: z.string().nullish(), markets: z.array(Market) });
export const EventSchema = z.object({
  id: z.string(), sport_key: z.string(), sport_title: z.string(), commence_time: z.string(),
  home_team: z.string().nullish(), away_team: z.string().nullish(), bookmakers: z.array(Book).default([]),
});

const GROUP_TO_SPORT: Record<string, string> = {
  "Soccer": "football", "Basketball": "basketball", "Tennis": "tennis", "Baseball": "baseball", "American Football": "american_football",
  "Ice Hockey": "ice_hockey", "Rugby League": "rugby", "Rugby Union": "rugby", "Cricket": "cricket", "Mixed Martial Arts": "mma",
  "Boxing": "boxing", "Golf": "golf", "Aussie Rules": "other", "Handball": "handball", "Volleyball": "volleyball", "Darts": "darts",
  "Table Tennis": "table_tennis", "Esports": "esports", "Badminton": "badminton",
};
const PREFIX: [string, string][] = [["soccer_", "football"], ["basketball_", "basketball"], ["tennis_", "tennis"], ["baseball_", "baseball"],
  ["americanfootball_", "american_football"], ["icehockey_", "ice_hockey"], ["rugbyleague_", "rugby"], ["rugbyunion_", "rugby"], ["cricket_", "cricket"],
  ["mma_", "mma"], ["boxing_", "boxing"], ["golf_", "golf"], ["handball_", "handball"]];
export const sportFromKey = (key: string) => PREFIX.find(([p]) => key.startsWith(p))?.[1] ?? "other";
export const sportFromGroup = (group: string) => GROUP_TO_SPORT[group] ?? "other";

const MARKET_NAMES: Record<string, string> = { h2h: "Match Winner", spreads: "Point Spread / Handicap", totals: "Totals", outrights: "Outright", h2h_lay: "Match Winner (lay)" };

function quota(h: Record<string, string>): QuotaInfo {
  const n = (k: string) => (h[k] != null && h[k] !== "" ? Number(h[k]) : null);
  return { used: n("x-requests-used"), remaining: n("x-requests-remaining"), lastCost: n("x-requests-last") };
}

export function normalizeEvent(e: z.infer<typeof EventSchema>, sportKey: string, fetchedAt: string): NormalizedEvent {
  const markets = new Map<string, NormalizedEvent["markets"][number]>();
  for (const bk of e.bookmakers) {
    for (const m of bk.markets) {
      // Market identity: key + line from the home/over side so both sides share a market row.
      const ref = m.outcomes.find((o) => o.name === e.home_team || o.name === "Over") ?? m.outcomes[0];
      const line = m.key === "h2h" || m.key === "outrights" ? null : ref?.point ?? null;
      const id = `${m.key}|${line ?? ""}`;
      const mk = markets.get(id) ?? { key: m.key, name: MARKET_NAMES[m.key] ?? m.key, line, quotes: [] };
      for (const o of m.outcomes) {
        if (!(o.price > 1)) continue;
        mk.quotes.push({
          bookmakerKey: bk.key, bookmakerName: bk.title, selection: o.description ? `${o.description} ${o.name}` : o.name,
          line: o.point ?? null, odds: o.price, updatedAt: m.last_update ?? bk.last_update ?? null,
        });
      }
      markets.set(id, mk);
    }
  }
  const home = e.home_team ?? null, away = e.away_team ?? null;
  return {
    externalId: e.id, sportKey, providerSportKey: e.sport_key, leagueName: e.sport_title, home, away,
    name: home && away ? `${home} v ${away}` : e.sport_title, startTime: e.commence_time,
    isLive: Date.parse(e.commence_time) <= Date.parse(fetchedAt), markets: [...markets.values()],
  };
}

export const theOddsApi: OddsProvider = {
  id: THE_ODDS_API,
  name: "The Odds API",
  async test(cfg) {
    const t = Date.now();
    try {
      const r = await requestJson<unknown[]>({ provider: THE_ODDS_API, url: `${BASE}/sports/?apiKey=${encodeURIComponent(cfg.apiKey)}`, ttlMs: 0, retries: 1, fetchImpl: cfg.fetchImpl,
        quotaHeaders: { used: "x-requests-used", remaining: "x-requests-remaining" } });
      const n = z.array(SportSchema).parse(r.data).filter((s) => s.active).length;
      return { ok: true, message: `Connected: ${n} active sports available`, quota: quota(r.headers), latencyMs: Date.now() - t };
    } catch (e) {
      const pe = e as ProviderError;
      return { ok: false, message: pe.status === 401 ? "Invalid API key (401)" : pe.status === 429 ? "Rate limit or quota exceeded (429)" : pe.message, latencyMs: Date.now() - t };
    }
  },
  async listSports(cfg) {
    const r = await requestJson<unknown[]>({ provider: THE_ODDS_API, url: `${BASE}/sports/?apiKey=${encodeURIComponent(cfg.apiKey)}&all=true`, ttlMs: 3_600_000, fetchImpl: cfg.fetchImpl });
    return z.array(SportSchema).parse(r.data).map((s) => ({ key: s.key, title: s.title, group: s.group, sportKey: sportFromGroup(s.group), active: s.active, hasOutrights: Boolean(s.has_outrights) }));
  },
  async fetchOdds(cfg, sport) {
    const params = new URLSearchParams({ apiKey: cfg.apiKey, regions: cfg.regions || "eu", markets: cfg.markets || "h2h", oddsFormat: "decimal", dateFormat: "iso" });
    const r = await requestJson<unknown[]>({
      provider: THE_ODDS_API, url: `${BASE}/sports/${encodeURIComponent(sport)}/odds/?${params}`, ttlMs: 55_000, rateLimitPerMinute: 30, fetchImpl: cfg.fetchImpl,
      costHeader: "x-requests-last", quotaHeaders: { used: "x-requests-used", remaining: "x-requests-remaining" },
    });
    const sports = await this.listSports(cfg).catch(() => []);
    const sportKey = sports.find((s) => s.key === sport)?.sportKey ?? sportFromKey(sport);
    const events = z.array(EventSchema).parse(r.data).map((e) => normalizeEvent(e, sportKey, r.fetchedAt));
    return { events, quota: quota(r.headers), fetchedAt: r.fetchedAt };
  },
};
