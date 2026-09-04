#!/usr/bin/env bash
#
# Container entrypoint. Waits for Postgres, then hands over to whatever the
# image's CMD is.
#
# set -e           exit on any command failing
# set -u           exit on an undefined variable, instead of using an empty one
# set -o pipefail  a failure anywhere in a pipeline fails the whole pipeline
#
# Without pipefail, "psql ... | tee log" reports success whenever tee succeeds,
# even if psql died. That is how a broken deploy reports itself as fine.
set -euo pipefail

MAX_WAIT_SECONDS="${DB_WAIT_TIMEOUT:-60}"

log() {
  printf '[entrypoint] %s\n' "$*"
}

fail() {
  printf '[entrypoint] ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  fail "DATABASE_URL is not set. Copy .env.example to .env and try again."
fi

# Pull host and port out of the connection string. It looks like:
#
#   postgresql+asyncpg://user:password@host:5432/dbname
#
# Strip the scheme, then any user:password@, then split on : and /.
without_scheme="${DATABASE_URL#*://}"
host_port="${without_scheme#*@}"
host_port="${host_port%%/*}"
db_host="${host_port%%:*}"
db_port="${host_port##*:}"
[[ "$db_port" == "$db_host" ]] && db_port=5432

log "Waiting for Postgres at ${db_host}:${db_port} (up to ${MAX_WAIT_SECONDS}s)"

waited=0
until pg_isready --host="$db_host" --port="$db_port" --quiet; do
  if (( waited >= MAX_WAIT_SECONDS )); then
    fail "Postgres did not become available within ${MAX_WAIT_SECONDS}s.
       Is the database container running?  docker compose ps
       Check its logs with:               docker compose logs postgres"
  fi
  sleep 1
  waited=$(( waited + 1 ))
done

log "Postgres is accepting connections after ${waited}s"

# Hand over to CMD. Note that this script does NOT run migrations -- those are
# a separate step, so that the ordering between schema changes and new code
# starting is always an explicit decision. See scripts/migrate.sh.
exec "$@"
