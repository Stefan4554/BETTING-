# Testing

| Suite | Command | Covers |
| --- | --- | --- |
| Unit (Vitest) | `npm test` | `tests/finance/*`: win/loss/void/half results, cash-outs (full & partial), accumulators, Asian handicap & quarter totals, lay bets, commission, rounding vs PostgreSQL, Kelly & staking systems & caps, EV/edge, CLV (both conventions, lay), arbitrage (2/3-way, commission, max stake, FX), trading positions & green-up, drawdown, streaks, Sharpe/Sortino, risk of ruin, grouping, periods, date ranges, calibration (Brier, log loss, Wilson), risk aggregation & limits, FX snapshots/inverse/triangulation, odds format parsing. Plus providers (normalisation, quota, 401/HTTP-200 errors, retry/caching), import mapping, CSV injection, key encryption, demo dataset invariants. |
| Database | `npm run test:db` | `supabase/tests/financial_test.sql` on all migrations: signup bootstrap, every settlement type, double-settlement rejection, accumulators, reopen/edit/delete with ledger reversal, bulk settle atomicity, withdrawals/overdraft, transfers with FX, FX-missing rejection, locked FX on settlement, ledger invariants, trading P&L and commission, risk-limit enforcement, imports with duplicates/errors, blocked direct writes, **data isolation between users**, demo reset/clear isolation, closing-odds capture. |
| Parity | `npm run test:parity` (needs `DATABASE_URL`) | TypeScript vs SQL `bet_profit`, liability, payout on 600 random bets; leg factors; trade P&L; trade reservation ledger postings |
| Email (integration) | `SUPABASE_TEST_URL=… SUPABASE_TEST_SERVICE_KEY=… npx vitest run tests/email.db.test.ts` | Real database outbox: preferences, demo exclusion, sent/retry/failed transitions, dedupe, concurrent workers send once, email-only alerts, unconfigured provider |
| Live odds | `THE_ODDS_API_KEY=… npm run test:live-odds` | Real HTTP to the provider (no mocks). Reports VERIFIED / FAILED / NOT VERIFIED |
| Lint | `npm run lint` | ESLint (next/core-web-vitals + typescript) |
| End-to-end | `npm run test:e2e` (app + Supabase running) | flow3: trade reservation on open / partial close / full close with ledger verification, accumulator saved leg-by-leg and settled as partial loss, date basis + presets, risk-adjusted panel, notification preferences + test email status, odds connection test status. |
| End-to-end (cont.) | | Fresh signup, deposit, fast-entry bet, settle with closing odds, ledger verification, dashboard ROI/CLV, CSV import (mapping, errors, duplicates), CSV export, report PDF/Excel/CSV, JSON backup (auth required, no secrets), staking page, strategy creation, enforced risk limit rejection |

Run the SQL suite against the local Supabase stack instead of a scratch database:

```bash
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests and a production build, and in a
second job applies the migrations to Postgres 16 and runs the SQL and parity suites.
