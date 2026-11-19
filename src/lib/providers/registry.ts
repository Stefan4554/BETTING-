import "server-only";
import { env } from "../env";
import type { ProviderInfo } from "../domain";
import { usageStats } from "./http";
import { TheOddsApi, ODDS_API_ID } from "./the-odds-api";
import { SportradarTennis, SPORTRADAR_TENNIS_ID } from "./sportradar-tennis";
import { ApiTennis, API_TENNIS_ID } from "./api-tennis";

export const SPORTRADAR_ODDS_ID = "sportradar_odds";

interface Definition extends Omit<ProviderInfo, "status" | "statusDetail" | "usage"> {
  implemented: boolean;
  key: () => string | undefined;
}

const DEFINITIONS: Definition[] = [
  {
    id: ODDS_API_ID,
    name: "The Odds API",
    kind: "odds",
    envVar: "THE_ODDS_API_KEY",
    subscription: "Paid plan recommended (free tier is 500 credits/month). Each odds call costs markets × regions credits.",
    docsUrl: "https://the-odds-api.com/liveapi/guides/v4/",
    capabilities: ["Pre-match & in-play odds", "Match winner (h2h)", "Game handicap (spreads)", "Total games (totals)", "40+ bookmakers by region"],
    implemented: true,
    key: () => env().THE_ODDS_API_KEY,
  },
  {
    id: SPORTRADAR_TENNIS_ID,
    name: "Sportradar Tennis API v3",
    kind: "sports_data",
    envVar: "SPORTRADAR_TENNIS_API_KEY",
    subscription: "Sportradar Tennis v3 trial (30 days) or commercial production licence (contact sales).",
    docsUrl: "https://developer.sportradar.com/tennis/reference/overview",
    capabilities: ["Schedules & results", "Live scores & game state", "Match statistics", "ATP/WTA rankings", "Player profiles", "Head-to-head"],
    implemented: true,
    key: () => env().SPORTRADAR_TENNIS_API_KEY,
  },
  {
    id: API_TENNIS_ID,
    name: "API-Tennis",
    kind: "sports_data",
    envVar: "API_TENNIS_KEY",
    subscription: "API-Tennis paid plan (14-day trial available). Lower-cost alternative to Sportradar.",
    docsUrl: "https://api-tennis.com/documentation",
    capabilities: ["Fixtures", "Livescores", "Point-by-point (plan dependent)", "Standings", "H2H"],
    implemented: true,
    key: () => env().API_TENNIS_KEY,
  },
  {
    id: SPORTRADAR_ODDS_ID,
    name: "Sportradar Odds Comparison API",
    kind: "odds",
    envVar: "SPORTRADAR_ODDS_API_KEY",
    subscription: "Sportradar Odds Comparison (pre-match / live / player props) commercial licence.",
    docsUrl: "https://developer.sportradar.com/odds/reference/oc-overview",
    capabilities: ["Licensed bookmaker odds", "Odds history", "Player props"],
    implemented: false,
    key: () => env().SPORTRADAR_ODDS_API_KEY,
  },
];

export function providerInfos(): ProviderInfo[] {
  return DEFINITIONS.map((d) => {
    const key = d.key();
    const u = usageStats.get(d.id);
    let status: ProviderInfo["status"];
    let statusDetail: string;
    if (!d.implemented) {
      status = "not_implemented";
      statusDetail = key ? "Key present, but the adapter mapping is not built yet (phase 2)." : "NOT CONNECTED — adapter planned for phase 2.";
    } else if (!key) {
      status = "not_connected";
      statusDetail = `NOT CONNECTED — set ${d.envVar} on the server.`;
    } else if (u?.lastError && u.errors > 0 && u.lastRequestAt && u.requests === u.errors) {
      status = "error";
      statusDetail = u.lastError;
    } else {
      status = "connected";
      statusDetail = u?.lastRequestAt ? `Last request ${u.lastRequestAt}` : "Key configured — no requests made yet in this server instance.";
    }
    const { implemented: _i, key: _k, ...info } = d;
    return {
      ...info,
      status,
      statusDetail,
      usage: u
        ? { used: u.quotaUsed, remaining: u.quotaRemaining, lastRequestAt: u.lastRequestAt, lastError: u.lastError }
        : undefined,
    };
  });
}

export function oddsApi(): TheOddsApi | null {
  const e = env();
  return e.THE_ODDS_API_KEY ? new TheOddsApi({ apiKey: e.THE_ODDS_API_KEY, regions: e.THE_ODDS_API_REGIONS, markets: e.THE_ODDS_API_MARKETS }) : null;
}

export function sportradarTennis(): SportradarTennis | null {
  const e = env();
  return e.SPORTRADAR_TENNIS_API_KEY ? new SportradarTennis({ apiKey: e.SPORTRADAR_TENNIS_API_KEY, accessLevel: e.SPORTRADAR_TENNIS_ACCESS_LEVEL }) : null;
}

export function apiTennis(): ApiTennis | null {
  const e = env();
  return e.API_TENNIS_KEY ? new ApiTennis({ apiKey: e.API_TENNIS_KEY }) : null;
}
