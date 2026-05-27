# Lead-Attribution & Speed-to-Lead Platform — Implementation Plan

**Status:** draft, 2026-05-27
**Scope:** Close the attribution loop end-to-end for AG2020 (lead source → call/SMS → CRM → job → revenue), then promote the underlying tech to **native AutomateDojo capabilities available out-of-the-box to any lead-based business** — gyms, dojos, contractors, repair shops, anyone with leads. Verticalization is landing pages and starter templates, not separate products.
**Inputs:** the live autodialer (commit `c022ed90`); the AG2020 dashboard; AC + Google Ads + Meta Ads + Vonage + GlassBiller-CSV + Airtable-Rebates integrations already in place; Scribes for the current AC and Alive5 rep workflow (2026-05-27).

---

## 1. Executive summary

The speed-to-lead callback engine is live end-to-end for AG2020. The remaining
gap — and where the real product value sits — is closing the attribution loop:
tying every lead from its source (Google Ads, Meta Ads, Organic, etc.) through
CRM activity to the actual job in GlassBiller and the dollars on the invoice.

Once that loop is closed, AG2020 sees real cost-per-acquired-customer by
channel, real ROAS by campaign, real LTV by source. And the same engine and
adapters become **native AutomateDojo capabilities** — immediately useful to
any lead-based business in AD's catalog. No separate "auto-glass product." The
attribution platform *is* AutomateDojo's tech stack; verticalization is
configuration, copy and starter templates.

This plan stages the work to get AG2020 to that closed loop fast (single-tenant
first, but multi-tenant-shaped so extraction is `WHERE tenant_id = ?` not a
rewrite), then promotes the capabilities to AutomateDojo.

## 2. What the Scribes confirm

**(a) Lead-source attribution in AC is TAG-based, not field-based.** The "View
Lead Source Trends" Scribe walks the workflow Reports → Contacts → **Tag
Trends** → date range. AC's built-in Tag Trends report is what AG2020 uses
today. Tags identified so far on real contacts (from our discovery on contact
215720):

| Tag id | Tag name | Meaning |
|---|---|---|
| 2473 | `NewGoogle-HP` | Homepage form (Google-traffic source) |
| 2472 | `NewGoogle-LP` | Landing-page form (Google-traffic source) |
| 2487 | `NEW LEAD ALERT` | Unified new-lead flag (also our autodial trigger) |
| 2488 | `Missed Call - Vonage` | Missed-call attribution |

Phase 0 fully enumerates the 247-tag inventory and identifies Meta-source tags
(likely `NewMeta-*` or applied by the AC ↔ FB integration).

**(b) Meta leads flow via AC's NATIVE Facebook Business integration.** The
"Managing META Leads" Scribe shows the "FB Facebook Business" source icon
directly in AC contact list — no Zapier in the loop. Each Meta lead lands as
an AC contact automatically, tagged. Rick's current "count Meta leads" workflow
is manual (sort by date, scroll, count). The attribution platform replaces
that with one query and a chart.

**(c) Alive5 is fully siloed.** The "SMS Conversations in Alive5" Scribe shows
the entire rep workflow happening inside `app.alive5.com/sms` with OPEN /
PENDING / CLOSED status triage. Nothing flows back to AC. Combined with the
prior decision not to pay for the (top-tier-only) Alive5 API, SMS conversation
data is currently inaccessible. Mitigation in Phase 2: scrape/export
investigation in the short term, Twilio Conversations migration spec for the
medium term.

## 3. Productization framing

Per your direction:

- AG2020's bespoke dashboard stays put — not folded into AutomateDojo.
- The TECH (autodialer + attribution engine + integration adapters) becomes
  **out-of-the-box AutomateDojo capabilities** available to ANY tenant
  regardless of vertical.
- No separate "auto-glass attribution product" repo. Verticalization happens
  as AutomateDojo starter templates (preset integrations + copy) and
  industry-specific landing pages, not separate codebases.

Implication for every phase: nothing built here may be named or shaped
auto-glass-specifically. The engine, adapters, schemas, and dashboards are
generic from day one. AG2020 is a tenant — initially the only tenant — but a
tenant nonetheless.

## 4. Target architecture

