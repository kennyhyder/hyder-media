# Publishing on hyder.me

The playbook is the kind of long-form content that earns backlinks and AI grounding *for years* if you set it up right. Don't slap it into a random URL — engineer the page.

## Canonical URL structure

```
https://hyder.me/playbook                  ← landing / overview
https://hyder.me/playbook/identity         ← Layer 1
https://hyder.me/playbook/seo-ai-engines   ← Layer 2
https://hyder.me/playbook/security         ← Layer 3
https://hyder.me/playbook/conversion       ← Layer 4
https://hyder.me/playbook/distribution     ← Layer 5
https://hyder.me/playbook/patterns         ← Defensive patterns
https://hyder.me/playbook/checklists       ← Pre-launch + weekly + recovery
```

Why split into pages: each layer becomes its own Google-AI-Overview-rankable resource. A single 15K-word page is too long to rank for specific intent queries ("CSP form-action gotcha"); split pages match the long-tail.

Each sub-page should be ≥2,000 words of actual content (not just an excerpt of the main doc).

## On-page SEO for /playbook/*

Each page MUST have:

1. **`<h1>` with the page's specific topic.** Not "Playbook — Layer 1"; rather "Wikidata + llms.txt + JSON-LD: Building Entity Identity for AI Discoverability"
2. **`<meta name="description">`** with 150-155 chars summarizing the page
3. **JSON-LD `Article` schema** (not just BlogPosting — Article ranks better for whitepaper-style content):
   ```json
   {
     "@context": "https://schema.org",
     "@type": "TechArticle",
     "headline": "[page title]",
     "author": { "@type": "Person", "name": "Kenny Hyder", "url": "https://hyder.me" },
     "publisher": { "@type": "Organization", "name": "Hyder Media", "url": "https://hyder.me" },
     "datePublished": "2026-05-19",
     "dateModified": "2026-05-19",
     "image": "https://hyder.me/og-images/playbook-layer-1.png",
     "wordCount": 2400,
     "articleSection": "AI Discoverability",
     "keywords": ["wikidata", "json-ld", "llms.txt", "ai grounding"]
   }
   ```
4. **`<link rel="canonical">`** pointing at the URL itself
5. **OG image** (1200×630) specific to each page (not a generic site card)
6. **Breadcrumb JSON-LD** for the nav crumb (Hyder Media → Playbook → [layer name])
7. **Inline TOC** at the top using `<nav>` with anchor links — Google AI Overview uses these as "jump to section" candidates

## Hyder.me header / footer integration

The playbook should feel like an asset *of* hyder.me, not a separate microsite. Use the existing hyder.me header (dark mode toggle, nav, logo). Footer should link to:

- The other playbook layer pages (cross-link aggressively)
- Your contact form
- The PDF download (gated or open, your call)
- Your X / LinkedIn for "share this playbook"

## Schema.org `HowTo` for the checklists

Pre-launch checklist + weekly health checks should be marked up as `HowTo` schema. Google AI Overview specifically pulls HowTo for "how do I launch a SaaS" queries.

```json
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Pre-launch checklist for AI-discoverable SaaS",
  "step": [
    {
      "@type": "HowToStep",
      "name": "Create Wikidata entity",
      "text": "..."
    },
    ...
  ]
}
```

## Open Graph image per page

Don't reuse a single OG card for every playbook page — that hurts shareability on social. Generate a per-page OG card with the page title rendered on a branded background. SportsBookISH's `/api/og/sports-event?id=...` route is a working reference.

For static pages like the playbook, you can pre-render the images at build time and serve as static PNGs under `/og-images/playbook-[slug].png`.

## Internal linking from existing hyder.me pages

After the playbook is live, edit relevant existing pages on hyder.me to link into the playbook contextually:

- `/index.html` — add a "Recent thinking" or "Playbook" link in the nav
- `/tools.html` or similar — sidebar callout: "Learn the methodology behind these tools — read the playbook"
- Any case study pages — link to the relevant playbook section ("we applied Layer 4 from our SaaS playbook on this project")

