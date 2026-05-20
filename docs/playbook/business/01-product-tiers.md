# Product tiers — what's in each one

## Tier 1: Free — "The Modern AI-Discoverable SaaS Playbook (Intro)"

**Format:** 5-page PDF, ~2,500 words.
**Distribution:** Email-gated download on hyder.me/playbook
**Goal:** Email capture + funnel entry.

**Contents:**
- Foreword (why this playbook exists, the 7-surface fragmentation)
- The 5-layer model overview (one paragraph per layer)
- Three named bug stories (pick the most viscerally relatable: Stripe newline, gtag race, slug 404)
- Closing CTA: "The full playbook covers all 12 patterns + pre-flight setup + checklists + Claude skill. Get it for $79."

**Production:**
- Export from `00-playbook.md` with a "Free intro" mode that includes only the foreword + §1 + abbreviated §8.
- Same playbook.css for styling.
- Cover page with brand + "Hyder Media · Modern AI-Discoverable SaaS Playbook (Intro)".

**Why 5 pages and not 10:** below 10 pages, people read it; above 10, they skim or save-for-later. You want READS, not saves.

## Tier 2: Paid ($79) — "The Modern AI-Discoverable SaaS Playbook (Full)"

**Format:** Bundle including:
- Full PDF (40+ pages, the entire `00-playbook.md`)
- Templates directory (llms.txt, webApplicationLd.ts, csp-reference.md, journalist-pitch.md, wikidata-quickstatements.md)
- Code snippets (the dataLayer.push pattern, the env-trim helper, the Stripe success-URL pattern)
- The Claude skill (SKILL.md ready to drop into `~/.claude/skills/`)
- Pre-launch checklist (as a printable single-page PDF + a Markdown checklist file)
- 12 months of free updates (when you ship a new defensive pattern, buyers get it)

**Delivery:** Gumroad or Lemon Squeezy. Buyer gets a download link + email with all files zipped.

**Pricing:** $79 standard, with a few price experiments:
- **Launch week:** $59 (introductory) — drives initial reviews + testimonials
- **Bundle with template add-ons:** $129 — if you build out more templates later
- **Team license** (5 seats): $299 — agencies + small teams who want to standardize

**License:** Personal use + within one organization. NOT for resale or redistribution. (CC-BY-SA-4.0 on the playbook content for derivative quoting; the templates + code stay closed-source.)

## Tier 3: Done-for-you ($2,500–5,000) — "Hyder Media Launch Engagement"

**Format:** 2-week engagement applied to the buyer's project. Synchronous kickoff + async work + final walkthrough.

**Pricing:**
- **Solo SaaS / startup project:** $2,500 flat
- **Funded startup or established company:** $5,000 flat
- **Enterprise (custom):** starts at $10k, scope per engagement

**What you deliver in the engagement:**

Week 1:
- Day 1: 90-min kickoff call — audit their current state, propose work plan
- Day 2-3: Wikidata entity + llms.txt + JSON-LD schemas (Layer 1)
- Day 4-5: Per-page schemas + OpenAPI spec + sitemap + IndexNow (Layer 2)

Week 2:
- Day 6-7: Security headers + RLS audit + secret hygiene (Layer 3)
- Day 8-9: GA4 events + conversion tracking + Stripe tier-in-URL (Layer 4)
- Day 10: Launch kit prep (social copy + journalist list + IndexNow) + 60-min handoff call

**What you DON'T promise:**
- Writing their marketing copy beyond the playbook templates
- Direct journalist outreach (you give them the list + template; they send)
- Ongoing maintenance after the 2 weeks (separate retainer)

**Booking:** Calendly integration on hyder.me/services or the playbook landing page.

**Capacity:** 2 active engagements at a time = 4-6 per year if engagements stack cleanly. At $3,500 avg = $14k–21k per quarter just from this tier.

---

## Why tier 3 is where the real money is

A $79 product needs ~13 sales to match one $1,000 consulting hour. Math is brutal at scale: 500 hours/yr of consulting capacity × $250/hr = $125k. Selling 1,500 PDFs to match that means 3 paid customers per day, every day, for a year.

The PDF is not the business. The PDF is the credibility asset that makes the consulting easy to sell. People who've read your playbook do not need to be convinced you know what you're doing.

This is the indie-consultant business model: **publish to build trust, sell services for revenue**.

The $79 tier exists to:
1. Pre-qualify buyers (they liked your free PDF enough to pay $79; they'll like a $3,500 consultation too)
2. Generate testimonials + reviews that anchor the DFY pricing
3. Capture revenue from people who'd never hire you but will pay for a manual

Don't optimize for $79 sales volume. Optimize for $3,500 consultations from people who first heard of you via the free or $79 tier.
