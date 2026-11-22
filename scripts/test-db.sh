#!/usr/bin/env bash
# Recria um banco local, aplica stub de auth + migrations e roda testes de RLS.
set -euo pipefail
DB=f24h_test
PSQL="sudo -u postgres psql -q -t -A -o /dev/null -v ON_ERROR_STOP=1"
$PSQL -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d $DB -f supabase/tests/00_local_auth_stub.sql
for f in supabase/migrations/*.sql; do $PSQL -d $DB -f "$f"; done
$PSQL -d $DB -f supabase/tests/01_rls_isolation.sql
$PSQL -d $DB -f supabase/tests/02_billing.sql
