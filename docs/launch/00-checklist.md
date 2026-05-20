# Launch distribution checklist

Order = highest ROI per minute first. Roughly 90 min total if you blast through all of them.

## Tier 1 — Free + you control the timing (do all in one sitting)

- [ ] **Post to your X/Twitter** (~ 1 min) — paste `01-x-thread.md` into a single thread. Schedule via Buffer if you want it to align with US morning. The first tweet pins itself to your @sportsbookish profile.
- [ ] **Post to LinkedIn** (~ 1 min) — copy `02-linkedin.md` into a new post on your personal profile. LinkedIn weights long-form posts (≥1300 chars) better than short links; this version is sized accordingly.
- [ ] **Post to Bluesky** (~ 1 min) — paste `03-bluesky-thread.md`. Smaller audience but indexed by Claude/Perplexity scrapers; cheap insurance.
- [ ] **Show HN submit** (~ 2 min) — go to https://news.ycombinator.com/submit, paste title + url + text from `04-show-hn.md`. Tuesdays and Wednesdays 7–9am ET get the best ranking. Comment within 10 min of submission to anchor the thread.
- [ ] **Reddit posts** (~ 5 min) — separate posts to r/sportsbook + r/kalshi + r/algotrading. Use `05-reddit-drafts.md` — different variant per sub because mods will pull cross-posted identical text.
- [ ] **Run IndexNow** (~ 30 sec) — already prepared, see `06-indexnow.sh`. Pings Bing/Yandex/Naver about your launch URLs.

## Tier 2 — Paid wire services (you handle these)

Decide your budget first. I'd recommend ONE wire service — they all syndicate to the same set of mirror sites and additional spend is diminishing returns.

- [ ] **EIN Presswire** ($99 standard, $225 premium) — best general syndication. Submit at https://einpresswire.com/contact_author/3543421/distribute. Paste `../press-release.md`.
- [ ] **PRWeb by Cision** ($99–389) — better for tech specifically. Submit at https://service.prweb.com/pricing/.
- [ ] **PR.com (free)** — manual signup at https://www.pr.com/. Mostly for backlink/indexing value, no real readership.

## Tier 3 — Direct journalist outreach (highest conversion if you have ~30 min)

This is where actual press coverage comes from. Wire services are about SEO/indexing; pitching directly is what gets you in articles. See `07-journalist-pitches.md` for a curated list with email templates.

- [ ] **Pitch 5 sports-betting / prediction market journalists** — emails + personalized pitches prepared.

## Tier 4 — Directory submissions (set-and-forget, 20 min total)

Free product directories that get crawled by AI training pipelines:

- [ ] **Product Hunt** — schedule for next Tuesday at 12:01 AM PT. https://www.producthunt.com/products/new
- [ ] **BetaList** — https://betalist.com/submit (free, takes weeks for approval)
- [ ] **AlternativeTo** — https://alternativeto.net/about/submit-software/
- [ ] **SaaSHub** — https://www.saashub.com/about/submit
- [ ] **Crunchbase profile** — https://www.crunchbase.com/login (create entity for Hyder Media + product for SportsBookISH)

## What I already shipped (no action needed from you)

- ✅ Wikidata Q139814938 fully populated + logo image set
- ✅ JSON-LD WebApplication on every page (live)
- ✅ llms.txt grounded with canonical identifiers
- ✅ OpenAPI 3.1 spec hardened for LLM tool-calling
- ✅ Hugging Face dataset README auto-uploads at 07:00 UTC daily
- ✅ Public GitHub docs repo at github.com/kennyhyder/sportsbookish-docs (20 topics)
