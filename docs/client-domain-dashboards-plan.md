# Client-Domain Dashboards — Rollout Plan

**Goal:** Deploy Hyder Media client dashboards (competitive-intel suites + reporting
dashboards) on **client-owned domains** (e.g., `intel.falconlabs.com`,
`reporting.digistore24.com`) as a white-label, "Powered by Hyder Media" product —
with the client-domain deployment priced into the initial setup fee.

**Status:** Plan drafted 2026-06-11. Idea originated during Falcon Labs suite build.
**Pilot candidate:** Falcon Labs (suite already styled 100% in their brand — it IS the demo).

---

## 1. Why this works commercially

The Falcon Labs suite proved the unit economics of the build: a fully client-branded,
data-backed intel suite can be produced in under a day on the established template
(DG24 → PageWheel → Falcon Labs pattern). Today that asset lives on `hyder.me/clients/*`
— Hyder Media's domain, Hyder Media's URL in the client's browser bar.

Moving it to the **client's own domain** changes the perceived ownership:
- The dashboard becomes *their* internal tool (bookmarked, shared internally,
  shown to their executives) instead of a vendor link.
- "Powered by Hyder Media" footer/badge on a tool living at `intel.client.com`
  is persistent, high-trust branding in front of every stakeholder they share it with.
- Stickiness: a tool on their domain with their SSO/password feels like infrastructure,
  not a deliverable. Infrastructure doesn't get churned.
- It justifies a real setup-fee line item ("white-label deployment on your domain")
  with near-zero marginal cost.

## 2. Technical architecture (recommendation: Vercel host-based rewrites)

### Recommended: same Vercel project, host-routed (Phase 1 — ship in a day)

The hyder-media Vercel project already serves every dashboard as static files.
Vercel supports multiple custom domains per project + host-conditional rewrites:

1. Client adds one DNS record: `CNAME intel.falconlabs.com → cname.vercel-dns.com`
2. Kenny adds `intel.falconlabs.com` as a domain on the `hyder-media` Vercel project
   (dashboard or `vercel domains add` — SSL auto-provisions)
3. `vercel.json` rewrite maps the host to the client folder:

```json
{
  "rewrites": [
    {
      "source": "/:path*",
      "has": [{ "type": "host", "value": "intel.falconlabs.com" }],
      "destination": "/clients/falconlabs/:path*"
    }
  ]
}
```

4. Relative asset paths inside the suite already work (each suite is self-contained
   in its folder; the falconlabs suite uses local `assets/` — the older suites
   reference `../../assets/` which must be localized before white-labeling them).

**Why not the AutomateDojo Cloudflare Worker for this?** The worker
(`automatedojo/workers/automatedojo-domain-proxy/`) exists to solve a harder
problem — *migrating a client's existing live domain* with mirror/rollback states
and NS delegation. Client dashboards are **net-new subdomains**: no existing
traffic, no migration risk, no NS handover. One CNAME is the whole job.
The worker becomes relevant only at Phase 3 scale (dozens of client domains,
per-domain edge logic like geo-routing or auth at the edge).

### What we DO pull from AutomateDojo

| AutomateDojo tech | Reuse in this product |
|---|---|
| `lib/compliance-gate.ts` (`enforceCompliance`) | Pre-deploy gate for every client-domain dashboard: W3C 0 errors, WAVE ≤2 alerts, full security headers, SEO/OG/JSON-LD. The "no staff override" standard applies — client-domain pages represent the client's brand on their own domain; compliance failures are unacceptable there. |
| `app/api/client/[slug]/domain/route.ts` patterns | Domain probe + verification UX (check CNAME propagation, SSL status) for the onboarding checklist. Simplify: CNAME-check only, no zone creation. |
| SKU model (`9dm_skus`: `setup_fee_usd` + `recurring_amount_usd` + Stripe price IDs) | The pricing/billing shape for the dashboard SKU if/when this is sold via checkout instead of invoice. |
| Agency branding pattern (`lib/agency/branding`) | Per-client theming convention: brand tokens (accent, bg, font, logo) as a config block — exactly what the falconlabs reskin did by hand. Codify as a `brand.json` per client folder so future suites generate pre-themed. |
| Compliance/tenant-isolation audit habit | Client-domain pages must never leak cross-client data. Static suites are inherently isolated (per-folder), but reporting dashboards calling `/api/<client>/*` need a CORS allowlist per client domain (today every endpoint is `Access-Control-Allow-Origin: *` — acceptable for read-only public-ish stats, revisit per client sensitivity). |

### Auth on the client domain

