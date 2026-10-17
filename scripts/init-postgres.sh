#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_user="${TASKODE_DB_USER:-taskode}" --set=app_password="$TASKODE_DB_PASSWORD" --set=app_db="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password') \gexec
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', :'app_db', :'app_user') \gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user') \gexec
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
SQL
if [ "${TASKODE_CREATE_TEST_DB:-0}" = "1" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=app_user="${TASKODE_DB_USER:-taskode}" <<'SQL'
SELECT format('CREATE DATABASE taskode_test OWNER %I', :'app_user') \gexec
SQL
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname taskode_test \
    -c 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;'
fi
