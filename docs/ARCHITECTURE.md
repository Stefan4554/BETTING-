# Architecture

## Principles

1. **Never invent data.** Every field a provider does not supply is `null` and renders as `—` with a "not provided" tooltip. Models return `null` when history is insufficient; the value engine then skips the selection rather than inventing a probability.
2. **Source attribution everywhere.** Every match, price and stat carries `source.provider` and timestamps (`fetchedAt`, provider `updatedAt`). Prices show the bookmaker and the time since the last update.
3. **Demo is explicit.** `NEXT_PUBLIC_DEMO_MODE=true` switches the whole data service to a synthetic dataset. Players, tournaments and bookmakers are fictional, `provider = "demo"`, and a banner is shown. In live mode, missing providers are NOT CONNECTED, with no fallback.
4. **Keys stay on the server.** Provider keys are read only in `src/lib/env.ts` (`server-only`) and used only by adapters on the server. The browser only ever talks to our own API routes.
5. **Pure engines.** All maths (odds, de-vig, consensus, Kelly, EV, Elo, evaluation, live probability, alerts, bet P/L) is pure TypeScript with unit tests, and has no I/O.

## High-level flow

```
               ┌────────────────────────── Vercel ───────────────────────────┐
 Browser ──►   │ Next.js App Router                                          │
 (React,       │  ├─ Server Components (pages) ─┐                            │
 TanStack      │  ├─ API routes (/api/*) ───────┼─► Data service ──┬─► Demo dataset (demo mode)
 Query,        │  └─ Middleware (auth gate)     │   (lib/data)     ├─► Provider adapters ──► The Odds API
 Supabase      │                                │                  │   (lib/providers)     ├► Sportradar Tennis v3
 Realtime)     │  Cron (vercel.json) ───────────┘                  │                       └► API-Tennis
               │   /api/cron/ingest-odds      ─► repository ───────┴─► Supabase Postgres (RLS)
               │   /api/cron/ingest-matches                             odds_snapshots, matches, …
               │   /api/cron/evaluate-alerts  ─► notifications ─► Realtime ─► browser
               └─────────────────────────────────────────────────────────────┘
```

## Module map

| Path | Responsibility |
| --- | --- |
| `src/lib/domain.ts` | Normalized domain types shared by every layer |
| `src/lib/env.ts` | Zod-validated server env; mode helpers |
| `src/lib/engine/odds.ts` | Implied probability, fair odds, overround, de-vig (multiplicative / additive / power / Shin), EV, CLV, odds conversion |
| `src/lib/engine/consensus.ts` | Weighted no-vig market consensus across bookmakers (sharp books weighted ×3, stale books excluded), best price, average |
| `src/lib/engine/kelly.ts` | Full and fractional Kelly with a cap and model-confidence shrinkage toward the market |
| `src/lib/engine/value.ts` | Value opportunity evaluation: EV, edge, fair odds, EV at the pessimistic interval bound, confidence grade, warnings, SUSPECT flag |
| `src/lib/engine/elo.ts` | Surface-adjusted Elo (FiveThirtyEight K-factor), chronological fit guard, prediction with interval |
| `src/lib/engine/evaluation.ts` | Brier, log loss, accuracy, calibration bins, ECE, chronological split, walk-forward backtest |
| `src/lib/engine/live-prob.ts` | Point → game → tiebreak → set → match Markov model; serve-point calibration to the pre-match probability |
| `src/lib/engine/movement.ts` | Shortening/drifting, steam detection, reverse line movement (null without betting-percentage data) |
| `src/lib/engine/player-analytics.ts` | Form, surface splits, ranking-band splits, favourite/underdog, hold/break, tiebreaks, workload, H2H |
| `src/lib/engine/bets.ts` | Bet P/L (mirrors the SQL trigger), ROI/yield/win rate/CLV, grouping by period/sport/market/book, CSV with injection guard |
| `src/lib/engine/alerts.ts` | Alert rule evaluation on before/after market state, with cooldowns |
| `src/lib/providers/http.ts` | Shared HTTP: timeout, retry with backoff (429/5xx), `retry-after`, token-bucket rate limit, TTL cache, usage and quota tracking, key redaction |
| `src/lib/providers/*.ts` | Adapters: auth, request, Zod validation of the response, normalization |
| `src/lib/providers/registry.ts` | Provider catalogue, status (connected / NOT CONNECTED / error / not implemented), factories |
| `src/lib/data/service.ts` | The only entry point pages use; switches demo/live, links odds events to matches by surname + time, trains the model, computes value |
| `src/lib/data/repository.ts` | Service-role persistence: upsert players/tournaments/matches, append odds snapshots (skips unchanged prices), history reads, api_logs |
| `src/lib/data/board.ts` | Lines-board rows, comparison rows, history series (pure) |
| `src/app/(terminal)/*` | 18 pages |
| `src/app/api/*` | JSON API (rate-limited, Zod-validated) and cron workers |
| `supabase/migrations/*` | Schema, RLS, worker objects |

