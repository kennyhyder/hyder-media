#!/usr/bin/env bash
# Mandatory pre-deploy + post-deploy route smoke test for sportsbookish.com.
# Run before pushing any middleware / redirect / route change. Run again
# 60s after the deploy lands.
#
# Failures = stop the world.
#
# Usage: bash scripts/preflight-routes.sh [base_url]
#   default base_url: https://sportsbookish.com

set -euo pipefail
BASE="${1:-https://sportsbookish.com}"
echo "Preflight against ${BASE}"
echo "================================================"

# Static canary set — identical to api/seo/cron-route-canary.js STATIC_CANARIES
STATIC=(
  "/"
  "/sports" "/sports/nba" "/sports/mlb" "/sports/nfl" "/sports/nhl"
  "/sports/epl" "/sports/wc" "/sports/mls"
  "/sports/positive-ev" "/sports/arbitrage" "/sports/middles" "/sports/movers"
  "/sports/mlb/teams" "/sports/nba/players"
  "/golf" "/golf/players" "/golf/2026"
  "/sportsbooks" "/sportsbooks/draftkings" "/sportsbooks/kalshi-vs-fanduel" "/sportsbooks/draftkings-vs-fanduel"
  "/sportsbook-promos"
  "/odds/mlb/moneyline" "/odds/nba/spread" "/odds/nfl/total"
  "/research" "/research/why-mid-game-kalshi-lines-lag"
  "/research/how-sportsbooks-reprice-without-news"
  "/research/volume-concentration-event-contract-ladders"
  "/clv-leaderboard" "/embed" "/embed/biggest-edges"
  "/pricing" "/learn/glossary" "/tools" "/data"
)

fail=0
for url in "${STATIC[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-redirs 0 "${BASE}${url}" || echo "000")
  if [ "${code}" = "200" ]; then
    printf "  \033[32m✓\033[0m %s  %s\n" "${code}" "${url}"
  else
    loc=$(curl -sI "${BASE}${url}" | grep -i '^location:' | head -1 | tr -d '\r' | sed 's/^location: //i')
    printf "  \033[31m✗\033[0m %s  %s  → %s\n" "${code}" "${url}" "${loc:-?}"
    fail=$((fail+1))
  fi
done

echo ""
echo "--- live event/tournament URLs (sampled from DB) ---"

# Sample 3 live event URLs + 1 tournament URL via Supabase REST. Requires
# NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY in env.
if [ -f sportsbookish/.env.local ]; then
  SU=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' sportsbookish/.env.local | cut -d= -f2 | tr -d '"')
  SK=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' sportsbookish/.env.local | cut -d= -f2 | tr -d '"')
fi
if [ -z "${SU:-}" ] || [ -z "${SK:-}" ]; then
  echo "  (skipping — set NEXT_PUBLIC_SUPABASE_URL + anon key to enable live URL sampling)"
else
  events=$(curl -s "${SU}/rest/v1/sports_events?select=league,season_year,slug&status=eq.open&slug=not.is.null&season_year=not.is.null&limit=3" \
    -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}")
  echo "$events" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if not isinstance(data, list):
    sys.exit(0)
for e in data:
    if isinstance(e, dict) and e.get('slug') and e.get('season_year') and e.get('league'):
        print(f'/sports/{e[\"league\"]}/{e[\"season_year\"]}/{e[\"slug\"]}')
" | while read url; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-redirs 0 "${BASE}${url}")
    if [ "${code}" = "200" ]; then
      printf "  \033[32m✓\033[0m %s  %s\n" "${code}" "${url}"
    else
      printf "  \033[31m✗\033[0m %s  %s\n" "${code}" "${url}"
      fail=$((fail+1))
    fi
  done

  tour=$(curl -s "${SU}/rest/v1/golfodds_tournaments?select=season_year,slug&status=eq.upcoming&slug=not.is.null&limit=1" \
    -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}")
  url=$(echo "$tour" | python3 -c "
import sys, json
try:
    t = json.load(sys.stdin)
    if isinstance(t, list) and t and isinstance(t[0], dict) and t[0].get('slug'):
        print(f'/golf/{t[0][\"season_year\"]}/{t[0][\"slug\"]}')
except Exception:
    pass
")
  if [ -n "${url}" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-redirs 0 "${BASE}${url}")
    if [ "${code}" = "200" ]; then
      printf "  \033[32m✓\033[0m %s  %s\n" "${code}" "${url}"
    else
      printf "  \033[31m✗\033[0m %s  %s\n" "${code}" "${url}"
      fail=$((fail+1))
    fi
  fi
fi

echo ""
echo "================================================"
if [ "${fail}" -eq 0 ]; then
  printf "\033[32mPASS\033[0m  all canaries returning 200\n"
  exit 0
else
  printf "\033[31mFAIL\033[0m  %s canary URL(s) returned non-200 — investigate before deploying\n" "${fail}"
  exit 1
fi
