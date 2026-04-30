# Vita Brevis Fine Art — SEO & Local Visibility Audit

**Audit date:** 2026-04-30
**Auditor:** Hyder Media
**Goal:** Diagnose why `vitabrevisfineart.com` doesn't rank on page 1 for "colorado springs photography studio" and isn't appearing in the Google Map Pack. Deliver a prioritized action list.

---

## TL;DR — three findings drive everything

1. **The homepage has no `<h1>` tag and no body content targeting "photography" / "photographer" / "studio."** Google can't rank a page for words it doesn't see. The visible homepage word count is ~420; the words "photography," "photographer," and "studio" appear *zero times* in the visible body copy outside the address footer.
2. **The site has 1,673+ Google reviews on the GBP** but the Map Pack still doesn't show Vita Brevis for generic local searches. The blockers are: (a) the GBP primary category is likely "Session Photography" or "Photographer" but the *website* gives Google nothing to confirm that; (b) `LocalBusiness` JSON-LD is broken — empty `openingHours`, no `telephone`, no `geo`, no `url`. Google deprioritizes Map results when the website data conflicts with or doesn't reinforce the GBP.
3. **`AggregateRating` schema is missing.** With 1,673 Google reviews this should be the easiest star-rating snippet on the planet. Currently zero stars show in organic results.

Fixing those three things should unlock the bulk of the lift. Everything below details the rest.

---

## 1. On-page SEO — what's broken

### Homepage `vitabrevisfineart.com`

| Element | Current | Issue |
|---|---|---|
| `<title>` | `Vita Brevis Fine Art` (22 chars) | Brand-only. No keyword, no location. Should be ~55-60 chars including target keyword + city. |
| Meta description | `A Professional Family & Children Portrait Art Studio in Colorado Springs. We strive to preserve precious moments…` | Decent — keep but tighten. |
| `<h1>` | **None on the page** | Critical. Google reads H1 as the strongest on-page topic signal. "Heirloom Portraiture for your Heart and Home" is visually large but not wrapped in `<h1>`. |
| "Colorado Springs" in visible body | Footer NAP only | Should appear in H1 or first paragraph. |
| "photography" / "photographer" / "studio" in visible body | **Zero occurrences** | The main service words are literally not on the homepage. |
| Visible word count | ~420 | Thin. Aim for 600-1000 on the homepage with substantive content. |

**Recommended title:** `Colorado Springs Portrait Photography Studio | Vita Brevis Fine Art` (62 chars)
**Recommended H1:** `Heirloom Portrait Photography in Colorado Springs` — wrap the existing text but in an actual `<h1>` element.

### Other pages with no H1

- `/contact` — H1 missing
- `/about-vita-brevis-fine-art` — H1 missing AND meta description is **empty**
- `/rave-reviews` — H1 missing
- `/location` — H1 is just the word "LOCATION" (single word, all caps)

**Action:** Every page needs an H1. In Squarespace, use the Heading 1 style on the top heading of each page.

### Schema (JSON-LD) issues

The homepage has 4 schema blocks. Three have problems:

- **`LocalBusiness`** — `openingHours` is empty (`", , , , , , "`), and missing: `telephone`, `priceRange`, `geo` coordinates, `url`, `image`, `@id`. Should also include `areaServed`.
- **`Review`** — 25 individual reviews are emitted, but **no `AggregateRating` wrapper.** With 1,673 Google reviews available, this is the single easiest win.
- **No `Photographer` type** — Google understands the more-specific `Photograph` and `Photographer` types within schema.org. Better to use `LocalBusiness` *combined with* a more specific subtype.

**Action:** Replace the broken schema with a clean LocalBusiness block. Sample at the end of this doc.

### URL structure & site architecture

