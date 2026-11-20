# Local setup

Requirements: Node 20+ (22 recommended), Docker (for the Supabase CLI local stack).

```bash
npm install
npx supabase start          # Postgres :54322, API :54321; prints URL, anon & service keys
npx supabase db reset       # applies supabase/migrations/* from scratch
cp .env.example .env.local
```

Fill `.env.local`:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key from `supabase start` |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key from `supabase start` |
| `API_KEY_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `CRON_SECRET` | any random string (for calling cron routes locally) |

```bash
npm run dev                  # http://localhost:3000
```

1. Register (local Supabase does not require email confirmation by default).
2. A **Main** bankroll (EUR) is created automatically. Deposit funds in **Bankroll Manager**.
3. Add bets with **New bet** (or press **N**), or import a CSV/Excel file in the Bet Tracker.
4. Toggle **DEMO** in the top bar to load the simulated workspace; switch back to **LIVE** at any
   time. Demo data never mixes with live data.

## Odds data

Go to **Settings → Data sources**, paste a key for The Odds API or API-Football, choose sports or
leagues to poll (use *Browse sports*), **Test**, then **Fetch now**. Scheduled refresh runs via
`/api/cron/ingest`; locally you can trigger it with:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/fx    # ECB FX rates
```

## Exchange rates

Cross-currency bets need a rate. Run the FX job (ECB reference rates, EUR crosses, triangulated
for other pairs) or add rates manually in **Settings → Currencies & FX**. A bet can also carry an
explicit rate entered in the bet form.

## Regenerating database types

After changing migrations: `npm run db:types` (requires the local stack).
