# SportsBookISH — Programmatic SEO + AEO Strategy

> Goal: dominate long-tail search for "{event/team/player/book} odds" queries AND become a citable source for AI answer engines (Google AIO, Perplexity, ChatGPT search, Claude, Gemini, Copilot).

## TL;DR — what we're optimizing for

| Layer | What we want | Why it matters |
|---|---|---|
| **Classic SEO** | Rank for "kalshi odds", "best odds {team} {date}", "{tournament} odds", "{player} odds to win" | Direct traffic from Google web search |
| **Programmatic SEO (pSEO)** | Auto-generate 50K–500K unique pages from our data, each genuinely useful (not thin) | Capture the long tail without hand-writing each page |
| **AEO (Answer Engine Optimization)** | Be the source AI tools quote / link when users ask "what are the odds for X?" | AI-search referrals + brand authority. Different ranking signals than Google web. |
| **GEO (Generative Engine Optimization)** | Get scraped into LLM training corpora (Reddit, X, Wikipedia, GitHub) so future models "know" us | Long-term moat — once the model trains on us, we're the default answer |

## Part 1 — Programmatic SEO foundations

### 1.1 Long-tail keyword surface analysis

We have 4 axes that combine into millions of long-tail queries:

```
{Entity}              ×  {Modifier}        ×  {Time}        ×  {Comparison}
─────────             ─────────             ──────          ─────────
Team (e.g. Lakers)    odds                  today           vs DraftKings
Player (Scheffler)    best odds             tonight         vs FanDuel
Event (PGA Champ)     to win                this week       Kalshi vs sportsbooks
Tournament            money line            Friday          books median
Game                  spread                Game 3          live odds
Award (MVP)           total                 2026            updated
Division              prop                  finals          historical
Conference            futures               playoffs        movement
```

Multiply these → ~10K teams/players × 10 modifiers × dynamic dates × 6 books = millions of valid permutations. We don't write each page; we **generate** them from one template + our existing odds data.

### 1.2 URL structure — keyword-rich, hierarchical, permanent

**Current (bad for SEO):**
- `/golf/tournament?id=a3b9c-1234-...` (UUID query param)
- `/sports/nba/event/9f8e-7d6c-...` (UUID path segment)

**Target (good for SEO):**
- `/golf/2026/pga-championship` — tournament hub
- `/golf/2026/pga-championship/scottie-scheffler` — player page
- `/sports/nba/2026-finals/game-3-lakers-vs-celtics` — single game
- `/sports/nba/teams/los-angeles-lakers` — team hub
- `/sports/nba/players/luka-doncic` — player career hub
- `/sports/nba/futures/mvp` — futures market hub
- `/sports/nba/futures/mvp/2026` — season-specific MVP hub
- `/sports/mlb/divisions/al-east` — division winner page
- `/odds/kalshi/super-bowl-2026` — flagship SEO money URL

**Implementation plan:**
1. Add `slug` column to `sports_events` (`{year}-{kebab-case-title}`, generated at ingest)
2. Add `slug` column to `golfodds_tournaments` (already partly present)
3. Add `slug` column to `sports_contestants` (player/team slugs)
4. Create `app/sports/[league]/[year]/[event_slug]/page.tsx` route
5. Create `app/sports/[league]/teams/[team_slug]/page.tsx` route
6. Create `app/sports/[league]/players/[player_slug]/page.tsx` route
7. Create `app/sports/[league]/futures/[market_slug]/[year]/page.tsx`
8. **Keep UUID routes alive forever with 301 redirects** — preserves any links accidentally shared

### 1.3 Historical archive — ranking on past events

Once an event closes, current behavior is to drop it from the dashboard. **For SEO this is wasted gold.** Past tournaments + games have evergreen search demand:

- "PGA Championship 2024 final odds" — still searched in 2026
- "Lakers vs Celtics 2024 Finals odds" — searched for years
- "2024 Super Bowl Kalshi odds" — newsworthy historical record

**What to ship:**
- New `archive` boolean column on `sports_events` and `golfodds_tournaments` (set true when status transitions to closed)
- Archive pages render the **final** book/Kalshi/DG odds at close, settlement result, payout per $100, biggest movers, and a "How accurate was Kalshi vs the books?" summary
- Add `/golf/archive/2024` and `/sports/nba/archive/2024` index pages
- Keep markets read-only on archive pages (no force-refresh, no alerts)
- Schema.org `SportsEvent` with `eventStatus: EventCompleted` + final result

