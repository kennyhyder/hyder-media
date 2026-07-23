# Vendor Acquisition-Source Tracking — Engineering Spec

**Prepared by:** Hyder Media (Kenny Hyder, kenny@hyder.me)
**For:** Digistore24 engineering
**Date:** 2026-07-23
**Purpose:** Persist the acquisition source on each vendor account so vendor *activations*
and *revenue* can be attributed to paid marketing cohorts. This unblocks the
performance-measurement layer of the paid search engagement (ROAS assessment, scaling
gates) and enables Google Ads to optimize toward activated vendors instead of raw signups.

**Estimated effort: 2–5 engineering days.** No new tracking domains, no consent changes
beyond existing cookie policy, no PII leaves Digistore24.

---

## 1. What already works (verified from the outside, 2026-07-23)

- All paid clicks carry `gclid` (Google auto-tagging) plus UTM parameters
  (`utm_source/medium/campaign/content`) onto `experience.digistore24.com` landing pages.
- `experience.digistore24.com` and `www.digistore24.com` share the root domain, and the
  Google tag stores the click ID in a first-party cookie scoped to `.digistore24.com`
  (`_gcl_aw`, 90-day lifetime). **This cookie is already readable on the signup page** —
  it is how Vendor Sign-up conversions track today.

## 2. The gap

Landing-page CTAs link to `https://www.digistore24.com/en/signup` as a bare URL. Nothing
in the signup flow reads the attribution cookie/params and writes them to the vendor
record. Once the account is created, acquisition source is lost — so activations and
revenue cannot be joined back to the marketing channel that produced the vendor.

## 3. Requirements

### R1 — Capture at signup (the core change)
At vendor account creation, read and persist to the vendor record:

| Field | Source | Example |
|---|---|---|
| `acq_gclid` | `_gcl_aw` cookie (format `GCL.<ts>.<gclid>`, take 3rd segment) | `Cj0KCQ…` |
| `acq_source` | `utm_source` (URL param if present, else referrer-derived, else `direct`) | `google` |
| `acq_medium` | `utm_medium` | `cpc` |
| `acq_campaign` | `utm_campaign` | `sell-online` |
| `acq_content` | `utm_content` | `sell-digital-products` |
| `acq_landing_page` | first page path | `/sell-online` |
| `acq_first_seen_at` | timestamp of first capture | ISO 8601 |
| `acq_signup_at` | account-creation timestamp | ISO 8601 |

Rules: **first-touch, write-once** (never overwritten later); nullable (organic vendors
simply have `acq_source = direct/organic`); fields live on the vendor record keyed by the
existing vendor ID — no new join tables required.

*Belt-and-suspenders (recommended, ~half a day extra):* a small script on the landing
pages that copies `gclid` + `utm_*` into a first-party cookie/localStorage on
`.digistore24.com` with 90-day expiry, so capture survives even if Google's cookie is
blocked. Landing pages are Hyder-managed content — we can deploy this side ourselves;
Digistore24 only needs to read it at signup.

### R2 — Activation join (no new tracking, definition only)
Digistore24 already knows when a vendor activates. Required: a written definition of the
activation event for reporting purposes (proposed: *first product approved & live* or
*first sale processed* — pick one) and its timestamp on the vendor record
(`activated_at`). Since R1 fields live on the same record, the join is free.

### R3 — Cohort report (aggregate only, no PII)
Monthly export (CSV or API endpoint), delivered by the 10th of each month, aggregated by
signup month × campaign:

```
signup_month, acq_campaign, acq_content, signups, activated_to_date,
median_days_to_activation, revenue_to_date_usd
```

Aggregate counts only — no names, emails, or vendor IDs — which keeps the report outside
personal-data scope under the DPA. Threshold note: suppress rows with < 5 vendors if
Digistore24 prefers k-anonymity.

### R4 (optional, high value) — Offline conversion upload to Google Ads
Nightly/weekly job: for vendors with `acq_gclid` whose `activated_at` was set since the
last run, upload an offline conversion ("Vendor Activation", value = agreed vendor value)
via the Google Ads API using the stored gclid. This lets bidding optimize toward
activations rather than signups — historically worth 20–40% CAC efficiency in
lead-gen→activation funnels. Hyder Media can own the Google Ads side (conversion action
setup, import mapping); Digistore24 only exposes the (gclid, activated_at, value) feed.

## 4. Acceptance tests

1. Test click with `gclid=TEST…` → complete signup → vendor record shows all R1 fields.
2. CTA path `experience.digistore24.com/* → /en/signup` preserves capture (cookie read
   works cross-subdomain).
3. Organic direct signup → record shows `acq_source=direct`, no gclid, no errors.
4. First monthly cohort report reconciles with Google Ads-reported paid signups for the
   same month within ±10% (differences from consent-blocked cookies are expected and
   should be noted, not fixed).

## 5. Open questions for Digistore24 engineering

1. Signup stack: is `/en/signup` server-rendered with access to request cookies, or an
   SPA? (Determines whether capture is server-side or a JS snippet.)
2. Which activation event definition do you prefer (first product live vs first sale)?
3. Is 30-day attributed revenue per vendor available on the same record, or does revenue
   live in a separate billing system? (Affects R3 `revenue_to_date` only.)
4. Any consent-management constraints on reading `_gcl_aw` at signup? (It is already set
   and used for conversion tracking today, so presumably no.)

---

*Context: signup-level attribution already works (Google-tracked Vendor Sign-up
conversions, live since 2026-05-01). This spec closes the signup→activation gap so both
parties can measure channel ROI on the 365-day vendor-value basis discussed in July 2026.*
