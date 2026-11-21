# Deployment (Supabase + Vercel)

> Status: the project is **deployment-ready** (production build, type check and lint pass; all
> migrations apply cleanly). It has **not** been deployed from the development environment because
> no Vercel or Supabase production credentials were available there. Follow the steps below.

## 1. Supabase project

1. Create a project at https://supabase.com (region close to your Vercel region).
2. Apply migrations **in order** (`20261120000001` … `20261121000008`):
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push            # applies every pending file in supabase/migrations
   ```
   `0007_enum_extensions` must be committed before `0008_review_fixes` (new enum values); `db push`
   applies each file in its own transaction, which satisfies this. Never edit an applied migration;
   add a new one.
3. Verify (SQL editor):
   ```sql
   select version from supabase_migrations.schema_migrations order by version;   -- 8 rows
   select count(*) from sports;      -- 18
   select relrowsecurity, relforcerowsecurity from pg_class where relname = 'bets';  -- t, t
   ```
4. **Auth → URL configuration:** Site URL = `https://<your-domain>`; Redirect URLs include
   `https://<your-domain>/auth/callback`. Enable email confirmations and configure SMTP for production.

## 2. Environment variables

| Variable | Required | Scope | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | public | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | public | anon key (RLS protects all data) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **server only** | ingestion, encrypted keys, email worker. Never `NEXT_PUBLIC_` |
| `API_KEY_ENCRYPTION_KEY` | yes | server only | `openssl rand -hex 32`; keep stable (rotation invalidates stored provider keys) |
| `CRON_SECRET` | yes | server only | ≥16 random chars; Vercel Cron sends it as `Authorization: Bearer` |
| `RESEND_API_KEY` | for email | server only | `re_…` |
| `ALERTS_FROM_EMAIL` | for email | server only | sender on a domain verified in Resend |
| `RESEND_WEBHOOK_SECRET` | for "delivered" status | server only | `whsec_…` |
| `APP_URL` | recommended | server only | `https://<your-domain>` (links in emails) |
| `THE_ODDS_API_KEY`, `PLATFORM_ODDS_SPORTS`, `PLATFORM_ODDS_REGIONS` | optional | server only | shared platform odds feed; users normally add their own keys in the app |

Check them locally without printing values: `vercel env pull .env.production.local && set -a && . ./.env.production.local && npm run check:env`.

## 3. Vercel

```bash
npm i -g vercel
vercel login
vercel link                      # create/link the project (framework auto-detected: Next.js)
vercel env add SUPABASE_SERVICE_ROLE_KEY production   # repeat for every variable above
vercel deploy --prod
```

`vercel.json` configures: `npm ci` install, cron jobs, and 300 s max duration for cron routes.

| Cron | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/ingest` | every 10 min | odds ingestion (each connection only when its own refresh interval elapsed) |
| `/api/cron/email` | every 5 min | email outbox delivery + retries |
| `/api/cron/fx` | weekdays 16:30 UTC | ECB reference rates |
| `/api/cron/maintenance` | daily 03:15 UTC | closing prices, CLV capture, history pruning |

Vercel **Hobby** plans only run crons once per day. On Hobby, either upgrade, or call the routes from
an external scheduler with the bearer token (e.g. `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/email`).
Emails are also delivered immediately after each mutation (`after()`), so the email cron is the retry path.

## 4. Resend (email)

1. Add and verify your sending domain (DNS records) in Resend.
2. Create an API key → `RESEND_API_KEY`; set `ALERTS_FROM_EMAIL`.
3. Webhooks → add `https://<domain>/api/webhooks/resend` with events `email.sent`, `email.delivered`,
   `email.bounced`, `email.complained`, `email.delivery_delayed`; copy the signing secret → `RESEND_WEBHOOK_SECRET`.

## 5. Production verification (do not consider the deployment done until all pass)

1. `curl https://<domain>/api/health` → `"ok": true`, every `config` flag you configured `true`,
   `db.migration_0008_* : true`.
2. Register a user; confirm the email; sign in.
3. Deposit, add a bet, settle it; **Bankroll → Verify ledger** succeeds.
4. **Settings → Notifications:** enter your address, **Send test email** → status `sent`; after the
   webhook arrives the delivery log shows `delivered`.
5. **Settings → Data sources:** add a provider key, **Test connection** → `Verified`; **Test + odds sample**
   shows events parsed; **Fetch now** fills the Odds Monitor.
6. `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/email` → JSON with `ok: true`.
7. Optional: `E2E_BASE_URL=https://<domain> bash tests/e2e/run.sh` against a staging deployment
   (creates test users; do not run against production data).