### 4.1 The canonical table — `lead_journey`

One row per lead per tenant. Phone (primary) + email (secondary) are the
universal join keys across every external system; everything else is
enrichment as touchpoints land.

```sql
CREATE TABLE lead_journey (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,            -- multi-tenant from day one

    -- Universal identity
    phone VARCHAR(20),
    phone_normalized VARCHAR(20),              -- E.164, for matching
    email VARCHAR(320),
    email_normalized VARCHAR(320),             -- lower(trim(email))

    -- First-touch attribution (set once, immutable)
    first_touch_at TIMESTAMP WITH TIME ZONE NOT NULL,
    first_touch_source VARCHAR(50) NOT NULL,
        -- google_paid | meta_paid | organic | referral | direct
        -- | call_inbound | sms_inbound | manual | other
    first_touch_channel VARCHAR(100),          -- HP | LP | service-page | etc.
    first_touch_campaign VARCHAR(200),
    first_touch_ad_group VARCHAR(200),
    first_touch_keyword TEXT,
    first_touch_url TEXT,
    first_touch_utm JSONB,                     -- {source,medium,campaign,term,content}
    first_touch_gclid VARCHAR(200),
    first_touch_fbclid VARCHAR(200),

    -- Last-touch (multi-touch attribution support)
    last_touch_at TIMESTAMP WITH TIME ZONE,
    last_touch_source VARCHAR(50),

    -- Linked external IDs
    ac_contact_id VARCHAR(50),
    ac_deal_id VARCHAR(50),
    ac_pipeline_id VARCHAR(50),
    ac_stage_id VARCHAR(50),
    callrail_contact_id VARCHAR(50),
    crm_customer_id VARCHAR(100),              -- GlassBiller (or other CRM) customer ID
    crm_job_ids TEXT[],                        -- one lead can have multiple jobs over time
    crm_invoice_ids TEXT[],

    -- Journey state (state machine)
    journey_state VARCHAR(30) NOT NULL DEFAULT 'new',
        -- new | contacted | spoke | quoted | won | lost | completed | dormant

    -- Financial outcome (denormalized for dashboard speed)
    revenue_total NUMERIC(12, 2) DEFAULT 0,
    cogs_total NUMERIC(12, 2) DEFAULT 0,
    margin_total NUMERIC(12, 2) DEFAULT 0,

    -- Attributed acquisition cost (allocated at journey close)
    ad_spend_attributed NUMERIC(12, 2),

    -- Audit
    raw_first_touch JSONB,                     -- the payload that created the row
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_lead_journey_tenant_phone
    ON lead_journey(tenant_id, phone_normalized)
    WHERE phone_normalized IS NOT NULL;
CREATE INDEX idx_lead_journey_tenant_email
    ON lead_journey(tenant_id, email_normalized)
    WHERE email_normalized IS NOT NULL;
CREATE INDEX idx_lead_journey_tenant_first_touch
    ON lead_journey(tenant_id, first_touch_at DESC);
CREATE INDEX idx_lead_journey_tenant_source
    ON lead_journey(tenant_id, first_touch_source, first_touch_at DESC);
CREATE INDEX idx_lead_journey_state
    ON lead_journey(tenant_id, journey_state)
    WHERE journey_state NOT IN ('completed', 'lost');
```

### 4.2 Touchpoint log — `lead_touchpoints`

One row per discrete touchpoint event. Enables multi-touch attribution and full
timeline view per lead.

```sql
CREATE TABLE lead_touchpoints (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    journey_id BIGINT REFERENCES lead_journey(id),
    touchpoint_at TIMESTAMP WITH TIME ZONE NOT NULL,
    touchpoint_type VARCHAR(40) NOT NULL,
        -- ad_click | form_submit | call_inbound | call_outbound
        -- | call_missed | call_voicemail | sms_inbound | sms_outbound
        -- | ac_tag_added | ac_deal_stage_change | quote_sent
        -- | job_created | invoice_sent | invoice_paid | job_completed
    source VARCHAR(50),                        -- google_paid | meta_paid | etc.
    channel VARCHAR(100),
    direction VARCHAR(20),                     -- inbound | outbound | n/a
    payload JSONB,                             -- type-specific (call SID, AC event, etc.)
    revenue_cents BIGINT,                      -- if monetary
    duration_seconds INTEGER,                  -- if call
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_lead_touchpoints_journey
    ON lead_touchpoints(tenant_id, journey_id, touchpoint_at DESC);
CREATE INDEX idx_lead_touchpoints_type_date
    ON lead_touchpoints(tenant_id, touchpoint_type, touchpoint_at DESC);
```

