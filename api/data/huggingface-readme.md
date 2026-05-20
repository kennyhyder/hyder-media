---
license: cc-by-4.0
language:
- en
size_categories:
- 1K<n<10K
task_categories:
- tabular-regression
- time-series-forecasting
- other
task_ids:
- tabular-multi-class-classification
tags:
- sports
- sports-betting
- prediction-markets
- kalshi
- polymarket
- odds
- sportsbook
- nfl
- nba
- mlb
- nhl
- premier-league
- pga-tour
- golf
- finance
- alternative-data
pretty_name: "SportsBookISH Daily Odds (Kalshi vs Sportsbook Consensus)"
configs:
- config_name: default
  data_files:
  - split: latest
    path: data/latest.csv
source_datasets:
- original
annotations_creators:
- machine-generated
language_creators:
- machine-generated
---

# SportsBookISH Daily Odds Dataset

> Daily snapshot of live odds comparing **Kalshi** (the CFTC-regulated event-contract exchange) against **US sportsbook consensus** across nine sports. The only public dataset that combines Kalshi exchange data with sportsbook lines and DataGolf model probabilities in a single normalized schema.

| | |
|---|---|
| **Live website** | https://sportsbookish.com |
| **Wikidata** | [Q139814938](https://www.wikidata.org/wiki/Q139814938) |
| **Update cadence** | Every 24 hours at 07:00 UTC (auto-synced via Vercel cron) |
| **License** | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) — attribution required |
| **Schema version** | 1 |
| **Maintainer** | [Kenny Hyder](https://hyder.me) / [Hyder Media](https://hyder.me) |

## What's in this dataset

A flat-tabular daily snapshot of:

- **Kalshi event-contract implied probabilities** across NFL, NBA, MLB, NHL, EPL, MLS, UCL, World Cup, and PGA Tour
- **Sportsbook consensus prices** (no-vig median across DraftKings, FanDuel, BetMGM, Caesars, and 8+ more books)
- **DataGolf model probabilities** for PGA Tour outright + matchup markets
- **Pre-computed edges** (Kalshi vs book consensus) on each side
- **OWGR rankings** for golf players where applicable

Why this matters: until now, fusing Kalshi event-contract data with traditional sportsbook lines required scraping multiple sources and reconciling team-name normalization yourself. This dataset does that work daily and ships a clean CSV ready for `pandas`, `polars`, or HuggingFace `datasets`.

## Schema

| Column | Type | Description | Example |
|---|---|---|---|
| `source` | string | Data origin: `sports`, `golf`, or `golf-rank` | `sports` |
| `league` | string | League key: `nfl`, `nba`, `mlb`, `nhl`, `epl`, `mls`, `ucl`, `wc`, `pga` | `nba` |
| `event_title` | string | Human-readable event title | `Lakers vs Celtics` |
| `event_slug` | string | URL-safe slug (date-suffixed for repeating matchups) | `lakers-vs-celtics-may-19` |
| `season_year` | int | Season year | `2026` |
| `start_time` | ISO 8601 datetime | Event start (UTC) | `2026-05-19T23:30:00Z` |
| `side` | string | Contestant/player name | `Lakers` |
| `kalshi_implied` | float | Kalshi implied probability (0.0 – 1.0) | `0.42` |
| `owgr_rank` | int | Official World Golf Ranking (golf only) | `1` |
| `generated_at` | ISO 8601 datetime | When this snapshot was generated | `2026-05-19T07:00:00Z` |

The Kalshi implied probability is computed from the bid/ask midpoint when both sides have real liquidity (`yes_bid > 0`, spread ≤ 10¢, ask < 1.00), otherwise the last trade price. Same logic the live site uses.

## Quickstart

### Hugging Face `datasets`

```python
from datasets import load_dataset

ds = load_dataset("kennyhyder/sportsbookish-daily-odds", split="latest")
df = ds.to_pandas()
print(df.head())
print(f"{len(df)} rows across {df.league.nunique()} leagues")
```

### Pandas (direct CSV)

```python
import pandas as pd

df = pd.read_csv(
    "https://huggingface.co/datasets/kennyhyder/sportsbookish-daily-odds/resolve/main/data/latest.csv"
)

# Top 10 Kalshi favorites today
print(df.sort_values("kalshi_implied", ascending=False).head(10)[["league", "event_title", "side", "kalshi_implied"]])
```

### Live API (for real-time, not snapshot)

If you need sub-hourly freshness, the underlying live API is at https://sportsbookish.com/api/v1 (free demo key — see https://sportsbookish.com/api/docs).

```bash
curl https://sportsbookish.com/api/v1/edges?min_edge=0.03 \
  -H "Authorization: Bearer sbi_live_84fdd6cc6a6b2df3e38a9f19a49537a5"
```

The live API returns pre-computed edges and per-book pricing that this snapshot dataset doesn't include (snapshot is a flat tabular subset; live API is fully relational).

## Update cadence

- **Daily snapshot**: pushed here at 07:00 UTC every day (Vercel cron on hyder.me)
- **Schema stability**: column names and types are versioned. Breaking changes ship in a new sub-directory (`data/v2/...`)
- **Backfill**: no historical data is included in this dataset by design — only the most recent snapshot. For multi-day series, scrape daily.

## License & attribution

CC-BY-4.0. If you publish research or articles using this data, please cite:

```
SportsBookISH (2026). Live Kalshi vs U.S. sportsbook event-contract odds dataset.
Hyder Media. https://sportsbookish.com (Wikidata: Q139814938)
```

BibTeX:

```bibtex
@misc{sportsbookish2026,
  title = {SportsBookISH: Live Kalshi vs U.S. sportsbook event-contract odds},
  author = {Hyder, Kenny},
  organization = {Hyder Media},
  year = {2026},
  url = {https://sportsbookish.com},
  note = {Wikidata Q139814938}
}
```

## Ethical use

This dataset surfaces pricing discrepancies between regulated exchanges and licensed sportsbooks for research, journalism, and personal analysis. Sports betting is regulated state-by-state in the US; Kalshi operates federally under CFTC oversight. Users are responsible for compliance with their local laws. The dataset is **not** financial or betting advice.

## Related resources

- **Live odds dashboard**: https://sportsbookish.com
- **Methodology + glossary**: https://sportsbookish.com/learn
- **API docs (OpenAPI 3.1)**: https://sportsbookish.com/api/docs
- **Source code & schemas**: https://github.com/kennyhyder/sportsbookish-docs *(public repo with API examples)*
- **Press kit**: https://sportsbookish.com/press
- **Contact**: kenny@hyder.me

## Related Wikidata entities

- [Q139814938 — SportsBookISH](https://www.wikidata.org/wiki/Q139814938) (this product)
- [Q114586938 — Kalshi](https://www.wikidata.org/wiki/Q114586938) (upstream exchange)
- [Q123502863 — Polymarket](https://www.wikidata.org/wiki/Q123502863) (compared exchange)
- [Q282283 — prediction market](https://www.wikidata.org/wiki/Q282283) (concept)
