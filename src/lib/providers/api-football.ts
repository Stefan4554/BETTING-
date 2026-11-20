/**
 * API-Football v3 (API-Sports) — https://www.api-football.com/documentation-v3
 * Auth: x-apisports-key header. Pre-match odds per fixture; team names come from /fixtures.
 * Provider sport keys used here are "<leagueId>" or "<leagueId>:<season>".
 * Free tier: 100 requests/day — refresh intervals are kept long.
 */
import { z } from "zod";
import { requestJson, ProviderError } from "./http";
import type { NormalizedEvent, NormalizedMarket, OddsProvider, QuotaInfo } from "./types";

export const API_FOOTBALL = "api_football";
const BASE = "https://v3.football.api-sports.io";

const Envelope = <T extends z.ZodTypeAny>(t: T) => z.object({ errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(), response: t, paging: z.object({ current: z.number(), total: z.number() }).optional() });
const Fixture = z.object({
  fixture: z.object({ id: z.number(), date: z.string(), status: z.object({ short: z.string() }).partial().optional() }),
  league: z.object({ id: z.number(), name: z.string(), season: z.number() }),
  teams: z.object({ home: z.object({ name: z.string() }), away: z.object({ name: z.string() }) }),
});
const Odds = z.object({
  fixture: z.object({ id: z.number(), date: z.string() }),
  league: z.object({ id: z.number(), name: z.string() }),
  update: z.string().nullish(),
  bookmakers: z.array(z.object({ id: z.number(), name: z.string(), bets: z.array(z.object({ id: z.number(), name: z.string(), values: z.array(z.object({ value: z.union([z.string(), z.number()]), odd: z.string() })) })) })),
});

const headers = (key: string) => ({ "x-apisports-key": key });
function quota(h: Record<string, string>): QuotaInfo {
  const lim = Number(h["x-ratelimit-requests-limit"]), rem = Number(h["x-ratelimit-requests-remaining"]);
  return { used: Number.isFinite(lim) && Number.isFinite(rem) ? lim - rem : null, remaining: Number.isFinite(rem) ? rem : null, lastCost: 1 };
}
function apiErrors(data: { errors?: unknown }): string | null {
  const e = data.errors;
  if (!e) return null;
  if (Array.isArray(e)) return e.length ? JSON.stringify(e) : null;
  const vals = Object.values(e as Record<string, unknown>);
  return vals.length ? vals.join("; ") : null;
}

const bookKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function normalizeOdds(o: z.infer<typeof Odds>, f: z.infer<typeof Fixture> | undefined, _fetchedAt: string): NormalizedEvent {
  const home = f?.teams.home.name ?? null, away = f?.teams.away.name ?? null;
  const markets = new Map<string, NormalizedMarket>();
  for (const bk of o.bookmakers) {
    for (const bet of bk.bets) {
      for (const v of bet.values) {
        const raw = String(v.value);
        const odds = Number(v.odd);
        if (!(odds > 1)) continue;
        let key: string, line: number | null = null, quoteLine: number | null = null, selection = raw, marketName = bet.name;
        if (bet.name === "Match Winner") { key = "h2h"; selection = raw === "Home" ? home ?? "Home" : raw === "Away" ? away ?? "Away" : "Draw"; }
        else if (bet.name === "Goals Over/Under") { const m = /^(Over|Under)\s+([\d.]+)$/.exec(raw); if (!m) continue; key = "totals"; line = quoteLine = Number(m[2]); selection = m[1]!; marketName = "Totals"; }
        else if (bet.name === "Asian Handicap") { const m = /^(Home|Away)\s+([+-]?[\d.]+)$/.exec(raw); if (!m) continue; key = "spreads"; quoteLine = Number(m[2]); line = m[1] === "Home" ? quoteLine : -quoteLine; selection = m[1] === "Home" ? home ?? "Home" : away ?? "Away"; marketName = "Asian Handicap"; }
        else if (bet.name === "Both Teams Score") { key = "btts"; }
        else if (bet.name === "Double Chance") { key = "double_chance"; }
        else continue;
        const id = `${key}|${line ?? ""}`;
        const mk = markets.get(id) ?? { key, name: marketName, line, quotes: [] };
        mk.quotes.push({ bookmakerKey: bookKey(bk.name), bookmakerName: bk.name, selection, line: quoteLine, odds, updatedAt: o.update ?? null });
        markets.set(id, mk);
      }
    }
  }
  const start = f?.fixture.date ?? o.fixture.date;
  const live = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(f?.fixture.status?.short ?? "");
  return {
    externalId: String(o.fixture.id), sportKey: "football", providerSportKey: String(o.league.id), leagueName: o.league.name, home, away,
    name: home && away ? `${home} v ${away}` : `Fixture ${o.fixture.id}`, startTime: start, isLive: live,
    markets: [...markets.values()],
  };
}