### 4.3 CRM job mirror — `crm_jobs`

GlassBiller has no API, so we maintain a local mirror populated from CSV
ingestion. Generic naming so the same table serves any CRM CSV source via
swappable adapters (GlassBiller for AG2020; AccuLynx, JobNimbus, ServiceTitan,
MindBody, Glofox, Spark Membership, etc. for future tenants).

```sql
CREATE TABLE crm_jobs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    source_system VARCHAR(50) NOT NULL,        -- glassbiller | acculynx | jobnimbus | ...
    source_job_id VARCHAR(100) NOT NULL,       -- upstream ID
    journey_id BIGINT REFERENCES lead_journey(id),  -- matched by phone post-ingest
    customer_name VARCHAR(200),
    customer_phone VARCHAR(20),
    customer_phone_normalized VARCHAR(20),
    customer_email VARCHAR(320),
    job_status VARCHAR(50),
    invoice_number VARCHAR(50),
    invoice_date DATE,
    invoice_amount NUMERIC(12, 2),
    cogs_amount NUMERIC(12, 2),
    margin_amount NUMERIC(12, 2),
    paid_at TIMESTAMP WITH TIME ZONE,
    payment_method VARCHAR(50),
    raw_row JSONB,                             -- the CSV row for re-ingest / debug
    upload_batch UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, source_system, source_job_id)
);

CREATE INDEX idx_crm_jobs_journey ON crm_jobs(tenant_id, journey_id);
CREATE INDEX idx_crm_jobs_phone
    ON crm_jobs(tenant_id, customer_phone_normalized, invoice_date DESC);
CREATE INDEX idx_crm_jobs_date ON crm_jobs(tenant_id, invoice_date DESC);
```

### 4.4 Ad spend mirror — `ad_spend_daily`

Daily campaign-cost rollups from Google Ads + Meta Ads APIs. Used for cost
back-allocation to journeys.

```sql
CREATE TABLE ad_spend_daily (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    platform VARCHAR(30) NOT NULL,             -- google_ads | meta_ads | tiktok | ...
    account_id VARCHAR(50) NOT NULL,
    campaign_id VARCHAR(100),
    campaign_name VARCHAR(300),
    ad_group_id VARCHAR(100),
    ad_group_name VARCHAR(300),
    date DATE NOT NULL,
    spend NUMERIC(12, 2) DEFAULT 0,
    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    conversions NUMERIC(12, 2) DEFAULT 0,
    raw JSONB,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, platform, account_id, campaign_id, ad_group_id, date)
);

CREATE INDEX idx_ad_spend_tenant_date
    ON ad_spend_daily(tenant_id, date DESC, platform);
```

### 4.5 Integration-adapter pattern

