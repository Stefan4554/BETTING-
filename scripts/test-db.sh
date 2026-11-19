#!/usr/bin/env bash
# Applies all migrations to a throwaway Postgres database and runs SQL tests.
# Requires a local PostgreSQL superuser connection (PG* env vars or local socket).
set -euo pipefail
DB="${TEST_DB:-edge_test}"
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/supabase_stubs.sql 2>/dev/null
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/rls_test.sql