export const apiFootball: OddsProvider = {
  id: API_FOOTBALL,
  name: "API-Football",
  async test(cfg) {
    const t = Date.now();
    try {
      const r = await requestJson<{ errors?: unknown; response: { requests?: { current: number; limit_day: number }; subscription?: { plan: string } } }>({
        provider: API_FOOTBALL, url: `${BASE}/status`, headers: headers(cfg.apiKey), ttlMs: 0, retries: 1, fetchImpl: cfg.fetchImpl });
      const err = apiErrors(r.data);
      if (err) return { ok: false, message: err, latencyMs: Date.now() - t };
      const req = r.data.response.requests;
      return { ok: true, message: `Connected (${r.data.response.subscription?.plan ?? "plan unknown"})`, latencyMs: Date.now() - t,
        quota: req ? { used: req.current, remaining: req.limit_day - req.current, lastCost: 0 } : quota(r.headers) };
    } catch (e) {
      return { ok: false, message: (e as ProviderError).message, latencyMs: Date.now() - t };
    }
  },
  async listSports() {
    return [{ key: "39", title: "Premier League (England)", group: "Soccer", sportKey: "football", active: true, hasOutrights: false },
      { key: "140", title: "La Liga", group: "Soccer", sportKey: "football", active: true, hasOutrights: false },
      { key: "135", title: "Serie A", group: "Soccer", sportKey: "football", active: true, hasOutrights: false },
      { key: "78", title: "Bundesliga", group: "Soccer", sportKey: "football", active: true, hasOutrights: false },
      { key: "61", title: "Ligue 1", group: "Soccer", sportKey: "football", active: true, hasOutrights: false },
      { key: "2", title: "UEFA Champions League", group: "Soccer", sportKey: "football", active: true, hasOutrights: false }];
  },
  async fetchOdds(cfg, leagueKey) {
    const [league, seasonStr] = leagueKey.split(":");
    const season = Number(seasonStr ?? cfg.season ?? new Date().getUTCFullYear() - (new Date().getUTCMonth() < 6 ? 1 : 0));
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const fx = await requestJson<unknown>({ provider: API_FOOTBALL, url: `${BASE}/fixtures?league=${league}&season=${season}&from=${today}&to=${to}`, headers: headers(cfg.apiKey), ttlMs: 900_000, rateLimitPerMinute: 10, fetchImpl: cfg.fetchImpl });
    const fixtures = Envelope(z.array(Fixture)).parse(fx.data);
    const e1 = apiErrors(fixtures); if (e1) throw new ProviderError(e1, API_FOOTBALL);
    const byId = new Map(fixtures.response.map((f) => [f.fixture.id, f]));
    const events: NormalizedEvent[] = [];
    let page = 1, total = 1, last: Awaited<ReturnType<typeof requestJson>> | null = null;
    do {
      const r = await requestJson<unknown>({ provider: API_FOOTBALL, url: `${BASE}/odds?league=${league}&season=${season}&page=${page}`, headers: headers(cfg.apiKey), ttlMs: 600_000, rateLimitPerMinute: 10, fetchImpl: cfg.fetchImpl });
      last = r;
      const d = Envelope(z.array(Odds)).parse(r.data);
      const e2 = apiErrors(d); if (e2) throw new ProviderError(e2, API_FOOTBALL);
      for (const o of d.response) if (byId.has(o.fixture.id)) events.push(normalizeOdds(o, byId.get(o.fixture.id), r.fetchedAt));
      total = d.paging?.total ?? 1; page++;
    } while (page <= Math.min(total, 5));
    return { events, quota: quota(last?.headers ?? {}), fetchedAt: last?.fetchedAt ?? new Date().toISOString() };
  },
};
