#!/usr/bin/env bash
# Database tests: applies every migration to a scratch database and runs the SQL test suites.
#
#   Plain PostgreSQL (CI):  PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash scripts/test-db.sh
#   Local Supabase stack:   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres bash scripts/test-db.sh
#     (with SUPABASE_DB_URL the tests run against the already-migrated local stack, inside a
#      transaction that is rolled back)
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/financial_test.sql
  exit 0
fi
DB="${TEST_DB:-bep_test}"
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/supabase_stubs.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/financial_test.sql
