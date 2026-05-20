# Press release draft — SportsBookISH

> Format follows AP wire conventions. Distribute via EIN Presswire, PRWeb, Get The Word Out, or paste into your own Substack / Medium. Aim for syndication on a Tuesday or Wednesday morning (highest pickup rate for tech/finance verticals).
>
> **Customize before sending:**
> - Final pickup date in the dateline
> - One real launch-week stat (sign-up count, API call volume, biggest edge tracked, etc.) where indicated
> - Quote from any beta user or industry contact (replace the founder quote if you can get one)

---

**FOR IMMEDIATE RELEASE**

**SportsBookISH Launches Public API for Comparing Kalshi Event-Contract Prices Against U.S. Sportsbook Consensus**

The first public dataset combining the CFTC-regulated exchange's live prices with DraftKings, FanDuel, BetMGM, and 8 other books in a single feed

---

**HONOLULU, May 19, 2026** — [SportsBookISH](https://sportsbookish.com), a sports-betting analytics platform built by digital marketing consultant Kenny Hyder, today announced public API access to its real-time comparison of Kalshi event-contract prices and U.S. sportsbook consensus lines across nine sports.

The platform is the first to publish a normalized feed combining live Kalshi prices, Polymarket prediction markets, DataGolf model probabilities, and de-vigged consensus from 11+ U.S. sportsbooks — refreshing every five minutes and surfacing pricing edges that previously required scraping multiple data sources to discover.

"Sharp bettors have been line-shopping books for decades. Now Kalshi is a regulated, federally-accessible exchange — and most of the people who would benefit from comparing it to their sportsbook aren't doing it because the data was scattered," said Kenny Hyder, founder of Hyder Media and creator of SportsBookISH. "We pulled all of it into one feed, computed the no-vig math, and put it behind a free tier so anyone can see where Kalshi is mispricing in real time."

## What's in the platform

SportsBookISH tracks Kalshi event contracts across NFL, NBA, MLB, NHL, English Premier League, MLS, UEFA Champions League, FIFA World Cup, and the PGA Tour. Each market is compared against:

- Median no-vig probability across DraftKings, FanDuel, BetMGM, Caesars, BetRivers, Fanatics, ESPN BET, Bovada, Pinnacle, bet365, and BetOnline
- Polymarket pricing on overlapping prediction markets
- DataGolf model probabilities for PGA Tour markets

All edges are pre-computed and net of Kalshi's trading fee (capped at 7¢ per contract), so users see actionable +EV numbers without doing the math themselves.

## Pricing tiers and free access

- **First Line (free)** — Game-line comparisons across all sports, daily edge digest email
- **Pro ($10/mo)** — Every market type, all 11+ books, configurable email alerts
- **Elite ($100/yr)** — Smart preset alerts, SMS delivery, watchlist push, sub-minute Kalshi updates
- **API tier ($50/mo or $500/yr)** — REST API with OpenAPI 3.1 spec for developers building betting tools, models, or analytics dashboards

A free shared demo API key is available without signup at <https://sportsbookish.com/api/docs>, allowing 1,000 requests per month across all users for evaluation.

## Open data on Hugging Face

In a move uncommon among sports-betting platforms, SportsBookISH publishes a daily CC-BY-4.0-licensed CSV snapshot to Hugging Face Hub at [kennyhyder/sportsbookish-daily-odds](https://huggingface.co/datasets/kennyhyder/sportsbookish-daily-odds). The dataset is loadable directly into the Hugging Face `datasets` library for AI training, research papers, and journalism. Hyder cited the lack of accessible Kalshi data in academic literature as motivation.

"Kalshi opening up sports contracts is one of the biggest structural changes in U.S. betting in a decade — and there's no clean academic dataset to study it yet," Hyder said. "If a researcher wants to publish on prediction-market efficiency, they shouldn't need to scrape Kalshi's API themselves for six months first."

## About Kalshi and the regulatory context

Kalshi is a CFTC-regulated Designated Contract Market that won a 2024 court ruling allowing it to list event contracts on U.S. sporting events. Because Kalshi operates under federal commodities law rather than state-by-state gaming licenses, its markets are accessible in all 50 U.S. states — including those where traditional sportsbooks are not legal. SportsBookISH does not operate the exchange or facilitate trading; it surfaces Kalshi's publicly-available prices alongside sportsbook lines for comparison.

## About Hyder Media

Hyder Media is a digital marketing consultancy founded by Kenny Hyder in 2009, based in Honolulu, Hawaii. Hyder has worked in performance marketing, PPC strategy, conversion optimization, and analytics across finance, e-commerce, B2B SaaS, fitness, automotive, and education verticals. SportsBookISH is Hyder Media's first consumer SaaS product, launched May 12, 2026 after building the golf-specific prototype at hyder.me/golfodds.

## Contact

**Kenny Hyder**
Founder, SportsBookISH
Email: kenny@hyder.me
Web: <https://sportsbookish.com>
X: [@sportsbookish](https://x.com/sportsbookish)
Press kit: <https://sportsbookish.com/press>

###

---

## Distribution checklist

When you're ready to send:

- [ ] **EIN Presswire** ($75–225 depending on distribution tier) — best for general syndication, gets you onto Yahoo Finance, MarketWatch wire, AP partner sites
- [ ] **PRWeb** by Cision ($99–389) — better for finance/tech specifically, slightly higher SEO weight
- [ ] **Get The Word Out** ($25–50) — nonprofit-budget option, less reach but real syndication
- [ ] **PR.com** (free) — lowest tier, mostly for backlink value, gets indexed by Google News
- [ ] **Submit to Hacker News** as Show HN (same week, free) — only after press release goes live so it has a citable URL
- [ ] **Submit to Product Hunt** (schedule for a Tuesday) — different audience, different copy variant (more product-focused, less PR-formal)
- [ ] **Reply to relevant Reddit threads** in r/sportsbook, r/algotrading, r/kalshi with a substantive answer that mentions the launch (not just a link)

## SEO follow-up

After the wire goes out, do these within 7 days:

- [ ] Submit the press release URL to Google Search Console "Request Indexing"
- [ ] Submit to Bing Webmaster Tools IndexNow
- [ ] Add the press release URL as a `sameAs` in your Wikidata entry (P973 = described at URL)
- [ ] Update the `<link rel="canonical">` chain so the press release points back at sportsbookish.com (cleaner for Google AI Overviews)

## Quote substitutions (if you get a beta user)

If a Pro/Elite subscriber agrees to be quoted, replace the second Hyder quote with something like:

> "I was line-shopping eight books on my phone and still missing edges Kalshi was pricing 4–5% off the consensus. SportsBookISH put all of it in one screen and my CLV jumped within a week." — Beta user, [tier], [first name + last initial]

User quotes lift pickup rate ~25% on tech-press wires.
