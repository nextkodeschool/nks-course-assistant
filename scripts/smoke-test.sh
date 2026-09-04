#!/usr/bin/env bash
#
# End-to-end check against a running stack. Start it first:
#
#     docker compose up -d
#     ./scripts/smoke-test.sh
#
# The interesting part is the container restart in the middle. Everything
# before it proves login works; everything after it proves the session lived
# somewhere other than the container's memory.
#
set -euo pipefail

API="${API_URL:-http://localhost:8000}"
JAR="$(mktemp)"
EMAIL="smoke-$$@example.com"
PASSWORD="smoke-test-password"
trap 'rm -f "$JAR"' EXIT

pass=0
fail=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    printf '  PASS  %s\n' "$label"
    pass=$(( pass + 1 ))
  else
    printf '  FAIL  %s  (expected %s, got %s)\n' "$label" "$expected" "$actual"
    fail=$(( fail + 1 ))
  fi
}

status() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

printf '\nLiveness\n\n'
check "/healthz returns 200" 200 "$(status "$API/healthz")"

printf '\nRegister and sign in\n\n'
check "register returns 201" 201 "$(status -c "$JAR" -X POST "$API/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"

check "duplicate email returns 409" 409 "$(status -X POST "$API/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"

check "wrong password returns 401" 401 "$(status -X POST "$API/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}")"

check "login returns 200" 200 "$(status -c "$JAR" -X POST "$API/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"

check "/me with cookie returns 200" 200 "$(status -b "$JAR" "$API/api/auth/me")"
check "/me without cookie returns 401" 401 "$(status "$API/api/auth/me")"

printf '\nCookie flags\n\n'
cookie_line="$(grep -i nks_session "$JAR" || true)"
if [[ -n "$cookie_line" ]]; then
  # curl's cookie jar marks HttpOnly with a #HttpOnly_ prefix on the line.
  check "session cookie is HttpOnly" "yes" \
    "$(grep -qi '^#HttpOnly_' <<<"$cookie_line" && echo yes || echo no)"
else
  printf '  FAIL  session cookie was not set\n'
  fail=$(( fail + 1 ))
fi

printf '\nState outlives the container\n\n'
printf '  restarting the api container...\n'
docker compose restart api >/dev/null 2>&1

for _ in $(seq 1 30); do
  [[ "$(status "$API/healthz")" == "200" ]] && break
  sleep 1
done

check "api came back up" 200 "$(status "$API/healthz")"
check "still signed in after restart" 200 "$(status -b "$JAR" "$API/api/auth/me")"

printf '\nLogout revokes server-side\n\n'
check "logout returns 204" 204 "$(status -b "$JAR" -X POST "$API/api/auth/logout")"
# Deliberately reusing the OLD cookie jar. If logout only cleared the cookie
# and left the row, this would still return 200 -- which is the bug being
# checked for.
check "old session no longer works" 401 "$(status -b "$JAR" "$API/api/auth/me")"

printf '\n%s\n  %d passed, %d failed\n%s\n\n' \
  "============================================================" \
  "$pass" "$fail" \
  "============================================================"

exit $(( fail > 0 ? 1 : 0 ))
