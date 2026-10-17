#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$BROTE_DB_PASSWORD" --set=app_db="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE brote LOGIN PASSWORD %L', :'app_password') \gexec
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO brote', :'app_db') \gexec
GRANT USAGE, CREATE ON SCHEMA public TO brote;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
SQL
if [ "${BROTE_CREATE_TEST_DB:-0}" = "1" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c 'CREATE DATABASE brote_test OWNER brote;'
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname brote_test \
    -c 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;'
fi