sessionStorage password gates work unchanged on any domain (they're per-page JS).
For clients wanting real auth (the AG2020 pattern), Supabase Auth works on custom
domains — add the client domain to the Supabase project's redirect allowlist and
pass `data: { product: '<client>' }` per the shared-project trigger convention.
Password-gate is the Phase 1 default; Supabase email auth is a Phase 2 upsell.

## 3. Phased rollout

**Phase 1 — Falcon Labs pilot (1–2 days of work, do it as part of closing the deal)**
- [ ] Localize any shared-asset references in the falconlabs suite (already self-contained ✓)
- [ ] Add `intel.falconlabs.com` (or their preferred subdomain) to Vercel project
- [ ] Add host rewrite to `vercel.json`
- [ ] Run every page through `enforceCompliance` (port the gate to a small script
      that fetches each live URL and reports) — fix anything flagged
- [ ] "Powered by Hyder Media" footer linking to hyder.me (already present as
      "Prepared by Hyder Media" — upgrade to a small logo badge)
- [ ] Canary: add the new host's URLs to `cron-route-canary` critical-URL list

**Phase 2 — Productize (1 week, after 2nd client signs)**
- [ ] `brand.json` convention per client folder (colors, font, logo paths) so new
      suites generate pre-themed
- [ ] Domain-status checker page in each suite's admin (CNAME + SSL probe,
      borrowed from AutomateDojo's domain route)
- [ ] Per-client CORS allowlist on reporting API endpoints
- [ ] Supabase Auth option (magic link) for clients who want named-user access
- [ ] Template-ize: `scripts/new-client-suite.js <slug> <domain>` scaffolds folder,
      brand.json, password gate, nav

**Phase 3 — Scale decisions (only if 10+ client domains)**
- Host-rewrite list in vercel.json gets unwieldy → move to Next.js middleware
  host-routing or the Cloudflare Worker + KV pattern from AutomateDojo
- Edge auth, per-domain analytics, client self-serve theming

## 4. Pricing (informed by the Digistore24 contract structure)

Digistore24 contract shape: tiered % of ad spend (8% ≤ $100K / 6% next $150K /
4% above $250K), $5,000/mo minimum. The dashboard suite is part of what justifies
the retainer — but the **white-label domain deployment is a discrete, optional
line item** that belongs in the setup fee.

AutomateDojo's setup-fee ratios run ~3–3.5× monthly price (Website Only:
$348 setup / $98mo; Full Bundle: $1,743 setup / $1,173/mo). Applying the same logic:

| Line item | Price | Notes |
|---|---|---|
| Competitive-intel suite (on hyder.me/clients) | Included in engagement setup fee | Already the established pattern — it's the pre-sales artifact |
| **White-label deployment on client domain** | **+$2,500 one-time** | Covers domain wiring, brand-token theming, compliance gate pass, canary monitoring. Near-zero marginal cost after Phase 2 tooling → strong margin |
| White-label maintenance/hosting | +$250/mo (or absorbed into retainer ≥$5K/mo) | Hosting, SSL, canary, data refreshes; waive to sweeten — the value is the line item existing |
| Named-user auth upgrade (Supabase magic link) | +$1,000 one-time | Phase 2 upsell, mostly config |
| Live reporting dashboard on their domain (API-backed, DG24-reporting style) | +$2,000–$3,500 one-time | Scope depends on platforms (Google/Meta/TikTok/GSC) |

Anchor in the pitch: "the intel suite you're looking at right now can live at
intel.falconlabs.com for your whole team — that's part of the setup fee."
For Falcon specifically, consider **including the white-label deployment free as
the close incentive** — the suite is already in their brand, the deployment is an
afternoon, and Eugene will recognize exactly what's being given.

## 5. Risks / notes

- **Older suites reference shared assets** (`../../assets/imgs/logos/...`) and the
  DG24 keyword JSON paths — localize before white-labeling those folders.
- **Client-domain cookies/sessionStorage are scoped to their domain** — existing
  hyder.me sessions won't carry over; users re-enter the password once. Non-issue.
- **Search engines:** add `<meta name="robots" content="noindex">` to client-domain
  dashboards (password-gated pages render the gate to crawlers, but belt-and-suspenders).
- **Contract language:** dashboards on client domains should be licensed, not
  transferred — Hyder Media retains tool IP; client gets usage during engagement
  (mirrors the AG2020 vendor/licensor stance).
- **Vercel domains count:** Pro plan supports many custom domains per project; no
  practical ceiling at this scale.

## 6. The Falcon Labs pitch line

"This suite is live right now at hyder.me/clients/falconlabs — built in your brand,
on your competitors' real data. When we engage, it deploys to intel.falconlabs.com
with your team's logins, plus the live reporting dashboard once campaigns are running.
You'll have the same visibility into this channel that I built for Digistore24."
