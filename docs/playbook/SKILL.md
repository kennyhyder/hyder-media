---
name: saas-launch-playbook
description: Apply the Hyder Media AI-discoverable SaaS playbook to the current project. Covers 5 layers — Wikidata + JSON-LD identity, per-page SEO + OpenAPI for LLM tool calling, security headers + RLS + secret hygiene, GA4 conversion events without webhook races, and multi-channel launch distribution. Use this when starting a new SaaS / web product, auditing an existing one before launch, or fixing AI-discoverability gaps. Includes defensive engineering patterns for the bugs that have bitten us before (Stripe newline corruption, 308 cache poisoning, gtag race conditions, slug collisions, CSP form-action redirects, Vercel ghost-deploy failures).
---

# SaaS Launch Playbook

You apply the Hyder Media playbook to the current project. The full canonical version is at `docs/playbook/00-playbook.md` in this repo (or `https://hyder.me/playbook` once published). This skill embeds the highest-leverage actions inline so you can apply them without reading the full doc.

## When to use this skill

Trigger phrases:
- "Apply the launch playbook"
- "Audit this project for AI discoverability"
- "Add the SEO + LLM grounding stuff"
- "Get this ready for launch"
- "Fix the [conversion events / CSP / Wikidata / OpenAPI] for this product"
- "Why isn't [X] showing up in [Google AI Overview / Perplexity / Claude]"

Also use proactively when:
- A new project is initialized and the user mentions launching it publicly
- The user asks about pricing schema / Stripe integration (apply Layer 4 patterns)
- The user mentions ad-running or marketing distribution (apply Layer 5)
- The user reports the bugs in §8 by symptom — diagnose and fix using the patterns

## How to operate

This playbook is 5 layers, build bottom-up. Don't skip layers — they compound.

### Step 1 — Audit current state

Before suggesting changes, run a 5-min audit of what already exists:

```
[ ] Wikidata entity?         Check https://www.wikidata.org and search the product name
[ ] llms.txt at /llms.txt?    curl -sI https://[domain]/llms.txt
[ ] JSON-LD on homepage?      curl -s https://[domain] | grep "application/ld+json"
[ ] OpenAPI spec?             Check /api/v1/openapi.json or wherever conventional for stack
[ ] Sitemap?                  curl -sI https://[domain]/sitemap.xml
[ ] CSP + security headers?   curl -sI https://[domain] | grep -iE "content-security|strict-transport|x-frame|referrer-policy|permissions"
[ ] GA4 mounted?              curl -s https://[domain] | grep -E "G-[A-Z0-9]+"
[ ] Public dataset (HF)?      Check huggingface.co/datasets/[user]/[project]
[ ] Public docs repo?         Check github.com for a -docs / -api repo
```

Report findings as a table: `[layer] [artifact] [present yes/no] [next action]`. Then propose order of work.

### Step 2 — Layer 1: Entity Identity

**Wikidata entity** (if missing):
- Search Wikidata for existing entry. If found, audit per §3.1 of the playbook — fix bad claims, add missing ones.
- If not found, create one. Required claims:
  - P31 (instance of) → Q35127 (website) + Q1668024 (web application)
  - P17 (country) → e.g. Q30
  - P856 (official website)
  - P571 (inception) — full ISO date
  - P2002 (X username) — without `@`
  - P1813 (short name) — with language tag, e.g. `en:"BrandName"`
