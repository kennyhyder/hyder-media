# Landing page copy

Use this as the source for hyder.me/playbook. Section-by-section. Each section is annotated with WHY.

The page has three goals, in order:

1. Convince a stranger this playbook is worth their email address (Tier 1 capture)
2. Convince them to pay $79 for the full version (Tier 2 conversion)
3. Position you for a $2,500+ DFY engagement when they need help applying it (Tier 3 lead)

---

## Section 1: Hero (above the fold)

**Goal:** 5-second test. Does the visitor know what this is, who it's for, and why they should care?

```
# The Modern AI-Discoverable SaaS Launch Playbook

Every optimization, defensive pattern, and launch tactic for shipping a SaaS that ranks on Google AI Overview, gets cited by Perplexity, and shows up in Claude's answers — by an operator who's done it.

[ Get the free intro ]   [ See the full playbook — $79 ]

★★★★★ "Genuinely changed how I think about launching anything web-facing."
— [Testimonial source if you have one. If not, drop the line until you do.]
```

**Annotations:**
- "Modern AI-Discoverable" → the differentiator. Plenty of SaaS launch playbooks exist; this one is specifically about AI surfaces.
- "by an operator who's done it" → credibility hook. You're not a course-seller; you're a builder.
- Two CTAs because two tiers. Free is the higher-volume click; $79 is the higher-value click.
- Don't fake the testimonial. Cut the line if you don't have one yet — replace with a credential ("Hyder Media has been doing this since 2009" works as a placeholder).

## Section 2: The problem (the visceral hook)

**Goal:** Make the reader feel pain they didn't know they had.

```
## Your product is invisible to the AI search engines that now answer 30% of queries.

Three years ago, "discoverability" meant Google. You optimized for blue links, you waited for rankings to compound, you eventually got traffic.

That world is gone. Your traffic now splits across:

- Google AI Overviews (pulls a different signal than blue-link search)
- Perplexity, ChatGPT search, Claude (cite sources visibly; have completely different ranking logic)
- Vertical AI tools (every domain agent is using OpenAPI tool-calling against APIs that aren't yours)
- Bing, Yandex, Naver (IndexNow lives here; most builders skip the 30-second setup)

Each surface consumes a different signal. **Optimizing for one and ignoring the rest is the new "ranks on page 2."**
```

**Annotations:**
- Number ("30% of queries") makes the claim feel real. If you don't have a specific stat, swap for "a growing share of." Don't make up data.
- Bullet points work because they make the fragmentation visible without diving into details yet.
- The closing line is your strongest copywriting moment — make sure it stings.

## Section 3: What's in the playbook

**Goal:** Show enough specificity to make the buyer feel "this person knows their shit."

```
## What's in the playbook

**Pre-flight (§0)** — Domain + DNS + DB + Stripe + Resend + GA4 + Search Console + Bing WMT + SPF/DKIM/DMARC. The boring infra most playbooks skip. The reason most launches fail to compound.

**Layer 1: Entity Identity (§3)** — Wikidata entity creation, llms.txt for AI grounding, sitewide JSON-LD WebApplication schema. The deepest signal LLMs use to decide whether to cite you.

**Layer 2: Search + Answer Engines (§4)** — Per-page schemas, OpenAPI 3.1 for LLM tool calling, sitemap + IndexNow strategy, slug uniqueness rules. The mid-layer that bridges traditional SEO to modern AI search.

**Layer 3: Compliance + Security (§5)** — Production CSP for Stripe + GA4 + Supabase (with every gotcha annotated), all 9 security headers, RLS defaults, the env-var hygiene that prevents the "Connection error, retried 2 times" bug.

**Layer 4: Conversion + Analytics (§6)** — GA4 event firing without the gtag race condition, Stripe success URL pattern to avoid webhook timing bugs, error handling that surfaces causes via URL.

**Layer 5: Distribution (§7)** — Ranked launch channels by ROI per minute. X / LinkedIn / Bluesky / Show HN / Reddit / journalist outreach / paid wire. With pre-written templates for each.

**Defensive patterns (§8)** — 12 named production bugs by symptom. The Stripe newline bug. The 308 cache-poisoning trap. The gtag race condition. The webhook race condition. The slug collision 404. Everything that's cost real launches real hours.

**Checklists (§9)** — Pre-launch (day-7 / -5 / -3 / -1 / 0), weekly health checks, recovery playbook for the most common bugs.
```

