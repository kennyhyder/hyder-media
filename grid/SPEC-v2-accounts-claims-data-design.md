# GridCensus v2 — Accounts, Claims, Contributors, Data Layers & Design System

Build spec for the next phase. Three tracks: **(A)** free accounts + claim-profile + contributor/UGC flywheel, **(B)** new data layers ingested from the competitive landscape, **(C)** design influences folded into the system. Strategy context: win **free + biggest-directory + most-organic/AI-cited traffic**; the UGC/claims flywheel is the moat + freshness engine; monetize *on top* (enterprise/API, lead-gen, featured profiles, reports).

Stack: Next 16 server app (gridcensus.com), Supabase `ilbovwnhrowvxjdkvrln` (SHARED — see trigger gotcha), tables prefixed `gc_`. Reuse monorepo patterns: AutomateDojo `lib/api-tokens.ts`, `lib/lead-abuse.ts`, `lib/ab.ts`; mission-control auth; AEO stack.

---

## A. Accounts + Claim-Profile + Contributor System

### A1. Auth & roles
- **Free signup** via Supabase Auth (email/password + magic link + Google OAuth). Login flow MUST pass `data: { product: 'gridcensus' }`.
- **CRITICAL shared-project gotcha:** the shared Supabase project has `auth.users` triggers from AutomateDojo (`9dm_handle_new_user`) + SportsBookISH (`sb_handle_new_user`) that fire on every signup. Any new `gc_` trigger MUST gate on `raw_user_meta_data->>'product' = 'gridcensus'`, and the signup must set that product flag, or cross-product signups break. (Documented pattern in root CLAUDE.md.)
- **Roles** (`gc_users.role` + capability flags): `member` (default free), `contributor` (earned trust), `owner` (claimed an entity), `enterprise` (paid/API), `moderator`/`staff`. Capabilities resolved server-side.

### A2. Two interaction models by entity ownership
| Entity | Has an owner who benefits from claiming? | Model |
|---|---|---|
| Datacenters, IXPs, operators/companies, utilities, brokers/EPCs | Yes | **Claim** (verify → own → edit → optional paid upgrade) |
| Candidate sites (164k), substations, transmission, brownfields | No (unowned land/infra) | **Watch / Save / Suggest-edit** (no ownership, but save + contribute) |

New entity type needed: **`gc_companies`** (operators, utilities, brokers, EPCs, developers) — claimable org profiles that relate to datacenters/IXPs/sites. This is the Crunchbase/G2 layer.

### A3. Claim flow (owned entities)
1. "Claim this profile" CTA on datacenter/IXP/company pages → signup/login.
2. **Verification tiers** (Google-Business-Profile-style, escalate by risk):
   - Email domain match (claimant email domain == entity website domain) → instant low-trust claim.
   - Website/DNS verification (meta tag or TXT record) → verified badge.
   - Doc/manual review (staff) for disputes or high-value/paid.
3. Owner can: edit description/logo/contact/specs, respond to data, see a basic analytics panel (views, leads).
4. **Monetization hook:** claim = free; **"Enhanced/Featured listing"** (logo, top placement, lead capture, badge) = paid. Disputed claims → moderator queue.

### A4. Contribution / edit system (all entities)
- "Suggest an edit", "Add a site/facility", "Report stale/incorrect" on **every** entity page.
- Submissions → **`gc_contributions`** (entity_type, entity_id, field-level diff JSON, **source/citation field required**, submitter, status). Moderation queue in `/admin`.
- **Overlay architecture (important):** UGC edits NEVER mutate the canonical ingested `grid_*` data. They write to **`gc_entity_overrides`** (entity_type, entity_id, field, value, source, approved_by). The render layer **merges overrides on top of canonical data** at read time. Keeps the ingest pipeline idempotent and lets us trust/distrust UGC independently. (Mirrors how AutomateDojo separates ingested vs edited content.)
- **Moderation:** staff approve/reject; **trusted contributors** (reputation ≥ threshold) get auto-merge or fast-track; full audit + rollback (`gc_activity_log`). Spam/abuse scored via the `lib/lead-abuse.ts` pattern.
- **AEO payoff:** approved edits bump the entity's `dateModified` → fresher pages → more AI citations + crawl priority. This is also the **freshness engine** that fixes the stale-data risk.

### A5. Watch / Save / Lists (unowned sites)
- Logged-in users **save** sites, build **lists/portfolios** (`gc_lists`, `gc_list_items`), compare, export (gated by tier).
- **Alerts** (`gc_alerts`): "notify me when queue status changes / a new ≥75-score site appears in this county / price at this node moves." Email + webhook. Drives re-engagement + is a premium feature.

### A6. Reputation & light gamification
- `gc_reputation` (points for approved contributions, claims, verified edits). Contributor badges, a tasteful leaderboard. B2B-appropriate (no cheesy confetti) — "Verified Contributor", "Top Editor — Texas".

### A7. Free API + automated use
- Free signup → **read-only API key** (`gc_api_tokens`, `gck_live_…`, sha256-hashed) — reuse AutomateDojo `lib/api-tokens.ts` verbatim. Rate-limited; tiers raise limits.
- Endpoints: site/entity lookup, search, rankings, "score a lat/long". Webhooks for watched changes. Public OpenAPI spec (also an AEO asset).
- This is the developer/automation on-ramp + a soft enterprise upsell.

