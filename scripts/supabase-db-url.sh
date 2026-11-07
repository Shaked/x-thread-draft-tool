#!/usr/bin/env bash
# Prints a Supabase Session-pooler (IPv4) Postgres URL for use in GitHub Actions.
#
# Uses SUPABASE_DB_URL if set. Otherwise builds it from existing repo secrets:
#   SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID, SUPABASE_DB_PASSWORD
# by asking the Supabase Management API for the project's pooler host.
set -euo pipefail

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  printf '%s' "$SUPABASE_DB_URL"
  exit 0
fi

for v in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID SUPABASE_DB_PASSWORD; do
  if [ -z "${!v:-}" ]; then echo "Missing $v (or set SUPABASE_DB_URL)" >&2; exit 1; fi
done

config=$(curl -fsS -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/config/database/pooler")

python3 - "$config" <<'PY'
import json, os, sys, urllib.parse
cfg = json.loads(sys.argv[1])
if isinstance(cfg, dict):
    cfg = [cfg]
primary = [c for c in cfg if c.get("database_type", "PRIMARY") == "PRIMARY"] or cfg
c = primary[0]
host = c.get("db_host")
user = c.get("db_user") or f"postgres.{os.environ['SUPABASE_PROJECT_ID']}"
name = c.get("db_name") or "postgres"
if not host:
    sys.exit("Could not find db_host in pooler config")
pw = urllib.parse.quote(os.environ["SUPABASE_DB_PASSWORD"], safe="")
# Port 5432 on the pooler host = Session mode (supports pg_dump); 6543 is Transaction mode.
print(f"postgresql://{user}:{pw}@{host}:5432/{name}?sslmode=require", end="")
PY