- Sitemap has 48 URLs. Only **2** include "colorado-springs" in the slug (`/tiaras-and-tuxedos-colorado-springs`, `/colorado-springs-christmas-fairy`).
- All service pages use **internal brand names** instead of search terms: "Black Label Family", "Magical Fairy Garden", "Tiaras & Tuxedos", "Premier Pets", "The Unicorn Experience", "Moksha". These are zero-search-volume names. Nobody is typing "moksha photography colorado" into Google.
- **No pages target high-volume queries** like:
  - "family photographer colorado springs"
  - "children portrait studio colorado springs"
  - "pet portrait photographer colorado springs"
  - "professional headshots colorado springs"
- Two duplicate review pages (`/rave-reviews` and `/reviews`) — duplicate content risk. Pick one and 301-redirect the other.

**Action:** Add 4-6 new SEO landing pages with city + service in the slug. Don't replace the brand pages — keep them and add these on top:
- `/family-portrait-photographer-colorado-springs`
- `/children-photography-studio-colorado-springs`
- `/pet-portrait-photographer-colorado-springs`
- `/professional-portrait-studio-colorado-springs`

Each needs a unique 600-1000 word page with H1, intro paragraph, FAQ, internal links to portfolio.

### Stale blog content

Newest blog post is from **February 2022.** Blog has been silent for 4+ years. Google reads "abandoned" when a content section stops updating. Either revive (1-2 posts/month) or quietly remove from nav.

---

## 2. Map Pack & GBP — why you're not in the 3-pack

You have a Google Business Profile with **1,673+ Google reviews.** This is excellent ranking ammunition. The fact that you're still not in the Map Pack for generic queries means the *signals* aren't lining up. Here's the diagnosis:

### Signals Google looks at for Map Pack ranking
1. **Primary category match** — Most decisive. Must be exactly "Photographer" or "Portrait Studio."
2. **Proximity** — Google preferences businesses physically closest to the searcher's location.
3. **NAP consistency** — Name, Address, Phone consistent across web (citations).
4. **Review count and recency** — You crush this.
5. **Website signals** — Does the website's LocalBusiness schema, address, and content reinforce what GBP says? Right now: **no.**

### What to check & fix in your GBP (login to business.google.com)

