/**
 * The Odds API v4 — https://the-odds-api.com/liveapi/guides/v4/
 * Auth: apiKey query parameter (server-side only). /sports is free; each /odds call costs
 * (#markets × #regions) credits. Usage arrives in x-requests-used / -remaining / -last headers.
 * In-play events are included in /odds once they have started (commence_time in the past).
 */
import { z } from "zod";
import { requestJson, ProviderError } from "./http";
import type { NormalizedEvent, OddsProvider, ProviderConfig, QuotaInfo, TestCheck, TestResult } from "./types";
import { failedTest } from "./test-helpers";

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
  async test(cfg, opts) {
    const started = Date.now();
    const checks: TestCheck[] = [];
    try {
      // 1. Real request: /sports is authenticated but free of quota cost.
      const r = await requestJson<unknown>({ provider: THE_ODDS_API, url: `${BASE}/sports/?apiKey=${encodeURIComponent(cfg.apiKey)}`, ttlMs: 0, retries: 1,
        timeoutMs: cfg.timeoutMs ?? 10_000, fetchImpl: cfg.fetchImpl, quotaHeaders: { used: "x-requests-used", remaining: "x-requests-remaining" }, maxRetryWaitMs: 3_000 });
      checks.push({ name: "Authenticated request", ok: true, detail: `HTTP 200 from /v4/sports in ${Date.now() - started} ms` });
      // 2. Validate + parse.
      const sports = z.array(SportSchema).min(1, "empty sports list").parse(r.data);
      const active = sports.filter((x) => x.active);
      checks.push({ name: "Response schema", ok: true, detail: `${sports.length} sports parsed, ${active.length} active` });
      const q = quota(r.headers);
      checks.push({ name: "Quota headers", ok: q.remaining != null, detail: q.remaining != null ? `${q.remaining} credits remaining, ${q.used ?? "?"} used` : "provider did not report quota on this endpoint" });
      const sample: NonNullable<TestResult["sample"]> = { sports: sports.length, activeSports: active.length };
      // 3. Optional: fetch and parse a real odds payload.
      if (opts?.sampleSport) {
        const o = await this.fetchOdds(cfg, opts.sampleSport);
        const books = new Set(o.events.flatMap((e) => e.markets.flatMap((m) => m.quotes.map((x) => x.bookmakerKey))));
        Object.assign(sample, { sportKey: opts.sampleSport, oddsEvents: o.events.length, bookmakers: books.size, markets: o.events.reduce((a, e) => a + e.markets.length, 0) });
        checks.push({ name: "Odds sample", ok: true, detail: `${o.events.length} events, ${books.size} bookmakers parsed for ${opts.sampleSport}; cost ${o.quota.lastCost ?? "?"} credits` });
        if (o.quota.remaining != null) Object.assign(q, { remaining: o.quota.remaining, used: o.quota.used, lastCost: o.quota.lastCost });
      }
      return { ok: true, status: "ok", message: `Connected: ${active.length} active sports${sample.oddsEvents != null ? `, ${sample.oddsEvents} events with odds` : ""}`,
        quota: q, latencyMs: Date.now() - started, checks, sample, testedAt: new Date().toISOString(), reachedProvider: true };
    } catch (e) {
      return failedTest(e, checks, started);
    }
  },
  async listSports(cfg) {
    const r = await requestJson<unknown[]>({ provider: THE_ODDS_API, url: `${BASE}/sports/?apiKey=${encodeURIComponent(cfg.apiKey)}&all=true`, ttlMs: 3_600_000, fetchImpl: cfg.fetchImpl });
    return z.array(SportSchema).parse(r.data).map((s) => ({ key: s.key, title: s.title, group: s.group, sportKey: sportFromGroup(s.group), active: s.active, hasOutrights: Boolean(s.has_outrights) }));
  },
  async fetchOdds(cfg, sport) {
    const params = new URLSearchParams({ apiKey: cfg.apiKey, regions: cfg.regions || "eu", markets: cfg.markets || "h2h", oddsFormat: "decimal", dateFormat: "iso" });
    const r = await requestJson<unknown[]>({
      provider: THE_ODDS_API, url: `${BASE}/sports/${encodeURIComponent(sport)}/odds/?${params}`, ttlMs: 55_000, rateLimitPerMinute: 30, fetchImpl: cfg.fetchImpl, timeoutMs: cfg.timeoutMs ?? 15_000, retries: 2,
      costHeader: "x-requests-last", quotaHeaders: { used: "x-requests-used", remaining: "x-requests-remaining" },
    });
    const sports = await this.listSports(cfg).catch(() => []);
    const sportKey = sports.find((s) => s.key === sport)?.sportKey ?? sportFromKey(sport);
    const parsed = z.array(EventSchema).safeParse(r.data);
    if (!parsed.success) throw new ProviderError(`${THE_ODDS_API} odds response did not match the expected structure: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`, THE_ODDS_API, 200, false, "malformed");
    const events = parsed.data.map((e) => normalizeEvent(e, sportKey, r.fetchedAt));
    return { events, quota: quota(r.headers), fetchedAt: r.fetchedAt };
  },
};
