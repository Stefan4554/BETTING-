# Deployment (Supabase + Vercel)

## 1. Supabase

1. Create a project. Note the project URL, anon key and service-role key (Settings → API).
2. Apply migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. Auth → URL configuration: set the site URL to your Vercel domain and add
   `https://<domain>/auth/callback` to redirect URLs. Enable email confirmations as required.
4. Optional: Auth → rate limits and SMTP for production email.

## 2. Vercel

1. Import the GitHub repository (framework: Next.js).
2. Environment variables (Production + Preview):

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public |
| `SUPABASE_SERVICE_ROLE_KEY` | server only — never prefix with `NEXT_PUBLIC_` |
| `API_KEY_ENCRYPTION_KEY` | `openssl rand -hex 32`; keep it stable (rotating invalidates stored provider keys) |
| `CRON_SECRET` | random; Vercel Cron sends it as a bearer token |
| `THE_ODDS_API_KEY`, `PLATFORM_ODDS_SPORTS`, `PLATFORM_ODDS_REGIONS` | optional shared feed |
| `RESEND_API_KEY`, `ALERTS_FROM_EMAIL` | optional email alerts |

3. `vercel.json` schedules:
   * `/api/cron/ingest` every 10 minutes (each connection is polled only when its own refresh
     interval — at least the provider minimum — has elapsed),
   * `/api/cron/fx` weekdays 16:30 UTC (ECB publishes around 16:00 CET),
   * `/api/cron/maintenance` nightly (closing-price marking, CLV capture, history pruning).

   Cron frequency depends on your Vercel plan; on plans with daily-only cron use an external
   scheduler calling the same routes with the bearer token.

## Production checklist

- [ ] Migrations applied; `npm run test:db` green in CI.
- [ ] Service-role key and encryption key set only as server env vars.
- [ ] Auth redirect URLs restricted to your domains.
- [ ] Point-in-time recovery / daily backups enabled in Supabase.
- [ ] Provider plans sized for your polling (see API_PROVIDERS.md) and refresh intervals set.
- [ ] Users can download a full JSON backup (Settings → Account) — test it.
