# BETTING EDGE PRO

Professional sports betting tracking, trading, bankroll management and quantitative analytics — a full web application for serious bettors, traders and syndicates.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui-style components on Radix · TanStack Table · Recharts · React Hook Form · Zod · Supabase (PostgreSQL, Auth, Row Level Security) · Vercel (hosting + cron).

> No odds, results or exchange rates are ever invented. Without a connected data provider the odds screens say so and every bet can be entered manually. The demo workspace is simulated, uses fictional teams, and is labelled on every page.

## What's in it

| Module | Highlights |
| --- | --- |
| **Overview** | 14 KPI cards and 15 configurable widgets (cumulative P&L, equity curve, daily/weekly/monthly P&L, ROI, CLV and win-rate trends, profit by sport/bookmaker/strategy, odds & stake distributions, exposure, goals). Global date filter with previous-period comparison. |
| **Bet Tracker** | Fast-entry form (press **N**), singles & accumulators, back & lay, pre-match & live, 30 columns, sorting, pagination, advanced filters, saved views, column chooser, bulk settle / edit / delete, duplicate, reopen, partial & full cash-out, Asian-handicap result helper, audit trail, CSV/Excel import with mapping & duplicate detection, CSV/Excel/JSON export. |
| **Live Trading** | Positions built from back/lay/cash-out executions, if-win/if-lose, worst-case exposure, green-up hedge suggestion, unrealised vs realised P&L, exchange commission, trade history with timestamps. |
| **Odds Monitor** | Stored bookmaker prices side by side, best price, implied & no-vig probabilities, per-book margin, movement since opening, suspensions, price-history charts, theoretical arbitrage with stake allocation, one-click “bet this” linked to the market (enables automatic CLV capture). |
| **Bankroll Manager** | Multiple bankrolls & currencies on an append-only ledger: deposits, withdrawals, adjustments, transfers (with FX), reservations & settlements, drawdowns, integrity check. |
| **Performance / Sports / CLV / Strategies** | ROI, yield, profit factor, Sharpe, Sortino, drawdown, recovery factor, streaks, variance, risk of ruin, expected vs realised ROI; breakdowns by sport, league, market, bookmaker, strategy, odds & stake band; CLV in both conventions; probability calibration (Brier, log loss, reliability diagram with Wilson intervals, skill vs market). |
| **Staking Calculator** | Full / ½ / ¼ / 1/10 Kelly, flat, % bankroll, units, fixed-profit, with max-stake / %-bankroll / exposure caps; arbitrage & dutching calculator. |
| **Risk Management** | Exposure by event, sport, league, market, bookmaker, bankroll and manual correlation groups; daily/weekly loss; drawdown; concentration (HHI); configurable limits with optional hard enforcement in the database; alerts. |
| **Reports** | Daily, weekly, monthly, annual, sport, bookmaker, strategy, CLV, risk, bankroll and live-trading reports → PDF, Excel, CSV, print. |
| **Settings** | Display & conventions, currencies & historical FX snapshots (ECB job + manual), configurable sports/leagues/markets, data-provider connections (encrypted keys, test, quota, request log), demo workspace, security. |

## Quick start (local)

```bash
npm install
npx supabase start                 # local Postgres + Auth (Docker)
npx supabase db reset              # applies supabase/migrations
cp .env.example .env.local         # paste the URL/anon/service keys printed by `supabase start`
openssl rand -hex 32               # → API_KEY_ENCRYPTION_KEY
npm run dev                        # http://localhost:3000
```

Register, then flip the **LIVE / DEMO** switch in the top bar to load a simulated workspace. Full instructions: [docs/SETUP.md](docs/SETUP.md).

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, data flow, module map, security model, design decisions |
| [docs/FINANCIAL_MODEL.md](docs/FINANCIAL_MODEL.md) | Ledger accounting, settlement formulas, every metric's definition and edge cases |
| [docs/SETUP.md](docs/SETUP.md) | Local development with the Supabase CLI |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Supabase + Vercel production deployment, cron, secrets, checklist |
| [docs/API_PROVIDERS.md](docs/API_PROVIDERS.md) | Odds providers, subscriptions, quotas, adding a new adapter |
| [docs/TESTING.md](docs/TESTING.md) | Unit, SQL, parity and end-to-end suites |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Development server / production build / serve |
| `npm run typecheck` | TypeScript, strict |
| `npm test` | 159 unit tests: settlement, staking, CLV, arbitrage, trading, metrics, calibration, risk, FX, odds formats, providers, import/export, encryption, demo data |
| `npm run test:db` | Applies all migrations to a scratch Postgres and runs the SQL financial & data-isolation suite |
| `npm run test:parity` | TypeScript ↔ SQL settlement parity on 600 randomised bets (needs `DATABASE_URL`) |
| `npm run test:e2e` | Browser end-to-end flows against a running app (Playwright) |

## Acceptance criteria

| # | Criterion | Where it is verified |
| --- | --- | --- |
| 1 | Secure registration & login | Supabase Auth, middleware gate, RLS on every table; e2e signup |
| 2 | Add, edit, settle bets | Bet Tracker; SQL suite (`place/update/settle/reopen/delete_bet`); e2e flow |
| 3 | Bankroll balances update correctly | Append-only ledger + invariants in `financial_test.sql`; e2e “€1,150 after win” |
| 4 | Dashboard KPIs from real records | All KPIs computed server-side from stored bets; e2e checks ROI and CLV values |
| 5 | Financial calculations pass automated tests | `tests/finance/*`, `financial_test.sql`, parity test |
| 6 | CLV works | Both conventions, manual entry, automatic capture from snapshots (SQL + unit tests) |
| 7 | Kelly works | `staking.test.ts`, Staking Calculator, Kelly button in the bet form |
| 8 | All sports via configurable models | 18 seeded sports, user-defined sports/leagues/markets in Settings |
| 9 | Live and pre-match tracking | `is_live` on bets, Live Trading module, filters and breakdowns |
| 10 | Odds APIs configurable & testable | Settings → Data sources: encrypted key, test, browse sports, fetch, quota, request log |
| 11 | Historical odds stored | `odds_snapshots` (change-only + heartbeat), opening/closing marking, history charts |
| 12 | Risk alerts | Risk engine + limits, alert center, optional DB enforcement (SQL + e2e) |
| 13 | Reports export | PDF / Excel / CSV / print (e2e downloads) |
| 14 | Data import | CSV & Excel with mapping, preview, validation, duplicates (e2e) |
