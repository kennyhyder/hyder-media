#!/usr/bin/env bash
# Ping IndexNow (Bing, Yandex, Naver, Seznam) about the launch URLs.
# Google doesn't use IndexNow but discovers via sitemap re-crawl.
# Run this AFTER the wire press release goes live (so the press URLs resolve).

set -e

# This key is already deployed at /public/620c7d50b41090ac7f0493e654f3219c.txt
KEY="620c7d50b41090ac7f0493e654f3219c"

curl -s -X POST "https://api.indexnow.org/IndexNow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "host": "sportsbookish.com",
    "key": "'$KEY'",
    "keyLocation": "https://sportsbookish.com/'$KEY'.txt",
    "urlList": [
      "https://sportsbookish.com/",
      "https://sportsbookish.com/pricing",
      "https://sportsbookish.com/api/docs",
      "https://sportsbookish.com/press",
      "https://sportsbookish.com/sports",
      "https://sportsbookish.com/sports/nba",
      "https://sportsbookish.com/sports/mlb",
      "https://sportsbookish.com/sports/nfl",
      "https://sportsbookish.com/sports/nhl",
      "https://sportsbookish.com/sports/epl",
      "https://sportsbookish.com/golf",
      "https://sportsbookish.com/learn/what-are-kalshi-odds",
      "https://sportsbookish.com/learn/no-vig-explained",
      "https://sportsbookish.com/learn/kalshi-edge-betting",
      "https://sportsbookish.com/compare/kalshi-vs-draftkings",
      "https://sportsbookish.com/compare/kalshi-vs-fanduel",
      "https://sportsbookish.com/compare/kalshi-vs-betmgm",
      "https://sportsbookish.com/llms.txt"
    ]
  }'

echo ""
echo "IndexNow submitted to Bing/Yandex/Naver. Status 200 = accepted."
echo ""
echo "Also do (manual, requires login):"
echo "  - Google Search Console: https://search.google.com/search-console -> URL Inspection -> Request Indexing"
echo "  - Bing Webmaster Tools: https://www.bing.com/webmasters"
