# The Playbook Product (May 2026 launch)

Vendor-agnostic SaaS launch playbook, productized after building SportsBookISH. Designed so it can be applied to ANY future client/project here. (Moved from root CLAUDE.md 2026-07.)

## Three-tier model
1. **Free intro PDF (5pg)** — lead magnet. Email signup → drip series.
2. **$79 full bundle** — PDF + templates + Claude Code skill. Bundle ready as `downloads/playbook-bundle-v1.zip`. Awaiting Lemon Squeezy product creation.
3. **$2.5k-$5k DFY engagement** — Kenny implements the playbook for a client.

## Live assets
- **Landing page**: `https://hyder.me/playbook` (`playbook.html` in root). Full Bootstrap theme matching hyder.me, JSON-LD schemas (Product, FAQPage, BreadcrumbList), GA4 conversion events.
- **Free intro endpoint**: `POST /api/playbook-intro` — captures email, sends intro PDF via Gmail SMTP. Defensive `.trim()` on env reads (dogfoods §5.4 of the playbook itself).
- **Email drip series**: 5 emails in `docs/playbook/emails/` (intro → product → DFY pitch).
- **Bundle**: `downloads/playbook-bundle-v1.zip` — PDF + Notion templates + `.claude/agents/playbook.md` skill file.

## Pending manual work
- Lemon Squeezy product setup (2 placeholder URLs in `playbook.html` to replace once live)
- Verify drip series sender domain DNS

## Playbook topics covered (chapters)
1. Tier definition + Stripe products + webhooks
2. Supabase Auth (magic-link), tier guards, RLS
3. Cron-driven ingestion pipelines (Vercel)
4. SEO + freshness + AI discoverability stack
5. **Compliance baseline** (W3C, security headers, WAVE, robots, sitemap, OG, JSON-LD)
6. Conversion event tracking (GA4 dataLayer pattern)
7. Stripe Customer Portal + cancellation flows
8. Health-check cron + Resend alerts
9. Vercel deploy gotchas (ESM→CJS, env var trim, region pinning)
10. Cross-platform reporting (Google + Meta + others)
11. Wikidata + Hugging Face + IndexNow for AI discoverability

## When applying to a new project
- Start from `docs/playbook/templates/` (Stripe setup script, schema.sql skeleton, tier-guard.ts, LastUpdated component, cron-health-check.js, NoBooksDataNote-style upsell pattern)
- Compliance baseline: lives in `automatedojo/lib/compliance.ts` — apply to platform-deployed sites
- Stripe products: idempotent `scripts/setup-stripe-products.mjs` pattern works for ANY new SaaS

See memory: [[playbook-product]] for distribution status, [[sportsbookish]] for the source-of-truth implementation, [[sportsbookish-futures-data-vendor]] for the "Request data →" Elite upsell pattern.