## Database

Normalized Postgres schema (`supabase/migrations/20261119000001_core_schema.sql`):

- **Reference:** `players`, `player_rankings`, `tournaments`, `matches`, `match_statistics`, `head_to_head`, `provider_entity_map` (cross-provider identity)
- **Markets:** `bookmakers`, `betting_markets` (match × market × line × period), `odds_snapshots` (append-only time series; `is_live`, `is_closing`), views `odds_latest` and `odds_opening`
- **Models:** `model_versions` (params, train cut-off, metrics, calibration), `predictions` (probability, interval, sample sizes, data quality), `value_opportunities`
- **User:** `users` (profile, role, staking defaults), `bets` (profit computed by trigger), `bankroll_transactions` (ledger), `alert_rules`, `notifications`
- **Ops:** `api_providers` (no plain-text keys; `vault_secret_id` for Supabase Vault), `api_logs`, `alert_market_state`

Every provider-sourced row has `(provider, provider_ref)` with a unique constraint, so ingestion is idempotent. Statistics columns are nullable and never default to 0.

**RLS** (`…002_rls_policies.sql`): market and reference data can be read by authenticated users, and only the service role writes it. User data is owner-only for select, insert, update and delete. Users cannot change their own role. Provider config and logs are admin-only. These rules are verified by `supabase/tests/rls_test.sql`.

**Realtime:** `odds_snapshots`, `matches` and `notifications` are in the `supabase_realtime` publication. The Alerts page subscribes to new notifications.

## Odds ↔ match linking

The Odds API gives player names only. In live mode, odds events are linked to Sportradar/API-Tennis matches by surname pair (in either order) and a start time within 12 hours. If home and away are swapped, the selections are flipped. Events that cannot be linked are still shown (names only, no stats), never merged by guesswork. Phase 2 adds a `provider_entity_map` review queue for ambiguous names.

## Prediction engine

- **Elo:** `K = 250 / (n + 5)^0.4`, ×1.1 for best-of-5, separate surface ratings blended 50/50 with overall. Retirements and walkovers are excluded from updates when flagged.
- **Leakage guard:** `fit()` throws on unsorted input. The backtest predicts each test match *before* updating with its result.
- **Insufficient data:** players with fewer than 10 rated matches get no probability. The whole model stays off until 500 completed matches are stored.
- **Interval:** a heuristic SD of 350/√n Elo per player, mapped to roughly 90%. It is labelled as heuristic in the UI.
- **Live probability:** the Markov model is calibrated so it reproduces the pre-match probability at 0-0, then evaluated at the live score. It is paused while a match is suspended or interrupted.

## Value engine

For each priced selection: bookmaker implied `1/odds`, no-vig consensus, model `p`, `EV = p × odds − 1`, edge `p − 1/odds`, fair odds `1/p`, EV at the interval's lower bound, and a fractional-Kelly stake. For sizing, the model probability is shrunk toward the market by the user's *model confidence*. The stake is capped. Opportunities pass only if EV ≥ the minimum, data quality ≥ the minimum, and |model − market| ≤ the divergence limit (otherwise they are SUSPECT). Confidence (low/medium/high) depends on data quality, interval width and consensus depth.

## Security

- Supabase Auth (email/password, magic link). Middleware gates all pages when Supabase is configured. `/api/cron/*` uses `CRON_SECRET`.
- Role-based access: `user` / `analyst` / `admin`. API management and provider tests are admin-only.
- Zod validation on every API input. Rate limiting is per IP per route (in-memory; see DEPLOYMENT for a shared store).
- Security headers (`X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a permissions policy). `poweredByHeader` is off.
- Provider API keys are redacted from all logged URLs. CSV export guards against formula injection. Auth redirects reject open-redirect targets.

## Roadmap

**Phase 1 (done):** everything above.

**Phase 2:**
- Sportradar Odds Comparison adapter (mapping, plus player props)
- Historical backfill job for model training (Sportradar competitor summaries; check licence terms for any third-party dataset)
- Recent-form, serve/return and fatigue features, with an ensemble and stacked calibration
- Persisted `predictions` and `value_opportunities` with model versioning
- Admin key entry through Supabase Vault (keys never readable from the client)
- Shared rate-limit store (Upstash Redis)
- Entity-resolution review queue
- Football, basketball and ice hockey activation (the schema and `sport_code` already support them)
- Customizable dashboard widget layout
