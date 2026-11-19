# Setup

## Requirements

- Node.js 20+ (22 recommended) and npm
- For live mode: a Supabase project, plus provider keys (see [API_PROVIDERS.md](API_PROVIDERS.md))
- Optional: the Supabase CLI for local Postgres, and `psql` for the SQL tests

## 1. Install

```bash
npm install
cp .env.example .env.local
npm run dev
```

With `NEXT_PUBLIC_DEMO_MODE=true` (the default in `.env.example`) everything works offline with synthetic data.

## 2. Supabase

1. Create a project at https://supabase.com.
2. Apply the migrations in order. Either:
   - **CLI:** `supabase link --project-ref <ref>` then `supabase db push`, or
   - **SQL editor:** run each file in `supabase/migrations/` in filename order.
3. Copy **Project URL**, **anon key** and **service_role key** (Settings → API) into `.env.local`.
4. Auth → URL Configuration: add `http://localhost:3000/auth/callback` and your production `https://<domain>/auth/callback` to the redirect URLs.
5. Restart `npm run dev`. All pages now need sign-in.

### First admin

Sign up through `/login`, then in the SQL editor:

```sql
update public.users set role = 'admin' where email = 'you@example.com';
```

Admins can see **API management** and run provider connection tests.

## 3. Live data

```bash
NEXT_PUBLIC_DEMO_MODE=false
THE_ODDS_API_KEY=...
SPORTRADAR_TENNIS_API_KEY=...        # or API_TENNIS_KEY=...
SPORTRADAR_TENNIS_ACCESS_LEVEL=trial
```

`NEXT_PUBLIC_*` values are compiled into the bundle, so restart the dev server (or rebuild) after you change them. Open **API management** and press **Test connection** for each provider.

## 4. Background jobs locally

The cron endpoints need `CRON_SECRET`:

```bash
export CRON_SECRET=$(openssl rand -hex 32)   # also put it in .env.local
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest-matches
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest-odds
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/evaluate-alerts
```

Line history, closing odds and model-training data build up from these runs. The prediction engine stays off (with an explanation) until 500 completed matches are stored.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Everything says NOT CONNECTED | Live mode without keys. Add keys or set `NEXT_PUBLIC_DEMO_MODE=true`. |
| Redirect loop to /login | Supabase redirect URL not allowed, or cookies blocked |
| API management says "Administrators only" | Set `role = 'admin'` for your user (see above) |
| Odds exist but no history | Cron not running, or `SUPABASE_SERVICE_ROLE_KEY` missing |
| Predictions "insufficient history" | Not enough completed matches stored yet (needs a backfill, which is phase 2) |