### 1.4 Page templates — uniqueness without writing each page

Every pSEO page must answer: "What does THIS page have that the same template doesn't?" If two URLs share 95% of content, Google may de-duplicate.

**Each generated page must include:**
- Unique title + meta description (template w/ entity variables)
- Unique H1 mentioning the specific entity + date
- Live data (odds, edges, movements) the template can't have
- At least 1 unique paragraph of generated copy ("Scottie Scheffler is currently priced at +600 to win the 2026 PGA Championship, the shortest price on Kalshi by 200 ticks…")
- Date-aware freshness signal ("Last updated 12 minutes ago — live odds")
- Internal links to: parent league, peer events, related futures, top movers
- Outbound book links (rel="sponsored") — adds authority

**Anti-thin-content defenses:**
- Pages with no data hidden via `noindex` (don't pollute the index with empty templates)
- Min 200 words of generated context per page
- Show DIFFERENT sort orders / pivots on adjacent template pages (player view vs team view)

## Part 2 — AEO (Answer Engine Optimization)

AI answer engines (Perplexity, Google AIO, ChatGPT search, Claude) rank/select content differently than Google web:

| Google web ranks ON | AI answer engines rank ON |
|---|---|
| Backlinks, EEAT, freshness | **Structured data**, citability, **specific factual claims**, freshness, **scannability** |
| User-friendly layout | **Machine-friendly** layout (clean H2s, tables, lists, schema) |
| Brand authority | **Domain consensus** (mentioned across multiple trusted sources) |

### 2.1 Structured data (Schema.org) — biggest AEO lever

Currently we emit `Breadcrumb` and `ItemList`. We need much more.

**Per-page schema additions:**

| Page type | Schema types to emit |
|---|---|
| Game event | `SportsEvent` (with `competitor`, `startDate`, `location`, `offers`) + `FAQPage` |
| Player page | `Person` (athlete) + `SportsTeam` affiliation + `ItemList` of markets |
| Team page | `SportsTeam` + `ItemList` of upcoming events |
| Futures market | `SportsEvent` (eventStatus pending) + `OfferCatalog` (prices per book) |
| Archive page | `SportsEvent` (eventStatus completed) + result + final odds in markup |
| Comparison page | `WebPage` + `FAQPage` + `Table` with structured rows |
| Learn article | `Article` + `FAQPage` + `Author` (E-E-A-T) |

**Implementation note:** the existing `JsonLd` helper in `lib/seo.ts` is the place to extend. Each page type gets its own helper (`sportsEventLd`, `playerLd`, `oddsTableLd`).

### 2.2 FAQ blocks — the #1 AEO pattern

Every page should end with 4-6 question/answer pairs **as both visible HTML AND `FAQPage` schema**. This is what gets pulled into Google's "People Also Ask" + AI answer summaries.

Example for `/sports/nba/event/lakers-vs-celtics-game-3`:

> **Q: What are the current odds for Lakers vs Celtics Game 3?**
> A: As of {timestamp}, Kalshi has Lakers at {prob}% implied probability ({american}). The books median is {book_median}% — meaning Kalshi is currently {edge}.
>
> **Q: Where can I get the best odds on Lakers vs Celtics Game 3?**
> A: DraftKings has the longest Lakers price at {price}; FanDuel has the longest Celtics price at {price}. See the full table above.
>
> **Q: When is Lakers vs Celtics Game 3?**
> A: {start_time} at {venue}.
>
> **Q: Did the Kalshi line move today?**
> A: Yes — Lakers moved from {old}% to {new}% in the last 24h (a {delta}% shift).

These are **generated** from the same data driving the page. AI engines love them.

### 2.3 Author bylines + E-E-A-T

AI engines weight content by perceived expertise. Add:
- `<meta name="author" content="Kenny Hyder">` on every page
- Author bio page at `/about/kenny-hyder` with credentials (digital marketing 15+ years, etc.)
- Schema `Article.author` linking to that page
- "Last reviewed on {date}" timestamp visible
- "Methodology" page explaining HOW we compute edge, no-vig, fee adjustments — citable reference

### 2.4 Citable specific claims

AI engines quote specific, verifiable factual statements. Generate them automatically:

- "The PGA Championship 2026 has 156 players with Kalshi markets, compared to 92 listed on DraftKings."
- "Scottie Scheffler's Kalshi implied probability of 14.3% is 2.1 points lower than the DataGolf model's 16.4% baseline."
- "Across 247 outright markets in 2025, Kalshi was on average 1.8% cheaper than the books median (after the 7% Kalshi fee)."

**Build a "stats facts" generator** that produces 3-5 of these per page based on real data. They become the snippets AI quotes.

### 2.5 Freshness signals

AI engines + Google heavily favor very-fresh content for sports queries.

- Render `<time datetime="{iso}">{relative}</time>` on every page
- Include "Updated N minutes ago" prominently above the fold
- ISR / dynamic = "force-dynamic" for live event pages (already in place)
- News sitemap (`/news-sitemap.xml`) for breaking-event pages (major game, big line move, etc.) — pings Google within minutes

### 2.6 Robots.txt — allow AI crawlers explicitly

Some AEO content gets blocked by aggressive defaults. Explicitly allow:

```
User-agent: GPTBot              # OpenAI
Allow: /

User-agent: ClaudeBot           # Anthropic
Allow: /

User-agent: PerplexityBot       # Perplexity
Allow: /

User-agent: Google-Extended     # Google AIO training
Allow: /

User-agent: Applebot-Extended   # Apple Intelligence
Allow: /

User-agent: Bytespider          # ByteDance / Doubao
Allow: /

User-agent: CCBot               # Common Crawl (feeds many LLMs)
Allow: /

User-agent: facebookexternalhit
Allow: /
```

**Trade-off**: allowing GPTBot means we're contributing free training data. The bet is that becoming the canonical source is worth more than the (questionable) ability to gatekeep.

### 2.7 llms.txt — explicit invitation to AI crawlers

Emerging standard (proposed by Jeremy Howard). File at `/llms.txt` describes the site to LLMs in markdown. Looks like:

```
# SportsBookISH

> Live odds comparison between Kalshi event-contract exchange and US sportsbooks. Specializes in finding pricing edges, no-vig book median calculations, and Kalshi fee-adjusted edge math.

## Pricing
- [Pricing tiers](https://sportsbookish.com/pricing)

## Odds dashboards
- [All sports hub](https://sportsbookish.com/sports)
- [Golf live odds](https://sportsbookish.com/golf)
- [NFL odds](https://sportsbookish.com/sports/nfl)
- [NBA odds](https://sportsbookish.com/sports/nba)
…

## How we compute edge
- [Methodology](https://sportsbookish.com/about/methodology)
- [Kalshi fee math](https://sportsbookish.com/learn/kalshi-fees)
```

### 2.8 Wikipedia-grade entity pages

For each notable team/player/tournament, the page should function like a Wikipedia stub:
- Standard infobox at the top (founded, location, championships, current odds)
- Sections: Current season odds | Historical odds vs results | Notable moves | FAQ
- Last 365 days of price history graph
- Result resolution (did past markets resolve where the consensus expected?)
- This is the format AI engines have been trained to extract from

## Part 3 — Concrete pSEO page targets (in priority order)

### Tier 1 — ship first (highest ROI)
1. **Player pages** — `/sports/{league}/players/{slug}` — 5K-10K pages
2. **Team pages** — `/sports/{league}/teams/{slug}` — ~150 pages × current odds
3. **Tournament archive** — `/golf/{year}/{tournament-slug}` — replace `?id=`
4. **Game permalink** — `/sports/{league}/{year}/{game-slug}` — replace UUID
5. **FAQ schema everywhere** — one PR, hits every existing page

### Tier 2 — once Tier 1 stabilizes
6. **Futures market hubs** — `/sports/{league}/futures/{market-slug}` (NBA MVP, AL Cy Young, etc.)
7. **Divisional / conference hubs** — `/sports/nfl/divisions/afc-east`
8. **Book pages** — `/books/draftkings` (existing comparison expanded to per-book deep dive: pricing biases, market coverage, where they're sharp vs soft)
9. **"Odds today" date pages** — `/odds/2026-05-15` (a daily index of every live market that day) — Google loves these for "{date} odds"
10. **"Best odds for X" pages** — `/best-odds/{event-slug}` — explicit "best book per side" — high commercial intent

### Tier 3 — content depth
11. **Glossary** — `/learn/glossary/{term}` (no-vig, hold, parlay, vig, fade, sharp, square, etc.) — 50-100 entries
12. **Strategy guides** — `/learn/strategy/{topic-slug}` (e.g. "how to find +EV bets on Kalshi", "kelly criterion explained")
13. **Book comparison cluster** — `/compare/{bookA}-vs-{bookB}` — already started; expand to all 15 pairs
14. **Calculator pages** — `/tools/no-vig-calculator`, `/tools/american-to-decimal`, `/tools/kelly-calculator` — high-intent + linkable
15. **State-specific pages** — `/legal/kalshi-in-{state}` (50 pages) — many people search "is Kalshi legal in California"

## Part 4 — Internal linking strategy

Every generated page must contribute to a tight internal-link graph:

```
                        Home /
                          │
              ┌───────────┼───────────┐
            /sports     /golf      /learn
              │           │           │
        /sports/nba   /golf/2026  /learn/no-vig
              │           │           │
      ┌───────┼──────┐    │          (article)
   teams/  players/ events/
      │       │       │
   Lakers  Doncic  Lakers-vs-Celtics
      │       │       │
      └───────┴───────┴── back to /sports/nba
```

Rules:
1. Every leaf page links UP to its parent hub
2. Every leaf page links SIDEWAYS to 5-10 sibling leaf pages ("Related games", "Other Lakers games", "More NBA props")
3. Every hub page links DOWN to top N leaf pages
4. Use descriptive anchor text — "Scottie Scheffler PGA Championship odds" not "click here"
5. Link contextually within prose, not just in nav

## Part 5 — Measurement + iteration

**Track:**
- Google Search Console — impressions/clicks per URL pattern, query coverage
- GA4 — landing page traffic from organic, AI search traffic (when GA exposes the source)
- Index coverage report — make sure Google is INDEXING the pages we generate (pSEO common failure: pages exist but get classified as "Discovered – currently not indexed")
- Manual checks in Perplexity / ChatGPT search / Claude — does our site get cited? For what queries?
- Internal: rolling 90-day count of indexed pages, per-page-type CTR

**Iterate on:**
- Pages that get 0 impressions → kill (or merge into a hub)
- Pages with high impressions + low CTR → improve title/description
- High CTR pages → study the pattern, generalize it

## Part 6 — Implementation roadmap

### Phase 1 (this week — quick wins, no schema changes)
- [ ] Expand `app/robots.ts` to explicitly allow GPTBot/ClaudeBot/PerplexityBot/Google-Extended/CCBot/Applebot-Extended/Bytespider
- [ ] Add `llms.txt` at root
- [ ] Add `FAQPage` schema generator helper in `lib/seo.ts`
- [ ] Add FAQ section + schema to every league page, game page, tournament page (auto-generated from data)
- [ ] Add `<time datetime>` + visible "Updated N minutes ago" on all live pages
- [ ] Add author meta + `Article.author` to learn articles

### Phase 2 (next 2 weeks — URL restructure)
- [ ] Add `slug` columns to `sports_events`, `sports_contestants`, `golfodds_tournaments`, `golfodds_players` (backfill at write time)
- [ ] Stand up `/sports/[league]/[year]/[event_slug]` route with 301 from UUID URLs
- [ ] Stand up `/golf/[year]/[tournament_slug]` route with 301 from `?id=`
- [ ] Stand up `/sports/[league]/players/[player_slug]` route
- [ ] Stand up `/sports/[league]/teams/[team_slug]` route
- [ ] Regenerate sitemap with new URLs

### Phase 3 (weeks 3-4 — historical archive)
- [ ] Add `archive` flag + closed-event capture pipeline
- [ ] Build archive page template (final odds, result, biggest movers, "how accurate was Kalshi" summary)
- [ ] Year-index pages at `/golf/archive/{year}` and `/sports/{league}/archive/{year}`
- [ ] News sitemap (`/news-sitemap.xml`) for high-attention events

### Phase 4 (weeks 5-8 — futures hubs + content)
- [ ] Futures market hub pages (`/sports/{league}/futures/{market_slug}/{year}`)
- [ ] Divisional pages (`/sports/nfl/divisions/afc-east` etc.)
- [ ] "Odds today" daily index page
- [ ] Glossary articles (one-time content sprint, 50 entries)
- [ ] State-by-state Kalshi legality pages (50 entries)

### Phase 5 (ongoing — distribution)
- [ ] Reddit auto-posts to r/sportsbook, r/Kalshi when major edges open (manual review queue → post)
- [ ] X / Bluesky / Threads auto-posts on major moves
- [ ] Weekly "biggest edges of the week" recap on the blog (a real article URL per week)
- [ ] Outreach: pitch ourselves as a source to Action Network, Covers, etc.

## Part 7 — Gotchas + things to NOT do

1. **Don't no-index pages prematurely.** Common pSEO mistake: an over-zealous robots/meta setup kills the whole experiment. Default `index, follow` unless data is genuinely empty.
2. **Don't have URLs with parameters AND clean slugs both indexed.** Canonicalize one direction. 301 the loser.
3. **Don't ship 50K pages on day one.** Google will crawl them and possibly mark most as "Discovered, not indexed." Stage rollouts: ship 1K pages, wait, check indexation, ship 10K more.
4. **Don't put core data behind auth at the URL level.** Keep public read of the odds; gate per-book detail, alerts, force-refresh, etc. (already correct). pSEO pages MUST be indexable without login.
5. **Don't generate duplicate titles.** Each page must have a unique `<title>` — template w/ entity variables, not the same string.
6. **Don't forget hreflang / canonical** — if we add /en/ or /es/ later, this becomes load-bearing.
7. **Don't break image OG.** Each game/player/tournament should have an OG image (the existing `/api/og/*` is the place — generalize it).
8. **Don't violate Kalshi's data ToS** — surface data, link back, never claim to be a Kalshi mirror.
9. **Don't ship cloaked content** — what AI/Googlebot sees must match what users see.

## Part 8 — AEO-specific bonus moves

### 8.1 Get cited on Wikipedia / Wikidata
One backlink from Wikipedia is worth thousands. The Kalshi article on Wikipedia could plausibly cite an external "odds tracker" — pitch ourselves as that. Same for relevant per-event articles when our methodology page has stable, encyclopedic content.

### 8.2 Be a Reddit + X authority
LLMs are trained heavily on Reddit + X. Establish presence in r/sportsbook, r/Kalshi, r/sportsbetting under a consistent account. Drop methodology + odd-snapshots organically. Never spam. Goal: become a reference the community quotes.

### 8.3 Public data exports
Publish a small daily JSON export at `/data/daily-odds.json` (anonymized, limited fields, but real). Researchers/students scrape it → cite us. Same logic powers github.com/openfootball type datasets.

### 8.4 Build a free "no-vig calculator" tool page
Free utility tools attract enormous backlink + AI-citation surface. The no-vig calc, Kelly calc, parlay calc — all are search-volume gold AND high citability.

### 8.5 Press release on major findings
Once per quarter, publish a data-driven story: "We tracked 2,847 Kalshi golf markets in 2025 — here's how often the books beat them." Pitch to Sports Business Journal, ESPN, The Athletic. One placement = decades of AI training data.

---

## Appendix — quick reference

### Schema.org types we'll use

| Type | Where |
|---|---|
| `Organization` | Root layout / footer |
| `WebSite` + `SearchAction` | Root layout |
| `SportsEvent` | Game, tournament, futures pages |
| `SportsTeam` | Team pages |
| `Person` (Athlete) | Player pages |
| `OfferCatalog` + `Offer` | Per-book pricing tables |
| `Article` + `Author` | Learn / blog pages |
| `FAQPage` + `Question` | Every page bottom |
| `BreadcrumbList` | All navigated pages |
| `ItemList` | Hub pages |
| `Review` + `Rating` | Book reviews |

### Long-tail query patterns we want to own

```
"kalshi odds {event}"
"{event} odds today"
"{player} odds to win {tournament}"
"best odds {team}"
"kalshi vs draftkings {event}"
"kalshi {event} probability"
"{tournament} 2026 odds"
"{game} money line"
"{player} {market_type} odds"
"is kalshi legal in {state}"
"{tournament} historical odds"
"{date} sportsbook odds"
"how to bet kalshi"
"kalshi fees explained"
```

### Don't sleep on AI-search referral analytics

GA4 v5+ exposes AI-engine referrals separately. Track them. Build a dashboard. If our "Kalshi vs sportsbook fee math" page generates 40 Perplexity referrals/week, double down on similar evergreen pages.