Every external system has a thin adapter responsible for one job: turn
upstream events into `lead_touchpoints` rows (creating/upserting the
`lead_journey` row by phone if it doesn't exist). Every adapter implements
the same interface so a new integration is ~150 LOC, not a rewrite.

```js
// Pseudocode interface every adapter implements
async function processEvent(supabase, tenantId, sourceEvent) {
  const phone = extractPhone(sourceEvent);
  const email = extractEmail(sourceEvent);
  const journey = await upsertJourney(supabase, tenantId, {
    phone, email,
    firstTouchSource: classifyFirstTouch(tenantId, sourceEvent),
    firstTouchPayload: sourceEvent,
  });
  await insertTouchpoint(supabase, tenantId, journey.id, {
    touchpoint_at: extractTimestamp(sourceEvent),
    touchpoint_type: 'form_submit',  // or call_inbound, etc.
    source: classifySource(tenantId, sourceEvent),
    payload: sourceEvent,
  });
  await maybeUpdateJourneyState(supabase, journey.id);
}
```

Source classification (`classifySource`, `classifyFirstTouch`) reads from a
per-tenant **source map** stored in `tenant_config` (see §9). For AG2020, the
initial source map is built from the Phase-0 tag enumeration. For a new
tenant, the source map is the first thing configured at onboarding.

## 5. Phase 0 — discovery (do BEFORE any code)

Concrete actions, each ~15-30 minutes. Each produces a committed artifact.

1. **Enumerate the full AC tag inventory.** Query `/api/3/tags?limit=200`;
   produce a table of all 247 tags with id, name, contact-count, last-applied
   date. Identify which tags are lead-source classifiers vs. operational vs.
   noise. Output: `docs/ag2020-ac-tag-inventory.md`. The canonical input for
   the source map.

2. **Confirm the Meta tag convention.** From the tag inventory, identify
   Meta-source tags (likely `NewMeta-*` applied by AC's native FB integration).
   Also identify any other source-bearing tags (referral, direct mail,
   organic-call, etc.).

3. **Sample a GlassBiller CSV.** Get one fresh export from AG2020. Document
   the column schema (invoice #, customer name, phone, email, dates, amounts,
   status, payer). Output: `docs/glassbiller-csv-schema.md`. Confirm with
   AG2020 the export cadence they can sustain (daily preferred, weekly
   tolerable) and whether exports are full snapshots or deltas.

4. **Phone-normalization spot-check.** Sample 200 recent AC contacts + 200
   recent GlassBiller rows; confirm phone normalization (E.164 `+1NNNXXXXXXX`)
   matches across systems. Flag edge cases (extensions, international,
   formatting quirks).

5. **AC pipeline + stage map.** AG2020 has 8 AC pipelines (Cash, New Leads,
   Adrian, Lacy, Jesse, Ali, Warranty, TINT). Map each pipeline + stage to a
   `journey_state` value. Output: a JSON config block to seed `tenant_config`.

6. **Alive5 scrape feasibility — 30-minute spike.** Log in to
   `app.alive5.com/sms` and inspect: (a) is there a CSV export anywhere?
   (b) does the conversation list load via XHR/JSON we could call?
   (c) any notification/email integration that could mirror conversations
   out? Capture findings; decide scrape vs. defer-until-Twilio-Conversations
   migration.

## 6. Phase 1 — AG2020 end-to-end (multi-tenant-shaped)

Goal: AG2020 sees a working closed-loop attribution dashboard within ~1-2
weeks of starting.

### 6.1 New endpoints

```
/api/ag2020/journey-ingest          POST  log a touchpoint (used by adapters)
/api/ag2020/journey-list            GET   list journeys (paged, filtered)
/api/ag2020/journey-detail          GET   single journey + full timeline
/api/ag2020/attribution-summary     GET   aggregates for the Attribution tab
/api/ag2020/crm-jobs-upload         POST  multipart CSV upload (GlassBiller)
/api/ag2020/crm-jobs-link           POST  re-run phone-match for unlinked rows
/api/ag2020/_adapters/ac-webhook    POST  AC contact_tag_added → journey/touchpoint
                                          (wraps and chains into the autodial endpoint)
```

### 6.2 New tables

- `ag2020_lead_journey` (per §4.1)
- `ag2020_lead_touchpoints` (per §4.2)
- `ag2020_crm_jobs` (per §4.3)
- `ag2020_ad_spend_daily` (per §4.4)

All initialize `tenant_id = 'ag2020'`.

### 6.3 New crons (add to `vercel.json`)

- `*/30 * * * *` — `ag2020/cron-link-jobs` — re-link `crm_jobs` to
  `lead_journey` by phone for late-arriving jobs/contacts.
- `0 8 * * *` — `ag2020/cron-ad-spend-daily` — nightly pull of Google Ads +
  Meta Ads campaign cost into `ag2020_ad_spend_daily`.
- `0 9 * * *` — `ag2020/cron-attribution-rollup` — daily back-allocation of
  ad spend to journeys closed in the prior day; recompute
  `ad_spend_attributed` per journey.

### 6.4 Dashboard surface — new Attribution tab

A single new tab `#attribution` in `clients/ag2020/src/app/page.tsx`.
Top-level views:

- **By source** (table + chart): leads, contacted, spoke, won, completed,
  revenue, COGS, margin, ad spend, CAC, ROAS, stage-by-stage conversion —
  segmented by `first_touch_source`.
- **By campaign** (paid sources only): same metrics, segmented by
  `first_touch_campaign`.
- **Cohort retention** (monthly): new vs. repeat customers per source.
- **Funnel waterfall**: impressions → clicks → leads → contacted → spoke →
  quoted → won → completed, with conversion % at each step.
- **Search/drill-in**: search any phone or email, see the full journey
  timeline (every touchpoint, linked AC contact, linked job(s), revenue,
  margin).

Date range selector mirrors the Performance tab.

### 6.5 Build sequence (one commit per step, each independently deployable)

1. **Phase 0 artifacts committed** (tag inventory, CSV schema, pipeline map,
   Alive5 spike).
2. **Schema + helpers.** Apply DDL; write `_attribution-lib.js` (phone
   normalize, `upsertJourney`, `insertTouchpoint`, source-map loader from
   `tenant_config`).
3. **AC tag webhook adapter.** Reshape `autodial.js`'s AC tag gate into a
   generic adapter that writes a journey/touchpoint AND fires the autodial.
   Autodial becomes "one thing that happens when a new lead is created from
   an AC tag" rather than the trigger itself.
4. **GlassBiller CSV upload + ingestion + linker.** Endpoint + ingestion
   script + cron-link-jobs.
5. **Vonage backfill.** One-off: convert the existing ~75K
   `ag2020_call_logs` rows into touchpoints + create journey rows for unique
   callers.
6. **Autodial backfill.** Convert existing `ag2020_autodial_attempts` rows
   into touchpoints + journey upserts.
7. **Ad-spend ingestion crons.** `cron-ad-spend-daily` +
   `cron-attribution-rollup`.
8. **Attribution dashboard tab.** New tab in `page.tsx` querying the new
   endpoints.
9. **Polish.** Search/drill, CSV exports of journeys, anomaly alerting.

## 7. Phase 2 — Alive5 (export investigation + Twilio Conversations migration prep)

### 7.1 Short-term: SMS data export

- **Path A** — Phase-0 spike finds a CSV export → scheduled headless-browser
  download (Playwright on a cron), parse, write `lead_touchpoints` rows
  (`touchpoint_type=sms_*`). Daily cadence.
- **Path B** — no export, but conversations load via XHR → capture the XHR
  contract, build a session-cookie scraper. Daily cadence.
- **Path C** — neither feasible → accept SMS as opaque for now, capture only
  what reps manually copy into AC notes.

### 7.2 Medium-term: Twilio Conversations migration

Specification for moving inbound SMS off Alive5 onto **Twilio Conversations**
(reuses the AG2020 Twilio account already in use for autodial). Migration is
its own project — high-level outline:

1. Port the Alive5-tracked numbers to Twilio (or get new tracking numbers +
   update marketing).
2. Build a minimal rep UI (Twilio Conversations Web SDK).
3. Inbound SMS → Twilio Conversation → webhook → touchpoint + AC contact update.
4. Outbound from the rep UI (gated on A2P 10DLC clearing).
5. Migrate active conversations one weekend; keep Alive5 read-only for history.

Migration cost is real but unlocks the data plane permanently. Worth doing
once branded calling is settled (separate thread).

## 8. Phase 3 — promote to AutomateDojo native capabilities

Per the productization framing in §3: nothing here ships as a separate
auto-glass product. The capabilities lift into AutomateDojo and become
features available to every AD tenant.

### 8.1 Capabilities to add as native AutomateDojo features

| Capability | Where in AD | Sourced from |
|---|---|---|
| Speed-to-lead autodialer | `automatedojo/lib/autodial/` + `app/api/autodial/*` + per-tenant admin page | Lift from `/api/ag2020/_autodial-lib.js` + 4 sibling files |
| Closed-loop attribution (lead_journey + touchpoints) | `automatedojo/lib/attribution/` + `app/api/attribution/*` + admin page | Phase-1 work |
| AC tag-trigger adapter | `automatedojo/lib/adapters/activecampaign/` | Phase-1 work |
| Generic CRM CSV ingestion adapter | `automatedojo/lib/adapters/crm-csv/` | Phase-1, "GlassBiller" becomes a per-tenant CSV-schema config |
| Google Ads + Meta Ads cost ingestion | `automatedojo/lib/adapters/google-ads/`, `meta-ads/` | Existing per-client endpoints, generalized for multi-tenant OAuth |
| CallRail adapter (when AG2020 adds it) | `automatedojo/lib/adapters/callrail/` | Built once for AG2020, extracted |
| Twilio Conversations adapter | `automatedojo/lib/adapters/twilio-conversations/` | Phase-2 work |
| Generic VoIP CSV adapter (Vonage etc.) | `automatedojo/lib/adapters/voip-csv/` | Phase-1 work, generalized |

### 8.2 Per-tenant configuration UI in AD admin

Per tenant, new screens to configure:

- **Source map** — which tags / form IDs / ad-campaign labels classify as
  which `first_touch_source` + `channel`.
- **Integration credentials** — AC API key, Twilio account, Google Ads OAuth,
  Meta Ads OAuth (most already in AD's integration catalog).
- **Pipelines/stages → journey states** — map the tenant's CRM pipeline to
  the canonical state machine.
- **Business hours, dedupe windows, From / Rep-Inbound numbers, branded
  calling registration link-out.**

### 8.3 Out-of-the-box dashboards

Every AD tenant gets an **Attribution** tab and a **Speed-to-Lead** tab in
their admin, regardless of vertical. Same React components, fed by their own
scoped data.

### 8.4 Verticalization = starter templates + landing pages

AD's catalog gains cross-vertical starter templates that bundle preset
integrations + copy + email sequences. Each template is hundreds of lines of
config, not new code. Initial set:

- **Auto Glass Shop** — AC + Google Ads + Meta Ads + GlassBiller CSV +
  Vonage CSV + autodial + branded calling
- **Gym / Fitness Studio** — AC + Google Ads + Meta Ads + MindBody/Glofox +
  Twilio Conversations + autodial
- **Dojo / Martial Arts** — AC + Google Ads + Meta Ads + Spark Membership +
  Twilio Conversations + autodial
- **Home Services (HVAC / plumbing / electrical)** — AC + Google Ads + Meta
  Ads + ServiceTitan/Jobber + CallRail + autodial

Plus matching landing pages on `automatedojo.com/auto-glass`, `/gyms`,
`/dojos`, `/home-services` that pitch the verticalized package.

## 9. Multi-tenancy design rules (apply from Phase 1)

These rules are cheap to follow in Phase 1 and save weeks at Phase 3
extraction.

- **Every new table has `tenant_id`** as a non-null column. AG2020 rows
  initialize to `tenant_id = 'ag2020'`.
- **Every query filters on `tenant_id`** — no exceptions.
- **Every cron loops over a `tenants` table** and runs per-tenant — even
  when there's only one tenant. (Phase 1 `tenants` is a one-row table.)
- **Source maps, pipeline mappings, business-hours, dedupe windows, etc.
  live in a per-tenant `tenant_config` JSONB column** — not hardcoded.
- **Per-tenant secrets** — Phase 1: Vercel env vars per tenant. Phase 3:
  encrypted in the tenant row (the pattern AD's integrations catalog
  already uses).
- **NO tenant-name strings in code paths.** No `if (tenant === 'ag2020')`
  anywhere. All branching is by per-tenant config lookup.
- **No vertical-specific names in the engine.** "AutoGlass," "GlassBiller,"
  "Windshield" appear only in tenant config and starter templates, never
  in adapter/engine code.

## 10. Open questions / dependencies

- **Phase 0 deliverables must complete before Phase 1.2.** Specifically: full
  AC tag inventory + Meta tag identification, GlassBiller CSV schema, Alive5
  spike outcome.
- **GlassBiller export cadence** — confirm with AG2020 what they can
  realistically commit to (daily preferred, weekly tolerable).
- **First Orion INFORM registration** — independent thread (Rick has the
  ball); doesn't block Phase 1 but completes the trust/display story.
- **CallRail decision** — still pending. Phase 1 doesn't require it; Phases
  2-3 benefit from it for real-time hangup capture.
- **Alive5 migration timing** — gated on (a) A2P 10DLC SMS clearing
  (EIN-age issue), (b) priority vs. other roadmap items.
- **AutomateDojo readiness** — the integration catalog and admin shell
  exist; Phase 3 is mostly a porting + per-tenant-config job, not new
  infrastructure.

## 11. Risks

- **GlassBiller CSV schema drift.** If AG2020's CSV exports change shape
  (column rename, format change), the ingester breaks silently. Mitigation:
  schema validation on every upload + alerting + a "review pending" queue
  for rejected rows.
- **Phone-matching false positives.** Two leads at the same household share
  a phone. Mitigation: tie-breaker by email + name; flag ambiguous matches
  for manual triage.
- **Alive5 scrape brittleness.** Any Alive5 UI change breaks the scrape.
  Mitigation: keep scrape as best-effort, alert on failure, push toward
  Twilio Conversations migration as the durable answer.
- **Multi-tenant extraction debt.** Phase-1 shortcuts that violate §9
  become expensive in Phase 3. Mitigation: enforce §9 in PR review; reject
  tenant-name strings.
- **AC tag changes.** If AG2020 changes their tag naming, the source map
  needs updating. Mitigation: source map is per-tenant config (no code
  change), and `cron-attribution-rollup` recomputes the AC tag inventory
  daily for drift detection.

## 12. Success metrics

**For AG2020 (end of Phase 1):**

- 100% of new leads (form, Meta, calls) land in `lead_journey` with correct
  first-touch source attribution.
- 95%+ of GlassBiller jobs match to a journey by phone within 24 hours.
- Attribution dashboard tab loads in <2 s with 6 months of data.
- AG2020 can answer "what's our cost per acquired customer by source last
  month?" in <30 seconds via the dashboard.

**For productization (end of Phase 3):**

- A second AutomateDojo tenant is onboarded onto the attribution capabilities
  in <1 day cold-start.
- Selecting a starter template bootstraps a new tenant's integrations in
  <30 minutes.

## 13. Appendix — file/path inventory

```
docs/lead-attribution-platform-plan.md           THIS DOC
docs/ag2020-ac-tag-inventory.md                  Phase 0 output
docs/glassbiller-csv-schema.md                   Phase 0 output

api/ag2020/_attribution-lib.js                   Phase 1: shared helpers
api/ag2020/journey-ingest.js                     Phase 1
api/ag2020/journey-list.js                       Phase 1
api/ag2020/journey-detail.js                     Phase 1
api/ag2020/attribution-summary.js                Phase 1
api/ag2020/crm-jobs-upload.js                    Phase 1
api/ag2020/crm-jobs-link.js                      Phase 1
api/ag2020/cron-link-jobs.js                     Phase 1: cron */30
api/ag2020/cron-ad-spend-daily.js                Phase 1: cron 0 8 *
api/ag2020/cron-attribution-rollup.js            Phase 1: cron 0 9 *
api/ag2020/_adapters/ac-webhook.js               Phase 1
api/ag2020/_adapters/glassbiller-csv.js          Phase 1
api/ag2020/_adapters/autodial-link.js            Phase 1
api/ag2020/_adapters/vonage-csv-link.js          Phase 1
api/ag2020/_adapters/google-ads-cost.js          Phase 1
api/ag2020/_adapters/meta-ads-cost.js            Phase 1
api/ag2020/_adapters/alive5-export.js            Phase 2 (if feasible)

clients/ag2020/src/app/page.tsx                  Phase 1: new #attribution tab

automatedojo/lib/autodial/                       Phase 3: lifted
automatedojo/lib/attribution/                    Phase 3: lifted
automatedojo/lib/adapters/                       Phase 3: per-integration adapters
automatedojo/app/admin/attribution/              Phase 3: per-tenant dashboard
automatedojo/app/admin/speed-to-lead/            Phase 3: per-tenant autodialer config
automatedojo/templates/auto-glass-shop/          Phase 3: starter template
automatedojo/templates/gym/                      Phase 3: starter template
automatedojo/templates/dojo/                     Phase 3: starter template
automatedojo/templates/home-services/            Phase 3: starter template
```