### A8. Schema summary (`gc_*`)
`gc_users` · `gc_companies` · `gc_entity_claims` (entity_type, entity_id, user_id, status, verification_method, verified_at) · `gc_contributions` (diff, source, status, moderator) · `gc_entity_overrides` (the merge layer) · `gc_saved_sites` / `gc_lists` / `gc_list_items` · `gc_alerts` · `gc_api_tokens` · `gc_reputation` · `gc_activity_log`. All with RLS; product-scoped.

### A9. Build phases
1. Auth + `gc_users` + product-scoped triggers + member dashboard.
2. Watch/save/lists/alerts (works on existing 195k pages immediately).
3. Claim flow + `gc_companies` + verification + owner edit.
4. Contribution/override system + moderation `/admin` + reputation.
5. Free API tier + webhooks + OpenAPI.

---

## B. Data layers to ingest (from the landscape)

Each entity/page gets richer; several are free/open. Priority = differentiation × gettability.

| # | Layer | Source | Adds | Cost | Priority |
|---|---|---|---|---|---|
| 1 | **Live nodal LMP + fuel mix** | **Grid Status** (open-source `gridstatus` lib + API) | "Current power price at nearest node", live grid economics — no static directory has this | Free lib / tiered API | **HIGH** |
| 2 | **Deeper interconnection queue** | **LBNL "Queued Up"** (2,060 GW) + interconnection.fyi + per-ISO feeds | Per-project queue status, MW-in-queue, completion/withdrawal — *the* speed-to-power story | Free | **HIGH** |
| 3 | **Grid carbon intensity** | **Electricity Maps** API | ESG overlay hyperscalers weight | Free tier / paid | MED |
| 4 | **Parcel boundary + ownership + zoning** | **Regrid** (160M parcels) | Turns a point into a buildable parcel — what developers actually need | Licensed ($$) | MED (budget-gated) |
| 5 | **Existing-facility enrichment** | Baxtel/Cloudscene/OSM (we have `grid_datacenters` 3,731 from OSM) | Operator, stage (operational/construction/planned), capacity MW | Free/scrape | MED |
| 6 | **Satellite / terrain imagery** | Mapbox Satellite / Esri World Imagery tiles | Real imagery hero per parcel (Descartes Labs influence) + a map layer toggle | Free tiers | MED (big visual win) |
| 7 | **Network/peering depth** | PeeringDB (IXPs) + FCC | Participant networks, routes | Free | LOW |
| 8 | **Power-price forecast** | Enverus = proprietary; build a simple model from historical LMP | Forward economics | Build | LOW/optional |
| 9 | **Permitting/zoning timelines** | County sources (Paces does this; hard) | Time-to-permit by jurisdiction | Hard | LOW |

Wire each into `update-all.py` as an additive enrichment (id-stable, overlay-friendly) → re-run `build-rollups.mjs`. #1, #2, #6 are the highest-leverage near-term.

---

## C. Design influences to fold in (the wow techniques)

From the landscape research. Build into the chosen design system after the map-first front door lands.

**Map-as-product (the core):**
- **Full-bleed map front door** — the `/preview/map` prototype (in progress). *Electricity Maps, gridstatus.io/map, earth.nullschool.*
- **Custom dark basemap** — CartoDB Dark Matter now; Mapbox Studio style later. Default tiles = "hobby project" tell. *Mapbox showcase.*
- **Color the whole map by the hero metric (DC Readiness)** — choropleth + point coloring with legend. *Electricity Maps.*
- **Map↔panel sync** — hover list ↔ highlight marker; pan map ↔ refilter list; render scores as map labels not generic pins. *Zillow / Redfin / Crexi.*
- **Layer toggles + live in-view counts + CSV export + dark/light** — *Baxtel.*
- **Draw-your-own-area search + save-this-search** — *Redfin.*

**Story & motion:**
- **One scrollytelling flagship** — a "How to find 200MW of power in <3 years" landing that pins the map and flies it through the narrative. *The Pudding / NYT / Reuters.* (Scrollama + flyTo.)
- **Time-slider replaying history** — queue depth / nodal price over time. *gridstatus.io, windy.com.*
- **Aliveness** — flyTo easing, hover-lift, pulse on top sites, "● LIVE" indicators, animating counts. *earth.nullschool, flightradar24.*

**Bespoke viz & imagery:**
- **One signature visualization** that becomes a brand asset — radial readiness gauge, sub-score breakdown, or a glowing transmission-network graphic. *CB Insights market maps, Watershed dashboards, Grid Status fuel-coded plants.* (D3 / Observable Plot, not stock charts.)
- **Satellite imagery hero on site profiles** — real parcel imagery. *Descartes Labs.*
- **3D extruded data (later)** — extrude counties by capacity/site-count. *kepler.gl.*

**Craft layer:**
- **Restrained micro-interactions + confident typography + tight accent palette** — the "premium-clean" finish. *Felt, Watershed, Palantir gravitas.*

**Directory/trust UX (pairs with the claim system):**
- **Verified/claimed badges**, company profiles, optional ratings. *Crunchbase / G2.*
- **Parcel boundary overlays.** *Regrid.*

---

## Sequencing recommendation
1. **Lock the design direction** (the two static previews + the map-first prototype) → build the design system.
2. **Map-first front door** to production (the wedge: feel-the-data-before-signup, which no gated competitor allows).
3. **Accounts → Watch/Save/Alerts** (instant value on the 195k existing pages).
4. **Data layers #1, #2, #6** (live LMP, deep queue, imagery) — real edge.
5. **Claim + Contribution/Override + Moderation** (the moat + freshness flywheel).
6. **Free API + scrollytelling flagship + signature viz** (AEO + wow + developer funnel).
7. Monetization layer throughout: enterprise/API, featured profiles, lead-gen, reports.
