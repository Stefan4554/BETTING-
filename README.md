# EDGE INTELLIGENCE

A tennis-first sports analytics and betting intelligence terminal: live and upcoming matches, multi-bookmaker lines board, odds comparison, line-movement history with steam detection, a value engine (no-vig consensus, EV, fair odds, fractional Kelly), a surface-adjusted Elo prediction engine with walk-forward evaluation, a live win-probability model, a betting tracker with bankroll and CLV analytics, and configurable alerts.

> **Analytics only.** Nothing in this application guarantees profit. Model probabilities carry uncertainty that is shown explicitly, and large disagreements with the market are flagged as suspect, not as value.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui-style components · Recharts · TanStack Query · Zod · Supabase (Postgres, Auth, RLS, Realtime) · Vercel (hosting + cron).

## Quick start (demo mode, no keys)

```bash
npm install
cp .env.example .env.local        # NEXT_PUBLIC_DEMO_MODE=true by default
npm run dev                        # http://localhost:3000
```

Demo mode uses a deterministic **synthetic** dataset: fictional players, fictional tournaments and fictional bookmakers. A purple banner on every page says so. The Elo model, value engine, line history and tracker all run their real code on this data.

## Live mode

Set `NEXT_PUBLIC_DEMO_MODE=false` and add provider keys. Any provider without a key is shown as **NOT CONNECTED** and its sections stay empty with an explanation. The app never falls back to demo data silently. See [docs/API_PROVIDERS.md](docs/API_PROVIDERS.md) for exactly which subscriptions are needed.

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, module map, design decisions |
| [docs/SETUP.md](docs/SETUP.md) | Local installation, Supabase setup, first admin user |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel deployment, cron jobs, backups, production checklist |
| [docs/API_PROVIDERS.md](docs/API_PROVIDERS.md) | Required subscriptions and credentials, costs, rate limits |
| [docs/TESTING.md](docs/TESTING.md) | Test suites, what they cover, how to run them |
| [docs/CLAUDE_ARTIFACT.md](docs/CLAUDE_ARTIFACT.md) | Browser-only demo build that runs inside a Claude artifact |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | TypeScript, strict mode |
| `npm test` | Unit tests (engines, providers, analytics) |
| `scripts/test-db.sh` | Applies all migrations to a scratch Postgres DB and runs RLS tests |

## Status

Phase 1 (this release) is functional and tested; see the phase plan in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#roadmap).
