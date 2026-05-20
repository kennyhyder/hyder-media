# Show HN submission

Submit at https://news.ycombinator.com/submit

**Best timing:** Tuesday or Wednesday, 7:00–9:00 AM ET (US tech crowd starting their day, EU still active). Avoid Mondays (lots of competition) and Fridays (low engagement). Don't submit Sunday night — HN's penalty algorithm hits late-Sunday submissions harder.

**Critical:** comment on your own submission within 10 min of submitting. The first comment thread (especially if it's substantive technical detail) anchors discussion and prevents "no comments yet" decay. The text below has a pre-written first comment to paste.

---

## Title (use exactly — HN penalizes title editing later)

```
Show HN: SportsBookISH – Compare Kalshi event-contract odds vs US sportsbooks
```

(80 chars / fits the 80-char title limit)

## URL

```
https://sportsbookish.com
```

## Text (the "tell HN" body)

```
I built SportsBookISH because nobody had a clean way to compare Kalshi's event-contract pricing against US sportsbook consensus, even though sharp bettors I respected had quietly been doing this manually for months.

Kalshi is a CFTC-regulated exchange — prices are set by traders, not by a book baking in 4-8% vig. When Kalshi trades a side at 42¢ but the no-vig book median is 47%, that's a real 5-point edge for the same outcome. The math is straightforward; the problem was always data fragmentation.

Stack notes for HN readers:
- Next.js 16 + Turbopack frontend on Vercel
- Supabase Postgres backend with cron-driven ingestion every 5 min
- Kalshi prices via their public REST + WebSocket (Elite tier users get sub-minute updates)
- Sportsbook lines via The Odds API (~$30/mo upstream)
- DataGolf model overlay for PGA Tour ($30/mo upstream)
- No-vig consensus is per-market median across 11 books after stripping the hold
- Edge calculations are net of Kalshi's fee formula (max(1¢, ceil(0.07×p×(1-p)×100)) capped at 7¢)

The full OpenAPI 3.1 spec is at /api/v1/openapi.json with a free shared demo key documented in /api/docs — happy for HN folks to bang on it. CC-BY-4.0 daily snapshots published to Hugging Face Hub at kennyhyder/sportsbookish-daily-odds for anyone doing ML training or prediction-market research.

A couple of things I'd love feedback on:
1. The free tier shows headline odds across all sports — is that the right cutoff? Some folks have suggested I gate it harder, others say it's already too thin.
2. The Kalshi WebSocket is sub-second on Elite but battery-killing on mobile. Curious if anyone here has implemented progressive degradation patterns (websocket-when-foreground, poll-when-background).
3. Compliance: Kalshi is federal/CFTC so the markets themselves are interstate, but I'd be interested in any framework folks have used for surfacing "legal in your state" UX for the books we link to.

API docs: https://sportsbookish.com/api/docs
GitHub (docs + examples): https://github.com/kennyhyder/sportsbookish-docs
HF dataset: https://huggingface.co/datasets/kennyhyder/sportsbookish-daily-odds
```

## First-comment-to-paste (post this 60 sec after submission lands)

```
Author here, happy to answer anything technical.

A few things I wrestled with that might be interesting to HN:

**No-vig math at scale.** Computing the per-market de-vigged probability requires knowing every outcome on the book's market. Some books split markets weirdly (separate moneyline+spread vs combined; futures with 100+ contestants where some have no Kalshi equivalent). I ended up normalizing post-fetch in Postgres rather than at the API layer because the same raw book row gets reused across multiple "comparable" Kalshi markets.

**Slug collisions.** MLB plays the same teams 3 days in a row, each with a "Hits" prop event. All three slugify to the same string. event-by-slug returned null on maybeSingle() and 404'd in the wild. Fix: append date suffix to the slug for repeating event types. Almost shipped this with a one-off backfill but ended up just self-healing on next cron-ingest tick.

**Kalshi fee math.** The fee formula caps at 7¢ per contract regardless of contract count, which is asymmetric vs sportsbook vig (which scales with stake). I show edge gross-of-fee for Pro users and net-of-fee for Elite, because at typical bet sizes the fee compresses small edges enough to matter and the math isn't intuitive.

Open to porting more leagues (WNBA, MLS Cup, FIFA Club WC) if HN folks have interest. Drop a comment.
```