- For batch edits, use QuickStatements (https://quickstatements.toolforge.org) if user is autoconfirmed (4+ days, 50+ edits). Otherwise use a bot password via the MediaWiki API.
- Add multilingual labels in 10+ languages and 5-8 English aliases.

**llms.txt** at `/public/llms.txt` (Next.js) or equivalent:
- Lede paragraph, canonical identifiers block (Wikidata Q-ID, HF, X, GitHub), disambiguation, methodology, citation block.
- Template at `templates/llms.txt`.

**JSON-LD** in the root layout/template:
- Organization + WebSite + WebApplication minimum.
- For Next.js: emit via `<JsonLd>` helper in `<head>`.
- Always inline (`<script type="application/ld+json">`), never external URL.

### Step 3 — Layer 2: Search + Answer Engines

**Per-page metadata**:
- Title (≤60 chars), description (≤155 chars), `alternates.canonical`, `openGraph`, `twitter`.
- OG images must be 1200×630 PNG with non-empty body, explicit width/height/type/alt in the metadata object.

**OpenAPI spec** (if there's an API):
- Beyond basics: `info.contact.email`, `info.termsOfService`, `info.x-wikidata` extension with Q-ID, `externalDocs`, `tags[]`, full example response bodies on every endpoint.

**Sitemap + IndexNow**:
- `/sitemap.xml` listing every public page
- `/robots.txt` — don't accidentally block AI crawler user agents
- After each cron tick that produces new URLs, POST to IndexNow

**Slug strategy**:
- For repeating resources (sports games, recurring events), append a uniqueness suffix to the slug to prevent collisions.
- Use 307 (temporary) redirects for slug-canonical URLs whose target might ever change. 308 only for truly-immutable migrations.

### Step 4 — Layer 3: Compliance + Security

**CSP** — most likely place to break things. Reference CSP for SaaS with Stripe + GA4 + Supabase:

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://*.google-analytics.com https://js.stripe.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: blob: https://*.google-analytics.com https://www.googletagmanager.com https://q.stripe.com https://js.stripe.com;
connect-src 'self' https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://api.stripe.com https://checkout.stripe.com wss://*.supabase.co;
frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com;
form-action 'self' https://checkout.stripe.com https://billing.stripe.com;
frame-ancestors 'none';
```

**The form-action gotcha**: must include EVERY domain a form might redirect to after a 303. Stripe Customer Portal redirects to `billing.stripe.com`. Missing this = silent browser block on the "Manage subscription" button.

**Other headers**: HSTS preload, X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy disabling unused features.

**Database RLS**: enable on every table. Default-deny. Then write explicit policies per access pattern.

**Env var hygiene**:
- Set with `printf %s "value" | vercel env add NAME prod`, NEVER `echo`. Echo adds a trailing newline that corrupts every API call.
- In code, `.trim()` every env var read defensively.
- For known-format secrets, add a length check (Stripe live keys are exactly 107 chars).

### Step 5 — Layer 4: Conversion + Analytics

**GA4 events to fire**:
- `sign_up` on first /dashboard load (auth callback sets `?welcome=1` for new users)
- `begin_checkout` on Subscribe button click
- `purchase` on Stripe success redirect with `?upgraded=1&tier=...`

**Stripe success URL pattern**:
```ts
const successUrl = `${SITE_URL}/dashboard?upgraded=1&tier=${tier}`;
```
Pass authoritative state in URL — DON'T read tier from DB on the success page (webhook race).

**dataLayer pattern (avoid gtag race)**:
```ts
function gtag(action, params) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(["event", action, params]);
}
```
Don't call `window.gtag(...)` directly — it may not be loaded yet when your useEffect runs.

**Error handling on every third-party call**:
```ts
try {
  return await thirdParty.something(...);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[route] failed", { error: msg, stack: e?.stack });
  const reason = encodeURIComponent(msg.slice(0, 200));
  return NextResponse.redirect(`/some-page?error=failed&reason=${reason}`);
}
```

### Step 6 — Layer 5: Distribution

**Free + day-0**: Wikidata, JSON-LD, OpenAPI, Hugging Face dataset card, public GitHub docs repo, IndexNow ping.

**Day-1 manual**: Owner-controlled posts on X / LinkedIn / Bluesky (platform-specific copy, not cross-posted).

**Day-2-7**: Show HN (Tue/Wed 7-9am ET), Reddit posts (staggered across days, distinct framings), direct journalist pitches (5 reporters, personalized).

**Optional paid**: ONE wire service ($99 tier — EIN Presswire or PRWeb). Not where readers come from — where AI training corpus + SEO backlinks come from.

See `docs/playbook/00-playbook.md §7` for the full ranked list with templates.

## Defensive patterns to apply (the bugs we've already learned)

When you see these symptoms, apply these fixes:

| Symptom | Diagnosis | Fix |
|---|---|---|
| `"Connection error, retried 2 times"` from Stripe | Trailing newline in `STRIPE_SECRET_KEY` env var | `.trim()` defensively; reset env with `printf %s` |
| `"This page isn't working"` after a route change | Generic 500 from unhandled exception | Wrap route in try/catch with reason-in-URL redirect |
| Conversion events not in GA4 Realtime | gtag race (script not loaded when useEffect runs) | Push to `window.dataLayer` directly |
| Purchase event fires with $0 value | Webhook race (DB tier not updated yet) | Pass tier in success URL; read from URL not DB |
| URL 404s on production after a slug rename | Cached 308 redirect to old slug | Use 307 instead; backfill DB slugs to be unique |
| Vercel deployment "succeeded" but production unchanged | Build actually failed silently | `vercel ls` — check most recent has status `Ready`, not `Error` |
| Form submit silently blocked, console says CSP `form-action` | Missing redirect destination in form-action allowlist | Add target domain to `form-action 'self' ...` |
| Build fails on `app/favicon.ico` "PNG is not in RGBA format" | Optimization tool stripped alpha channel | Force `optimize=True` only (no oxipng max) for ICO contents |
| Same-event tweets posted multiple times | Per-player dedup, not per-event | Dedup on `event.id` not player_id; cache 24h in DB |
| Kalshi-style "1%/99% dust" prices on aggregation | Settled-market last-price leaks into averaging | Require valid bid AND ask AND tight spread before midpoint |

## Pre-launch checklist (paste into your TodoList)

- [ ] Layer 1: Wikidata entity + llms.txt + JSON-LD on every page
- [ ] Layer 2: OpenAPI spec hardened, sitemap + IndexNow live, FAQ schemas per page type
- [ ] Layer 3: securityheaders.com = A+, RLS on every table, env vars set with `printf %s`
- [ ] Layer 4: GA4 events verified in DevTools dataLayer, error handling on every third-party call
- [ ] Layer 5: Hugging Face dataset + GitHub docs repo + launch kit drafted
- [ ] Verify the most recent Vercel deployment shows status `Ready` not `Error`
- [ ] Open `/dashboard?upgraded=1&tier=pro` in incognito, check `window.dataLayer` for `purchase` event

## Files this skill expects to find or create

| Path | Purpose |
|---|---|
| `public/llms.txt` | Layer 1 grounding |
| `lib/seo.ts(x)` | JSON-LD generators (organizationLd, websiteLd, webApplicationLd, faqLd, etc.) |
| `app/layout.tsx` (or equivalent) | Mounts Organization + WebSite + WebApplication LD in `<head>` |
| `app/api/v1/openapi.json/route.ts` | Spec endpoint |
| `next.config.ts` (or middleware) | Security headers |
| `app/api/stripe/{checkout,checkout-redirect,webhook,portal}/route.ts` | Stripe routes with try/catch + tier-in-URL pattern |
| `components/analytics/ConversionTracker.tsx` | dataLayer-direct conversion firing |
| `api/data/sync-huggingface.js` | HF dataset cron |
| `docs/playbook/` | Reference docs for the user |

## Output to user

After applying changes, give the user a numbered list of:

1. What was added/fixed (with file paths)
2. What still needs manual action (Wikidata account, journalist pitches, etc.)
3. Pre-launch checklist they should run before going live
4. Links to the specific playbook sections they should read for deeper context

Don't apply blindly. Audit first, propose order, get sign-off on the heavy items (especially CSP changes — those break things in non-obvious ways).