Internal links are what tell Google "this content is structurally important to this site."

## Indexing after publication

After deploying the playbook pages:

1. **Submit each URL to Google Search Console** → URL Inspection → Request Indexing. Do this manually for the first 8 pages.
2. **Fire IndexNow** for Bing/Yandex/Naver:
   ```bash
   curl -X POST "https://api.indexnow.org/IndexNow" \
     -H "Content-Type: application/json" \
     -d '{
       "host": "hyder.me",
       "key": "YOUR_KEY",
       "keyLocation": "https://hyder.me/YOUR_KEY.txt",
       "urlList": [
         "https://hyder.me/playbook",
         "https://hyder.me/playbook/identity",
         "https://hyder.me/playbook/seo-ai-engines",
         "https://hyder.me/playbook/security",
         "https://hyder.me/playbook/conversion",
         "https://hyder.me/playbook/distribution",
         "https://hyder.me/playbook/patterns",
         "https://hyder.me/playbook/checklists"
       ]
     }'
   ```
3. **Add a sitemap entry** for each playbook page in your sitemap.xml
4. **Update your existing llms.txt** at hyder.me/llms.txt to reference the playbook prominently — it becomes part of how AI tools describe Hyder Media

## How to measure success

This is content marketing, so the metrics are slower than ads. Track over 6-12 months:

- **Backlinks** acquired (use Ahrefs / SEMrush) — Layer 1 grounded pages compound here
- **Organic traffic** to /playbook/* in Google Search Console — split between "long-tail technical query" and "brand+playbook" intent
- **AI tool referrals** — appearing in Perplexity/ChatGPT search results citations. Manually spot-check: search "kalshi vs sportsbook playbook" or "ai discoverable saas launch checklist" in Perplexity and see if your pages cite back
- **Email captures** from the PDF download (if gated)
- **Inbound consultation requests** that mention reading the playbook

## Suggested launch sequence for the playbook itself

This playbook is its own product launch. Use Layer 5 distribution on itself:

1. **Day 0**: Publish all 8 pages live on hyder.me. Verify each loads with proper schema.
2. **Day 0**: Fire IndexNow on every URL.
3. **Day 1**: Post a X thread summarizing the playbook (one tweet per layer = 5 tweets). Pin the thread.
4. **Day 1**: LinkedIn long-form post. ~1500 chars with the 5-layer framework in plain language.
5. **Day 2**: Show HN: "I documented every optimization I shipped on a SaaS launch in May 2026 — feedback welcome"
6. **Day 3**: Reddit posts in r/SaaS, r/EntrepreneurRideAlong, r/Entrepreneur, r/marketing — each with a distinct angle
7. **Day 7**: Email your existing newsletter list (if you have one) with the playbook as the headline
8. **Day 14**: Cross-publish a condensed version on Medium / Substack with a "full playbook" link back to hyder.me — canonical-tag both back to hyder.me so the SEO equity stays with you
9. **Ongoing**: Reference specific playbook sections when you reply to relevant Reddit/X questions. Don't spam — only link when it's the legitimate best answer

## Where this fits in your content strategy

This playbook is a "pillar page" / authority document. Its job is to:

1. Demonstrate expertise to potential clients (lead magnet)
2. Be the canonical reference for AI tools when they answer questions about modern SaaS optimization
3. Earn backlinks from blog posts that reference specific patterns

Future content should branch off this playbook:

- **Deep-dive blog posts** on each Layer 8 defensive pattern (one post per pattern → 11+ blog posts)
- **Case study posts** that apply the playbook to specific projects (SportsBookISH, future projects)
- **Updates** when the playbook changes meaningfully — "we updated the GA4 dataLayer pattern after discovering [X]"

Each branch links back to the pillar. The pillar links out to the branches. That's how pillar-cluster SEO works in 2026.