| Item | Action |
|---|---|
| **Primary category** | Set to exactly `Photographer` or `Portrait Studio`. *Not* "Session Photography" (Yelp's category) or "Wedding Photographer." |
| **Secondary categories** | Add: `Children's Photography Studio`, `Pet Photographer`, `Family Photographer`, `Photography Service`. Up to 9 secondaries allowed. |
| **Service area** | Add Colorado Springs, Manitou Springs, Monument, Black Forest, Falcon, Fountain, Security-Widefield. |
| **Services list** | Add every service with descriptions: Family Portraits, Children Portraits, Pet Portraits, Professional Headshots, Newborn Photography, Maternity, Senior Portraits, Black Label Sessions, Fairy Garden Sessions. |
| **Products** | Add framed prints, wall art, albums with prices/ranges. Posts in the Products section drive visibility. |
| **Photos** | Upload 30+ high-quality recent photos tagged with locations. Add an interior shot of the studio + exterior. Update at least 5 photos per month. |
| **Posts** | Publish a new GBP Post every week (offers, new sessions, behind-the-scenes). 0 in last 30 days hurts. |
| **Q&A** | Pre-seed 10-15 FAQs. Answer them yourself. |
| **Hours** | Confirm hours match website. Currently website schema is empty, contact page shows Mon-Fri 9-5:30 office, by-appt 9-4:30 studio. Make GBP match the studio hours. |
| **Review responses** | Respond to *every* review (positive & negative). Aim for 90%+ response rate. |

### NAP inconsistency — fix it everywhere

Address is rendered three different ways across your own site:
- Schema: `525 East Fountain Boulevard Ste 110`
- Footer: `525 E. Fountain Blvd #110`
- Contact: `525 E. Fountain Blvd, #110`

Pick **one** canonical format and use it everywhere. Recommended:
> **Vita Brevis Fine Art**
> 525 E. Fountain Blvd #110
> Colorado Springs, CO 80903
> (719) 301-1035

Then audit + fix on: GBP, Yelp (currently 3.8★ / 129 reviews — under-leveraged), BBB, Facebook, Instagram bio, all citations.

### Two phone numbers issue

Studio: `719-301-1035`. Booking: `719-301-2535`. Schema only has the studio line. **Pick one as the primary** for citations and GBP. Use the other internally only. Multiple numbers across citations confuses Google.

### Lookalike/spam domains

These exist (uncovered during audit):
- `vita-brevis-fine-art.com`
- `vitabrevisfineart.co`
- `vitabrevisfineart.net`
- `aboutvitabrevisfineart.com`

These could be impostors, old test sites, or competitor reputation tactics. **Action:** Check each one. If yours: 301-redirect to canonical. If not yours: file abuse reports / consider trademarking.

---

## 3. Technical issues

| Item | Status | Action |
|---|---|---|
| `robots.txt` | OK — references sitemap, doesn't block Googlebot | Keep |
| `sitemap.xml` | OK — 48 URLs | Keep, but resubmit after adding new SEO pages |
| Mobile-friendly | Need to verify with PageSpeed Insights | Run https://pagespeed.web.dev/analysis?url=https://www.vitabrevisfineart.com |
| HTTPS | OK | Keep |
| Squarespace AI-bot blocking | Blocks 27 AI crawlers (GPTBot, ClaudeBot, etc.) | Reasonable choice. No SEO impact. |
| Canonical tags | Need verification | Check that each page has a self-referencing canonical |

---

## 4. Prioritized punch-list

### This week (high impact, low effort)

1. **Add an H1 to every page.** Squarespace: edit each page → click on the top heading → set style to "Heading 1." Specifically: homepage, contact, about, rave-reviews. ~30 minutes.
2. **Fix the homepage `<title>`** to `Colorado Springs Portrait Photography Studio | Vita Brevis Fine Art`. Squarespace: Pages → Home → SEO → Page Title.
3. **Set GBP primary category to `Photographer`** and add 5+ secondary categories. ~5 minutes.
4. **Add 10 fresh GBP photos** + start posting weekly. ~30 minutes.
5. **Pick canonical address format** and update footer/contact/about to match exactly. ~15 minutes.
6. **Fix the broken `LocalBusiness` schema** — see the JSON-LD block at the bottom of this doc. Squarespace: Settings → Advanced → Code Injection → Header. ~10 minutes.

### Next 2-4 weeks (high impact, more effort)

7. **Add `AggregateRating` schema** showing 1,673+ Google reviews + 4.x average rating. This will make stars appear under your organic SERP listing. ~30 minutes (schema below).
8. **Create 4 new SEO landing pages** for:
   - `/family-portrait-photographer-colorado-springs`
   - `/children-photography-studio-colorado-springs`
   - `/pet-portrait-photographer-colorado-springs`
   - `/professional-portrait-studio-colorado-springs`

   Each: 600-1000 words, H1, 4-6 H2s, embedded portfolio images, internal links to the booking page. ~6-8 hours of work for the four.
9. **Resolve the 4 lookalike domains.** ~1 hour to investigate.
10. **NAP audit & cleanup** across Yelp, BBB, Facebook, Instagram bio, all directories. ~2 hours.

### Ongoing

11. **Publish 1 GBP Post per week.** Behind-the-scenes, offers, recent sessions, holiday promos. 10 min/week.
12. **Respond to every new Google review within 48 hours.** Even just "Thank you, [Name]!" — but better with personalization. 5 min per review.
13. **Add 1-2 blog posts per month.** Topics: "What to wear for your Colorado Springs family portrait session", "How to prepare your dog for a portrait shoot", etc.
14. **Re-check rankings monthly.** The Search Console tab on the dashboard shows position trends. Watch "colorado springs photography studio" and related queries.

---

## 5. Drop-in fixes

### Fixed `LocalBusiness` JSON-LD

Replace the existing broken schema. In Squarespace: **Settings → Advanced → Code Injection → Header.** Paste this (update URLs/photos as needed):

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "PhotographyBusiness"],
  "@id": "https://www.vitabrevisfineart.com/#localbusiness",
  "name": "Vita Brevis Fine Art",
  "alternateName": "Vita Brevis Fine Art Studio",
  "url": "https://www.vitabrevisfineart.com/",
  "logo": "https://www.vitabrevisfineart.com/path-to-logo.png",
  "image": [
    "https://www.vitabrevisfineart.com/path-to-hero-1.jpg",
    "https://www.vitabrevisfineart.com/path-to-hero-2.jpg",
    "https://www.vitabrevisfineart.com/path-to-hero-3.jpg"
  ],
  "description": "Heirloom portrait photography studio in Colorado Springs specializing in family, children, and pet portraits. Serving the Pikes Peak region for 15+ years.",
  "telephone": "+1-719-301-1035",
  "email": "hello@vitabrevisfineart.com",
  "priceRange": "$$$",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "525 E. Fountain Blvd #110",
    "addressLocality": "Colorado Springs",
    "addressRegion": "CO",
    "postalCode": "80903",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 38.8290,
    "longitude": -104.8147
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "opens": "09:00",
      "closes": "17:30"
    }
  ],
  "areaServed": [
    { "@type": "City", "name": "Colorado Springs" },
    { "@type": "City", "name": "Manitou Springs" },
    { "@type": "City", "name": "Monument" },
    { "@type": "City", "name": "Black Forest" },
    { "@type": "City", "name": "Falcon" },
    { "@type": "City", "name": "Fountain" }
  ],
  "sameAs": [
    "https://www.facebook.com/VitaBrevisFineArt",
    "https://www.instagram.com/vitabrevisfineart",
    "https://www.tiktok.com/@vitabrevisfineart",
    "https://www.pinterest.com/vitabrevisfineart",
    "https://www.youtube.com/@vitabrevisfineart"
  ],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.9",
    "reviewCount": "1673",
    "bestRating": "5",
    "worstRating": "1"
  }
}
</script>
```

**Important:**
- Verify the lat/long (38.8290, -104.8147) is correct for the studio. Use https://www.latlong.net to look up the exact value for `525 E. Fountain Blvd, Colorado Springs, CO 80903`.
- Confirm the `aggregateRating.ratingValue` matches the actual current GBP rating (Birdeye reported 1673 reviews — check the live GBP rating value).
- Replace `path-to-logo.png` etc. with real image paths from your Squarespace media library.

After deploying, validate at https://search.google.com/test/rich-results — you should see "LocalBusiness" recognized with no errors and an "AggregateRating" preview showing stars.

---

## 6. What the Search Console dashboard tab will show you

Once you re-authorize the Google connection (one click at `/api/google-ads/auth`), the new **Search Console** tab on the reporting dashboard will display:

- **Total clicks, impressions, CTR, avg position** for the last 7/30/90 days
- **Top queries** — the actual search terms triggering your site, sortable by clicks, impressions, CTR, position
- **Top pages** — which pages get organic traffic, sortable
- **Trend chart** — clicks + impressions over time
- **Device breakdown** — mobile vs desktop vs tablet
- **Sitemap status** — submitted vs indexed counts, last fetch time, errors

Use it to track whether the changes above actually move the needle. Specifically watch:
- Average position for "colorado springs photography studio" type queries (should drop from ~30 → page 1)
- Indexed page count after the new SEO pages go up (should grow from ~42 to ~46+)
- CTR per query — if you're getting impressions but no clicks, the title/description needs work

---

*Generated with data from a live audit of the homepage, contact page, location page, about page, rave-reviews page, robots.txt, sitemap.xml, and public SERP signals on 2026-04-30.*
