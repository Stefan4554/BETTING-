/** Provider abstraction: every odds source normalises into these shapes. */
export interface ProviderConfig {
  apiKey: string;
  regions?: string;          // The Odds API: "eu,uk"
  markets?: string;          // The Odds API: "h2h,spreads,totals"
  sports?: string[];         // provider sport/league keys to poll
  season?: number;           // API-Football
  fetchImpl?: typeof fetch;
}

export interface ProviderSport { key: string; title: string; group: string; sportKey: string; active: boolean; hasOutrights: boolean }

export interface NormalizedQuote { bookmakerKey: string; bookmakerName: string; selection: string; line: number | null; odds: number; updatedAt: string | null; suspended?: boolean }
export interface NormalizedMarket { key: string; name: string; line: number | null; quotes: NormalizedQuote[] }
export interface NormalizedEvent {
  externalId: string;
  sportKey: string;          // our sports.key
  providerSportKey: string;
  leagueName: string | null;
  home: string | null;
  away: string | null;
  name: string;
  startTime: string;
  isLive: boolean;
  markets: NormalizedMarket[];
}

export interface QuotaInfo { used: number | null; remaining: number | null; lastCost: number | null }
export interface TestResult { ok: boolean; message: string; quota?: QuotaInfo; latencyMs?: number }

export interface OddsProvider {
  id: string;
  name: string;
  test(cfg: ProviderConfig): Promise<TestResult>;
  listSports(cfg: ProviderConfig): Promise<ProviderSport[]>;
  fetchOdds(cfg: ProviderConfig, providerSportKey: string): Promise<{ events: NormalizedEvent[]; quota: QuotaInfo; fetchedAt: string }>;
}
