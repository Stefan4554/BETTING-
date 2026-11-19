# Deployment (Vercel + Supabase)

## Steps

1. Push the repository to GitHub and import it in Vercel (framework: Next.js).
2. Set the environment variables from `.env.example` in Vercel → Settings → Environment Variables, for Production (and Preview if wanted). Mark keys as **Sensitive**.
3. Set `CRON_SECRET`. Vercel Cron sends it automatically as `Authorization: Bearer …`.
4. Deploy. The `vercel.json` cron schedule is:

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/ingest-odds` | every 10 min | Snapshot all tennis odds into `odds_snapshots` (unchanged prices skipped) and mark closing odds |
| `/api/cron/ingest-matches` | every 15 min | Upsert schedules and results, and store final match statistics |
| `/api/cron/evaluate-alerts` | every 10 min | Evaluate alert rules, write notifications (Realtime pushes them) and send email |

> **Vercel plan:** sub-daily cron schedules need **Vercel Pro**. On Hobby, use an external scheduler (GitHub Actions `schedule:`, Supabase `pg_cron` + `pg_net`, or cron-job.org) that calls the same URLs with the bearer header.

> **Quota:** at a 10-minute interval, The Odds API uses roughly `markets × regions × active tournaments × 4,320` credits a month. Adjust the schedule to fit your plan.

5. In Supabase Auth, add `https://<your-domain>/auth/callback` to the redirect URLs.
6. Create your admin user (see SETUP.md).

## Production checklist

- [ ] `NEXT_PUBLIC_DEMO_MODE=false`
- [ ] Supabase **Pro** with daily backups and point-in-time recovery switched on (Database → Backups). Before running migrations, `supabase db dump` to keep an off-site copy.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set **only** as a server variable (never `NEXT_PUBLIC_`)
- [ ] Rate limiting: the built-in limiter works per serverless instance. For strict global limits, put it on a shared store such as Upstash Redis (`src/lib/api.ts`, `rateLimit`), and consider Vercel WAF rules
- [ ] Error logging: add Sentry (or Vercel Log Drains). API errors are logged server-side with `console.error` and returned to the client as generic `internal_error`
- [ ] API monitoring: `api_logs` holds every provider request (status, duration, cost, error). Use a Supabase dashboard query or alert on `status_code >= 400` rates
- [ ] Check that your data licences allow your intended use

## Data retention

`odds_snapshots` grows fastest. Unchanged prices are skipped, but plan to partition by month, or move snapshots older than N months to cold storage, keeping the `is_closing` rows.

## Rollback

Vercel: promote the previous deployment. Database: migrations are forward-only; restore from a backup or PITR if a migration must be undone.
