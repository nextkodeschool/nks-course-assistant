#!/usr/bin/env bash
#
# Run database migrations. Standalone on purpose.
#
# This is its own command rather than something the API does at startup,
# because "does the schema change before or after the new code starts?" is a
# question every rolling deploy has to answer. Hidden inside app boot, the
# answer becomes "both at once, several times, in whatever order the
# containers happened to start" -- which works fine until the migration is
# one that the old code cannot tolerate.
#
# Being a separate command is also what lets it run as a Kubernetes Job or an
# ECS pre-deploy task later, where it belongs.
#
# Usage:
#   ./scripts/migrate.sh              upgrade to the latest revision
#   ./scripts/migrate.sh downgrade -1 roll back one revision
#   ./scripts/migrate.sh current      show the current revision
#   ./scripts/migrate.sh history      list all revisions
#
set -euo pipefail

cd "$(dirname "$0")/../apps/api"

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '[migrate] ERROR: DATABASE_URL is not set.\n' >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  printf '[migrate] Upgrading to head\n'
  exec alembic upgrade head
fi

printf '[migrate] alembic %s\n' "$*"
exec alembic "$@"