**Annotations:**
- Each layer is one paragraph. Skimmable. Each starts with what the layer is for (the buyer's outcome), then names a specific tactic or tool.
- "12 named production bugs by symptom" — concrete number, concrete framing.
- This section is the longest on the page intentionally. People scroll. Give them enough specificity that scrolling = increasing conviction.

## Section 4: What you get

**Goal:** Convert browsers to buyers by listing concrete artifacts.

```
## What you get with the $79 full playbook

✓ The complete 40+ page playbook (PDF, HTML, and source markdown)
✓ All templates: llms.txt, WebApplication JSON-LD generator, reference CSP, journalist pitch template, Wikidata QuickStatements batch
✓ Production code snippets you can paste into your project
✓ The Claude skill (drop into ~/.claude/skills/ to apply the playbook to any project via /saas-launch-playbook)
✓ Pre-launch checklist (printable single-page PDF)
✓ 12 months of free updates as new patterns are documented

Lifetime use within one organization. Personal license, not redistributable.

[ Buy the playbook — $79 ]

7-day money-back guarantee if it doesn't apply to your project.
```

**Annotations:**
- Specific deliverables in a checklist. Each item is concrete.
- "Lifetime use within one organization" handles team-buying concerns without explicit team-license complexity.
- Money-back guarantee removes friction. Real refund rate is <2% on quality content; the guarantee converts way more than it costs.

## Section 5: Author / about

**Goal:** Establish credibility without humble-bragging.

```
## Who wrote this

**Kenny Hyder** — Hyder Media, performance marketing consultancy since 2009.

I've shipped landing pages, ad funnels, dashboards, and SaaS products across finance, ecommerce, B2B SaaS, fitness, automotive, and education verticals. This playbook is documented from real production code I've shipped in the last 12 months.

Reach me at kenny@hyder.me. If you're working on a launch and want me to apply the playbook to your project directly, that's an engagement I do — see [Done-for-you launches](/services/launch).
```

**Annotations:**
- One paragraph. Don't auto-bio.
- "Documented from real production code" → the credibility hook. Theory playbooks are everywhere; this one comes from work.
- Soft pitch the DFY engagement at the bottom. No hard sell — just an option for readers who want help.

## Section 6: FAQ

**Goal:** Address the 5 objections that prevent purchase.

```
## Common questions

**Is this just AI SEO?**
No. It's a complete pre-launch + launch playbook covering Wikidata entity grounding, security headers, RLS, conversion event tracking, defensive engineering patterns, and distribution. AI discoverability is one layer of five.

**Do I need to be on Next.js / Vercel?**
No. The patterns are vendor-agnostic. Code examples are in TypeScript (most universal) but apply to any modern stack. CSP, JSON-LD, Wikidata, RLS — none of these depend on the framework.

**Will this work for [my specific industry]?**
Yes — the patterns are stack-agnostic and industry-agnostic. You'll customize the specific entities + Wikidata claims to match your domain, but the structural recipe is the same whether you're building B2B SaaS, ecommerce, fintech, or anything else web-facing.

**How is this different from [random AI SEO course]?**
Most AI SEO content is theoretical or focused on content marketing. This is a production engineering playbook with named defensive patterns ("the Stripe newline bug", "the gtag race condition") from real shipped code.

**Do you offer refunds?**
Yes — 7-day money-back guarantee if the playbook doesn't apply to your project.

**Can I share with my team?**
The license is for use within one organization. Team license available — drop me an email.
```

**Annotations:**
- Each Q&A is short. Long FAQ answers signal anxiety.
- Anticipate the "but my situation is different" objection (the third FAQ).
- Refund + team-license questions are conversion-stoppers — handle them explicitly.

## Section 7: Free intro CTA (the email capture)

**Goal:** For buyers who aren't ready to pay $79, capture the email.

```
## Not ready to commit? Get the free intro

A 5-page condensed version of the playbook with three named patterns. Free, instantly downloadable, no spam.

[ Email field ]   [ Get the free intro ]

We'll email you when the playbook updates. Unsubscribe any time.
```

**Annotations:**
- "5-page" is the key word. Implies "this is short, you can read it in 10 minutes."
- "No spam" + "unsubscribe any time" reduces hesitation.
- DO NOT ask for name. Email field only. Every additional field cuts conversion ~10%.

## Section 8: Footer

**Goal:** Trust signals + secondary CTAs.

```
─────────────────────────────────────────

[Hyder Media logo]
Performance marketing consultancy · since 2009
Honolulu, Hawaii

Services · About · Contact · Twitter · LinkedIn

© 2026 Hyder Media. Made in Hawaii.
```

---

## On-page schema (JSON-LD)

The landing page itself must be marked up with `Article` schema (so it ranks for "ai discoverable saas playbook" queries) AND `Product` schema (so the $79 offer shows up in shopping/AI results). See `publish/website.md` for the schemas.

## A/B tests to run after launch

Once you have ~500 visitors:

- **Hero headline variant 1:** "every optimization, defensive pattern..." vs **variant 2:** "the launch playbook for the AI-search era"
- **Price test:** $79 vs $99 vs $149 — at low volume, this is noise; at 100+ sales it's signal
- **CTA placement:** sticky bottom-of-screen CTA on mobile vs in-content only
- **Free intro page length:** 5 pages vs 8 pages — does more free content cannibalize $79 sales?

Don't A/B test until you have meaningful traffic. Early-stage premature A/B testing is worse than no testing.
