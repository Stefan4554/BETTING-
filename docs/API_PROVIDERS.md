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
2. **Test connection** sends a real request with the server-stored key (The Odds API: `/v4/sports`,
   free of credits; API-Football: `/status`), validates the response schema, parses it and stores the
   full result (`api_connections.last_test_result`: checks, latency, quota, sample counts).
   **Test + odds sample** additionally fetches and parses one odds payload (uses credits).
   Status is classified, never optimistic:

   | Status | Meaning |
   | --- | --- |
   | `ok` | provider responded and the payload parsed |
   | `auth_error` | 401/403 or provider auth error (incl. API-Football's HTTP-200 `errors.token`) |
   | `rate_limited` | 429 or exhausted quota (e.g. `OUT_OF_USAGE_CREDITS`) |
   | `outage` | 5xx after retries |
   | `unreachable` | DNS / network / firewall / timeout — **the integration was not verified** |
   | `invalid_response` | non-JSON or unexpected structure |

   Failures write a request-log row and raise an `api_failure` alert (in-app/email per preferences).
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

## Live verification

Mocked-transport tests (`tests/providers.test.ts`) cover valid key, invalid key, quota exhaustion,
rate limits with `Retry-After`, timeouts, network failure, 5xx outages and malformed payloads. They do
**not** prove the live integration. To verify against the real provider:

```bash
THE_ODDS_API_KEY=<your key> npm run test:live-odds                     # exit 0 = VERIFIED
API_FOOTBALL_KEY=<your key> LIVE_ODDS_PROVIDER=api_football npm run test:live-odds
```

Exit 1 = provider reached but rejected (bad key, quota, outage, malformed); exit 2 = not verified
(no key or provider unreachable). Then repeat **Test connection** and **Fetch now** in the deployed app.
