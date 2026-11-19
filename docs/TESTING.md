# Testing

## Run

```bash
npm run typecheck          # strict TypeScript, whole project
npm test                   # Vitest unit tests
bash scripts/test-db.sh    # migrations + RLS tests against a scratch Postgres (needs psql superuser)
NEXT_PUBLIC_DEMO_MODE=true npm run build
```

CI (`.github/workflows/ci.yml`) runs all four on every push and pull request. The database job uses a Postgres 16 service container.

## Unit tests (64)

| File | Covers |
| --- | --- |
| `tests/engine.test.ts` | Implied probability, fair odds, EV, edge, overround, movement %, CLV, American↔decimal; all four de-vig methods (sum to 1, keep the ordering, power/Shin shift margin to the longshot, 3-way Shin); full/fractional Kelly, cap, confidence shrinkage, input validation; market consensus (stale/incomplete books excluded, best price, null when empty); value engine (EV, fair odds, confidence, **null instead of a fabricated probability**, uncertainty warnings, threshold filtering); steam detection; reverse line movement returns null without data |
| `tests/model.test.ts` | Elo symmetry, K decay, zero-sum update, **chronological leakage guard**, null on insufficient history, interval contains the estimate; Brier, log loss, accuracy, calibration bins, chronological split; **walk-forward backtest** on a synthetic league with known strengths (Brier < 0.25, accuracy > 55%, ECE < 10%); bet P/L for every status (mirrors the SQL trigger), summary/yield/ROI/win rate excluding voids/CLV, grouping, bankroll curve, CSV escaping and formula-injection guard |
| `tests/providers.test.ts` | HTTP layer: key redaction, 5xx retry then success, cache hit, no retry on 401; The Odds API normalization (h2h/spreads/totals, quota headers, decimal format, **missing fields stay null**); Sportradar summaries (header auth, live status, surface, set scores, server, stats, missing stats stay null); API-Tennis fixtures; status and surface mapping |
| `tests/live-prob.test.ts` | Game win probability against the closed-form solution; symmetry; calibration reproduces the pre-match probability; leading raises the probability, finished states are 0/1; alert rules (threshold, cooldown, inactive, crossing-only for value alerts, match start/status); player analytics (form, splits, hold/break, tiebreaks, workload, null without service data, H2H); odds↔match linking (surname keys, swapped home/away flips selections); SUSPECT flag |

Provider fixtures follow each provider's documented response shape. They test the normalization code and are never shown in the app.

## Database tests

`supabase/tests/rls_test.sql` (run by `scripts/test-db.sh`) applies the migrations on plain Postgres, using `supabase_stubs.sql` to stand in for `auth.users`, `auth.uid()` and the roles. It then checks:

- a profile row is created automatically on sign-up
- the bet-profit trigger for won / lost / half-won / pending, and that `settled_at` is set
- RLS blocks inserting a bet for another user
- a user **cannot promote themselves** to admin
- user B sees none of user A's bets, no provider config, and only their own profile
- an admin can read provider config

## Manual / end-to-end checks performed for phase 1

- All 18 pages, the 404 page and the login page return 200 in demo mode and in live mode without keys; no browser console errors
- Live mode without keys: every section shows NOT CONNECTED or an empty-state explanation, with no demo data
- Tracker: add a bet, P/L and CLV calculated, validation rejects odds ≤ 1, persistence after reload
- No horizontal scroll at phone width (390 px)

## Not yet verified

- Requests against **real provider keys** (none were available). Use API management → Test connection once keys are added.
- Supabase Auth flows against a hosted project (sign-up, magic link, RLS through PostgREST). The RLS policies themselves are tested at the SQL level.
