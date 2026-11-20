# Odds data providers

Odds are only ever shown from stored provider snapshots. Without a connected provider the Odds
Monitor and Live Trading pages say so, and all bets can still be entered manually.

| Provider | Adapter | Data | Auth | Limits | Notes |
| --- | --- | --- | --- | --- | --- |
| [The Odds API](https://the-odds-api.com/liveapi/guides/v4/) | `src/lib/providers/the-odds-api.ts` | Multi-sport bookmaker odds (h2h, spreads, totals, outrights), in-play once started | `apiKey` query param | Credits: each `/odds` call costs markets × regions; quota in `x-requests-*` headers | `/sports` is free; recommended starting point |
| [API-Football](https://www.api-football.com/documentation-v3) | `src/lib/providers/api-football.ts` | Football fixtures + pre-match odds (1X2, O/U, Asian handicap, BTTS, double chance) | `x-apisports-key` header | Free tier 100 requests/day; min refresh 300 s | League IDs + season configured per connection |
| Sportradar Odds Comparison | — (listed, not implemented) | Enterprise feeds | `api_key` | Contract | Adapter can be added via the provider interface |

## How a connection works

1. The key is posted to a server action, encrypted with AES-256-GCM and stored in
   `api_connection_secrets` (service-role only). The browser only ever sees the last 4 characters.
2. **Test** calls a cheap endpoint, records latency/quota, sets status (`ok` / `error` /
   `rate_limited`), writes a request-log row and raises an `api_failure` alert on failure.
3. **Fetch now** / the cron job call `ingest()`:
   * provider → `NormalizedEvent[]` (events, markets with lines, per-bookmaker quotes),
   * upsert events (owner = the connection's user) and markets,
   * insert snapshots only when price/line/suspension changed or 30 minutes passed,
   * mark closing snapshots (last pre-start price) and copy closing odds onto linked bets
     (reference bookmaker from Settings, else the bet's own bookmaker),
   * raise odds-movement alerts for markets with pending bets.
4. Every HTTP request is logged (`api_request_logs`) with redacted URL, status, duration, cache
   hit, cost and error. The HTTP layer retries 429/5xx with exponential backoff (honouring
   `Retry-After`), never retries other 4xx, rate-limits per provider and caches responses briefly.

## Adding a provider

Implement `OddsProvider` (`src/lib/providers/types.ts`):

```ts
interface OddsProvider {
  id: string; name: string;
  test(cfg): Promise<TestResult>;
  listSports(cfg): Promise<ProviderSport[]>;
  fetchOdds(cfg, providerSportKey): Promise<{ events: NormalizedEvent[]; quota: QuotaInfo; fetchedAt: string }>;
}
```

register it in `registry.ts`, add a row to `odds_providers` with `implemented = true`, and map
its bookmaker keys in `bookmakers.provider_keys` (unknown bookmakers are created automatically).
