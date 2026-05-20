# Journalist outreach — direct pitches

This is where actual press coverage comes from. Wire services give you SEO; direct pitches give you stories. Aim to send 5 in one sitting, personalize each, batch the rest over the week.

**Email pitch template** (use as the base, customize the bracketed bits per journalist):

---

Subject: `[FIRST NAME], built a Kalshi/sportsbook odds comparison tool — might be a story for [PUBLICATION]`

Body:

```
Hi [First name],

I read your piece on [SPECIFIC RECENT ARTICLE — e.g., "the CFTC's ruling
in Kalshi's favor", "Kalshi's NFL contract launch", "the rise of sports
event contracts"] and wanted to flag a related angle.

Kalshi opening up sports event contracts is the biggest structural shift
in US betting in a decade. But almost nobody has been comparing Kalshi's
prices against the sportsbooks side-by-side in real time. The sharp
bettors I know have been doing this manually for months because the data
was scattered.

I shipped SportsBookISH this week — first public tool that compares
live Kalshi event-contract pricing against the no-vig consensus from 11+
US sportsbooks across all major sports (NFL/NBA/MLB/NHL/EPL + PGA).
Updated every 5 min.

Two angles I think your readers would care about:

1. The pricing-edge data itself is reportable — Kalshi is consistently
   3-7% off the no-vig book consensus on outright futures, particularly
   on golf and basketball MVPs. That's not a hot take; it's empirical
   and I can pull the data for you. Public CC-BY-4.0 daily snapshot is
   on Hugging Face if you want to verify independently.

2. The regulatory and structural angle — Kalshi being federal/CFTC means
   it's accessible from all 50 states, which makes the price disparity
   politically and economically more interesting than a typical
   sportsbook-vs-sportsbook line shopping story.

Free tier of the tool is at https://sportsbookish.com — happy to walk
you through it on a 15-min Zoom if useful, or pull any specific data
queries you'd want for a piece.

Either way, thanks for the work you're doing covering this space.

— Kenny Hyder
   Founder, SportsBookISH
   kenny@hyder.me
```

---

## Curated journalist list

These are reporters who've covered Kalshi, prediction markets, or sports betting policy in the past year. Email addresses are either published on their author pages, listed on muckrack.com, or follow the publication's standard pattern. Verify before sending; outdated addresses tank your sender reputation.

### 1. Eric Lipton — The New York Times

Beat: Investigative reporter; has covered Kalshi's regulatory fights extensively in 2024-2025.
Email pattern: `firstname.lastname@nytimes.com` (verify on NYT staff directory)
Why: The NYT angle is the regulatory + political dimension, not the betting tactics. Lead the pitch with "what does it mean that Kalshi is federally accessible while sportsbooks are state-by-state".
Pitch hook to customize: "Your reporting on Kalshi's CFTC ruling raised the question of how state regulators would respond. Now that the markets are running for a full season, the pricing data shows that some structural arbitrage is real."

### 2. Brett Knight or Steve Andrews — Forbes (sports business beat)

Email: Forbes contributor list at https://www.forbes.com/sites/[author-slug]/ — get email via Forbes staff form
Why: Forbes does business-of-betting better than business-of-sports. Lead with the API + open dataset angle (developer/B2B story, not gambling story).
Pitch hook: "I'm not a Forbes-typical betting story — I built B2B infrastructure (REST API, open dataset) that other betting platforms and quant funds could build on top of."

### 3. Bill Speros — Front Office Sports

Email: Front Office Sports staff directory at https://frontofficesports.com/about/
Why: FOS is the highest-traffic publication that consistently covers the business side of sports betting. They like specific numbers + product launches.
Pitch hook: "Public daily CC-BY-4.0 dataset means your readers can independently verify pricing claims — first of its kind for Kalshi data."

### 4. Eric Ramsey — Legal Sports Report

Email: pattern is usually `firstname@legalsportsreport.com` — verify at https://www.legalsportsreport.com/staff/
Why: LSR is the trade publication for sports betting industry. They cover product launches as news (not opinion). Highest-conversion pitch venue for SportsBookish.
Pitch hook: Skip the consumer angle entirely; pitch as B2B API + open data infrastructure.

### 5. Pat Evans — Sports Handle / iGB North America

Email: pat@igamingbusiness.com or pat.evans@sportshandle.com — verify on their LinkedIn
Why: Covers the operator/business side of sports betting. Loves Kalshi-vs-sportsbook framing because it's a fresh angle his readers haven't seen 100 times.
Pitch hook: "The data shows Kalshi is consistently mispriced relative to book consensus — your operator readers should care because this affects how they price against the exchange going forward."

---

## Follow-up cadence

- **Day 0:** Send 5 pitches. Personalize the [bracketed] sections in each.
- **Day 3:** Soft follow-up to non-responders ("Following up on the SportsBookISH note from Monday — happy to send specific data if useful"). Single sentence, no attachment.
- **Day 7:** Final follow-up with a specific data hook ("Pulled some interesting numbers from this week's MLB markets — Kalshi was 6.2% off DraftKings consensus on the Yankees-Sox series winner. Happy to share the breakdown if you'd find it useful for a piece.")
- **Day 14:** Stop. If they haven't replied in 2 weeks they won't reply at all. Don't burn the relationship by becoming a pest.

## What NOT to do

- Don't BCC the same template to multiple reporters. They check, they hate it, and they share embarrassing pitches in Slack. Each pitch is its own personalized email.
- Don't attach a PDF press release. Paste the relevant 2-3 paragraphs inline. Attachments get filtered.
- Don't follow up via DM on Twitter/X if they ignore your email. That's hard escalation and tanks future deliverability.
- Don't pitch the same reporter the same angle twice. If the first pitch didn't land, the second one needs a fresh hook (specific data, news peg, or product update).

## Backup contact list (lower-priority but still worth it)

- **John Brennan** — Action Network (their staff is competition-curious about new tools)
- **Brad Allen** — Sports Business Journal Daily
- **Matthew Crowley** — Las Vegas Review-Journal sports betting beat
- **Robert Linnehan** — XL Media / Bonus.com
- **The Athletic sports gambling desk** — submit via their tips form

## Track responses in a simple sheet

| Date | Reporter | Pub | Outcome | Followup date |
|---|---|---|---|---|
| YYYY-MM-DD | Eric Lipton | NYT | sent | YYYY-MM-DD |
| ... | | | | |

If three of five pitches get a non-response after Day 7 follow-up, the pitch itself is the problem — rewrite the hook before sending the next batch.
