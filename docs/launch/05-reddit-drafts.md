# Reddit drafts

Three different communities, three different framings. Mods will pull cross-posted identical text — these are intentionally distinct.

**Read each sub's rules first.** All three of these subs have anti-self-promotion rules. The framing below leads with substantive value (specific edges, methodology, free dataset) and treats the product mention as secondary. That's the only way these posts survive.

**Posting cadence:** Don't post all three the same day. Stagger across 3-4 days, and engage in each thread's comments — Reddit's algorithm and human mods both weight follow-up engagement.

---

## r/sportsbook — "Has anyone been line-shopping Kalshi against the books?"

**Title:** Sharing a free tool I built: live Kalshi event-contract pricing vs no-vig book consensus across all major US sports

**Body:**

For the last 6 months I've been manually checking Kalshi against my book whenever I take a position, because Kalshi prices a side cheaper than the consensus often enough that line-shopping it pays off. The problem was always the manual work — switching tabs, doing the no-vig math, accounting for Kalshi's trading fee.

I finally got tired enough to build the tool. It's live at sportsbookish.com.

What it does:
- Pulls Kalshi prices every 5 minutes across NFL, NBA, MLB, NHL, EPL, MLS, UCL, World Cup, and PGA Tour
- Computes the no-vig median across DraftKings, FanDuel, BetMGM, Caesars, BetRivers, ESPN BET, Pinnacle, bet365, BetOnline, Bovada, Fanatics
- Pre-computes the edge between Kalshi implied prob and the book consensus, net of Kalshi's max-7¢ fee
- Shows the best book per side (longest American price) when you do want to bet at a book instead

The free tier covers headline lines across every sport. Pro is $10/mo for full market depth (futures, props, matchups). I'm not here to push you to upgrade — the free tier is genuinely useful and the API has a free demo key documented at /api/docs if you want to build your own.

Real example from this week: Scottie Scheffler showed +4.3% on Kalshi vs the DraftKings/FanDuel no-vig consensus going into the PGA Championship. That's the kind of edge that's been sitting on the table because nobody was looking.

Questions I'd love feedback on:
1. Anyone else been trading Kalshi alongside their book? What's your workflow?
2. The fee math is what's been tripping me up most. I show it gross at Pro, net at Elite — should free tier see net by default? Curious what you'd want.
3. What books am I missing? I track 11 right now but if there's a regional book that consistently posts off-consensus lines, I'd add it.

Daily CSV snapshot is published CC-BY-4.0 on Hugging Face for anyone doing model work.

(Mods, if this hits the self-promo line let me know and I'll edit. Not running ads here, no affiliate tracking — just trying to surface a tool sharps will actually use.)

---

## r/kalshi — More technical framing, lean into the exchange-specific audience

**Title:** Built a free dashboard comparing Kalshi event-contract pricing against the 11+ US sportsbooks in real time (5-min refresh)

**Body:**

r/kalshi crowd will appreciate this — most existing odds-comparison tools either don't include Kalshi at all or include it as a footnote. So I built the inverse: Kalshi-first, books as the comparison set.

Live at sportsbookish.com. Free tier covers every sport.

What's in the methodology that might be relevant here:
- **Implied prob from Kalshi:** bid/ask midpoint only when both sides have real liquidity (yes_bid > 0, spread ≤ 10¢, ask < 1.00), otherwise the last trade price. Dust quotes get filtered out so the league pages don't show 1%/99% phantom edges on settled markets.
- **Edge calculation is net of fee:** max(1¢, ceil(0.07 × p × (1-p) × 100)) capped at 7¢ per contract. The fee compresses small edges meaningfully and most comparison tools either ignore it or do it wrong.
- **Sub-minute updates on Elite** via the Kalshi WebSocket — for in-play game lines and during major event close.
- **OWGR rankings + DataGolf model overlay** for PGA Tour — useful because Kalshi golf outright markets have very different shape from the books (Kalshi tends to overweight name recognition early in tournaments).

Free CSV snapshot is published daily to Hugging Face under kennyhyder/sportsbookish-daily-odds (CC-BY-4.0) if anyone wants to do their own analysis.

Couple of questions for the sub:
1. Anyone find that specific Kalshi market types systematically misprice vs the books? My intuition is win-totals on baseball get sharp faster than NFL conference futures, but I haven't backtested it rigorously.
2. Is there a Kalshi market segment you'd want to see prioritized? Currently I track game lines + championship/division/MVP futures + game-level player props. Could add more.

Not affiliated with Kalshi — just heavy user. Wikidata Q139814938 if you want the canonical entity reference.

---

## r/algotrading — Frame as a data source for algo strategies

**Title:** Free public API for Kalshi sports event-contract pricing + US sportsbook consensus (OpenAPI 3.1, CC-BY-4.0 daily snapshots)

**Body:**

For folks here building strategies that touch Kalshi or sports event contracts: I shipped a public API + free dataset that might save you a few weekends of scraper-building.

API: https://sportsbookish.com/api/docs (OpenAPI 3.1 spec, free demo key, no signup)
Daily CSV: https://huggingface.co/datasets/kennyhyder/sportsbookish-daily-odds (CC-BY-4.0)
GitHub examples: https://github.com/kennyhyder/sportsbookish-docs

What's in it that's relevant for algo work:

**Coverage:** Every Kalshi sports market (game lines + futures + game-level props) across NFL, NBA, MLB, NHL, EPL, MLS, UCL, World Cup, PGA Tour. Plus 11+ US sportsbook lines on the same markets for spread analysis.

**Latency:** 5-min refresh on the public API. Elite tier (paid) gets WebSocket subscription with sub-minute updates — if you're running anything intraday it's the only path that doesn't break Kalshi's public-REST rate limits.

**Pre-computed features in each response:**
- Implied prob from Kalshi (bid/ask midpoint with liquidity filtering)
- No-vig median across books
- Best-book identifier per side (longest American)
- Edge net of Kalshi fee
- DataGolf model overlay for golf
- Polymarket cross-market comparison where applicable

**Pricing:** Free demo key for evaluation (1k req/mo shared). Personal commercial-use key is $50/mo for 20k req/mo. Cheaper than the-odds-api.com on a per-request basis and only API I know of that includes Kalshi.

For backtesting: I publish a CC-BY-4.0 daily snapshot CSV to Hugging Face. Schema is flat tabular — pandas-loadable in 3 lines. Schema docs in the dataset card. No historical backfill in the public dataset by design (I update in-place daily) — DM me if you have a research use case that needs it.

Disclaimer: I'm the founder. This is my product. Not pretending otherwise. But this sub gets enough "where do I get clean odds data" posts that I figured the answer was worth sharing.

If you've built algo strategies that touch event contracts, would love to compare notes — particularly if you're doing anything with the no-vig book median as a fair-price anchor.
