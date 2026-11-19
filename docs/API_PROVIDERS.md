# API providers: required subscriptions and credentials

The app works with **no keys** in demo mode. For live data you need **one odds provider and one tennis data provider**. Prices change often, so check each provider's pricing page before buying.

## What you need, by feature

| Feature | Needs |
| --- | --- |
| Lines board, odds comparison, value bets, line movement | **The Odds API** key |
| Live scores, schedules, results, match statistics, rankings, player profiles | **Sportradar Tennis v3** key (or **API-Tennis** as a cheaper alternative) |
| Odds history, closing odds, CLV from history, model training data | **Supabase** project + `SUPABASE_SERVICE_ROLE_KEY` + cron (`CRON_SECRET`) |
| Login, saved bets, server-side alerts, realtime notifications | **Supabase** (free tier is fine to start) |
| Email alerts | **Resend** key + verified sender (optional) |

## 1. The Odds API (odds), implemented

- **Sign up:** https://the-odds-api.com
- **Plan:** the free tier (500 credits/month) is enough to test. For continuous tennis coverage you need a **paid plan**. Cost per call is `markets × regions` credits for each active tennis tournament. With 3 markets × 2 regions × ~6 active tournaments every 10 minutes, that is roughly **260k credits/month**, so either raise the plan or lower the frequency, markets or regions.
- **Credential:** `THE_ODDS_API_KEY`, sent as the `apiKey` query parameter, server-side only.
- **Config:** `THE_ODDS_API_REGIONS` (default `eu,uk`) and `THE_ODDS_API_MARKETS` (default `h2h,spreads,totals`).
- **Provides:** match winner, game handicap and total games from 40+ bookmakers, with per-bookmaker `last_update`. No set-level, correct-score or player markets for tennis.
- **Rate/quota:** tracked from the `x-requests-used`, `x-requests-remaining` and `x-requests-last` headers and shown in API Management. The `/sports` call used by "Test connection" costs no credits.

## 2. Sportradar Tennis API v3 (tennis data), implemented

- **Sign up:** https://developer.sportradar.com, then create an application and request **Tennis v3**.
- **Plan:** a **30-day trial** is free, with request limits of about 1 per second and a monthly cap. Production use needs a **commercial licence**; pricing comes from Sportradar sales.
- **Credentials:** `SPORTRADAR_TENNIS_API_KEY` (sent in the `x-api-key` header) and `SPORTRADAR_TENNIS_ACCESS_LEVEL` = `trial` or `production`.
- **Endpoints used:** `/schedules/{date}/summaries.json`, `/schedules/live/summaries.json` and `/rankings.json`.
- **Provides:** schedules, live score and game state, match statistics (aces, double faults, serve %, break points, service games, points; winners and unforced errors only on some coverage levels), ATP/WTA rankings, competitor profiles and H2H.
- **Note:** field mapping follows the published v3 schema and is covered by fixture tests. It has **not yet been run against a live key**. Run "Test connection" on the API Management page after adding the key, and report any mapping gaps.

## 3. API-Tennis (tennis data, alternative), implemented

- **Sign up:** https://api-tennis.com. Paid plans include a 14-day trial.
- **Credential:** `API_TENNIS_KEY`, sent as the `APIkey` query parameter.
- **Used when:** no Sportradar key is set.
- **Provides:** fixtures and livescores (`get_fixtures`, `get_livescore`). Point-by-point and statistics depend on the plan; surface is not reported, so it shows as Unknown.
- **Note:** like Sportradar, it is fixture-tested but **not yet run against a live key**.

## 4. Sportradar Odds Comparison, planned (phase 2)

- Commercial licence from Sportradar. Credential: `SPORTRADAR_ODDS_API_KEY`.
- It is registered in the app and shows NOT IMPLEMENTED until the adapter mapping is built.

## 5. Supabase

- https://supabase.com. The free tier works for development; **Pro** is recommended in production for daily backups and point-in-time recovery.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public, protected by RLS), `SUPABASE_SERVICE_ROLE_KEY` (server-only, used by workers).

## 6. Resend (optional, email alerts)

- https://resend.com. Set `RESEND_API_KEY` and `ALERTS_FROM_EMAIL` (on a verified domain).

## Terms of use

The app uses only licensed APIs. It does **not** scrape bookmakers and does not get around any provider's terms. Check that your subscription allows your use: some data licences forbid redistribution, commercial use, or showing data to third parties.
