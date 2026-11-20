#!/usr/bin/env bash
# End-to-end UI tests against a running app + Supabase (local stack recommended).
#   npx supabase start && npm run dev   # in another terminal
#   bash tests/e2e/run.sh
# Uses the pre-installed Playwright (require('playwright')). Each run signs up a fresh user.
set -euo pipefail
cd "$(dirname "$0")"
export E2E_EMAIL="e2e-$(date +%s)@example.com"
node flow.js
node flow2.js
