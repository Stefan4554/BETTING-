# Architecture

## Principles

1. **The database owns the money.** Settlement, ledger postings, cash-outs, transfers, trade
   settlement, imports and demo resets are transactional `SECURITY DEFINER` functions with row
   locks. The browser never computes a stored financial value.
2. **One calculation engine.** `src/lib/finance` holds every formula (settlement, staking, CLV,
   arbitrage, trading, metrics, calibration, risk, FX, odds movement). It is pure, deterministic
   and unit-tested; its settlement core is parity-tested against SQL.
3. **Never invent data.** Odds come only from stored provider snapshots; FX only from stored
   rates; missing values render as “—” with a reason. Demo data is simulated, fictional and
   isolated.
4. **Isolation by default.** Row-level security on every table; financial tables are read-only
   to clients; secrets are encrypted and readable only by the service role.

## Request flow

```
Browser ── Server Components (pages) ── getContext() ──► Supabase (user JWT, RLS)
   │                                         │
   ├─ Server Actions (src/app/actions) ──────┤  Zod validation → RPC (place_bet, settle_bet …)
   │                                         │
   └─ Route handlers (/api/export/backup)    └─ analytics: loadAnalyticsBase → finance engine
Vercel Cron ─► /api/cron/{ingest,fx,maintenance} (CRON_SECRET) ─► service-role client
                     └─ provider adapters (The Odds API, API-Football) ─► odds_snapshots
```

## Code map

| Path | Responsibility |
| --- | --- |
| `supabase/migrations/0001` | Reference & market data: sports, leagues, configurable market types, bookmakers, events, markets, exchange rates, providers, connections, encrypted secrets, request logs, odds snapshots |
| `…/0002` | Bankrolls, ledger, bets, legs, notes, trades, executions, strategies, risk limits, goals, alerts, performance snapshots, saved views, audit logs |
| `…/0003` | Financial engine: settlement maths, ledger posting, bet lifecycle RPCs, bankroll RPCs, trading, closing-odds capture, performance snapshots, demo reset, signup bootstrap, integrity guards, audit triggers, grants |
| `…/0004` | Row-level security and table privileges |
| `…/0005` | Platform reference data (18 sports, markets, leagues, bookmakers, providers) |
| `…/0006` | Ingestion helpers (service role only) |
| `src/lib/finance` | Calculation engine (see FINANCIAL_MODEL.md) |
| `src/lib/server` | Request context, data loaders, analytics assembly, alerts, ingestion, odds board, reports, goals, crypto, cron auth |
| `src/lib/providers` | Provider abstraction, HTTP layer (timeouts, retries with backoff, token-bucket rate limiting, TTL cache, quota tracking, secret redaction), adapters |
| `src/app/actions` | Server actions: validated mutations returning `{ ok, data } \| { ok: false, error, fieldErrors }` |
| `src/app/(app)` | The 14 modules + alerts, all server-rendered with client islands |
| `src/components` | UI kit (Radix-based), charts (Recharts, validated palette), module views |
| `src/lib/demo` | Deterministic simulated dataset |

## Data model highlights

* **Catalogue rows** (`sports`, `leagues`, `market_types`, `bookmakers`, `exchange_rates`,
  `events`) are platform rows (`owner_id IS NULL`, read by all, written by the service role) or
  user rows (`owner_id = user`). Markets are data, not code: users add their own.
* **Workspace isolation:** every user-owned row that can be demo data has `is_demo`. The active
  mode lives in `user_settings.mode`; every query filters by it; demo rows are deleted only by
  `reset_demo_data` / `clear_demo_data`.
* **History preservation:** bets are soft-deleted, the ledger is append-only, odds snapshots are
  append-only (change-only + 30-minute heartbeat), and `audit_logs` records before/after images of
  bets, transactions, bankrolls, trades, strategies, risk limits, settings and API connections.
* **Idempotency:** `place_bet` accepts a client UUID (`client_ref`) so a double-submit returns the
  existing bet.

## Security model

| Concern | Mechanism |
| --- | --- |
| Authentication | Supabase Auth (password / magic link), session refresh in middleware, all app routes gated |
| Authorisation | RLS (forced) on all tables; financial tables select-only for clients; RPCs check `auth.uid()` ownership explicitly |
| Self-promotion | Profile updates cannot change `role` |
| Secrets | Provider keys AES-256-GCM encrypted (`API_KEY_ENCRYPTION_KEY`), stored in a table with RLS and no policies (service role only); only the last 4 characters are shown |
| Server-only code | `server-only` imports for env, Supabase admin client, crypto, ingestion |
| Input validation | Zod on every server action; CHECK constraints in the database |
| Spreadsheet injection | CSV/Excel exports neutralise `= + - @` prefixes |
| Cron | Bearer `CRON_SECRET`, constant-time compare |
| Provider rate limits | Token bucket per provider, minimum refresh interval per provider, manual refresh throttled |
| Headers | `X-Frame-Options: DENY`, `nosniff`, strict referrer, permissions policy |
| Open redirects | Auth callback only accepts same-site relative paths |

## Design decisions

* **Server actions + RPCs instead of an ORM:** every financial mutation is a single database
  function call, so the transaction boundary and row locks live next to the data, and the same
  rules apply to the UI, imports and the demo loader.
* **Analytics in TypeScript on the server:** flexible slicing (date ranges, display currency,
  conventions) without a materialised-view zoo; inputs come straight from stored records.
  `performance_snapshots` (daily, per bankroll) is available for long histories.
* **Odds snapshots are owner-scoped:** prices fetched with a user's own key stay private to that
  user (licensing); the optional platform key ingests shared data with `owner_id = NULL`.
