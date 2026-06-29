# Token-Verticals Master Plan — A Fleet of pSEO "Census" Data Properties

_Last updated: 2026-06-28 · Owner: Kenny Hyder · Source: Ribbit Token-Opportunity framework (capex 1-19) + the proven gridcensus.com playbook_

---

## 1. Overview & Thesis

Each of Kenny's 19 token-opportunity verticals shares the same structural truth: a **large, fragmented market whose supply side is invisible**, with the underlying data already sitting in **free public sources** (government registries, federal APIs, open datasets) but locked inside ugly portals, paywalled B2B tools, or single-brand walled gardens. No one has built the comprehensive, free, SEO/AEO-optimized **public census** of who/what/where.

**The strategy:** Launch all (or most) verticals as **SEO-maxed public "census" data properties** — one indexable page per entity, map-first, fully structured for search and AI-answer engines. Give the data away free. Whichever properties gain organic traction become a **distribution moat**: a warm, search-acquired, two-sided userbase (owners claim listings, demand-side searchers find them) that the eventual capex business (network, marketplace, SaaS, finance layer) monetizes _on top of_ the free census. The census is the cheap, defensible top-of-funnel — not the product.

**Why this works (the gridcensus lesson):** You can't out-data the gated incumbents (Enverus, Inside Towers, SemiAnalysis) or out-sell the brokers. You win by being the **free + biggest + best-presented + most-AI-cited** source. The incumbents hide their data behind logins; a public, map-forward front door is the wedge. The **claims/UGC flywheel** is the moat and the freshness engine. Monetization (enterprise/API, featured profiles, lead-gen, underwriting subscriptions) layers on later.

**Portfolio bet:** Spin up many properties cheaply (the engine is ~90% reusable — each new vertical is a data binding + a domain). Most are large-effort ("L") on data ingestion but small on net-new code. Treat them as a portfolio of organic-traction lottery tickets, each of which — if it ranks — front-runs a real capex thesis.

---

## 2. The Proven Template (the gridcensus.com stack)

Every property replicates the **gridcensus.com** stack (see `memory/data-property-playbook.md` — the 9-stage system, distilled from building gridcensus at ~200k pages on its own infra). The engine is ~90% reusable.

| Layer | Standard build |
|---|---|
| **App** | Standalone **Next.js 16** server app (NOT static export — pSEO needs ISR / dynamic routes / sitemaps). `output` default (not `standalone` — node_modules copy ENOTEMPTYs on iCloud Desktop). Own Vercel project, root dir = app subdir. |
| **Database** | **Own Supabase project per property** (never share — each grows to millions of rows). Per-property table prefix. |
| **API** | **Own in-app API** (`src/app/api/<x>/route.ts`) — fully self-contained, no monorepo proxy. Free read-only API tokens as the developer on-ramp. |
| **Entity pages** | **ISR at scale:** `generateStaticParams → []` + `dynamicParams = true` + `revalidate=86400`. Render on-demand; sitemap enumerates all URLs. Slugs `${slugify(name)}-${id.slice(0,8)}`. **Completeness noindex gate** — thin pages get `robots:{index:false}` + excluded from sitemap (avoid "scaled content abuse"). |
| **Rollups** | Aggregates from a committed `rollups.json` (build-rollups.mjs paginates the whole table once — PostgREST aggregates are disabled on Supabase). Per-page top-N + entity detail via live indexed REST + ISR. |
| **Cross-linking** | **The richness play:** a unified Organization/operator entity aggregating EVERY asset across ALL types, with `<OrgLink>` on every entity → owner hub. Competitors don't cross-link ownership. |
| **Maps** | **Map-first islands**, not "a webpage with a map widget." Full-bleed theme-aware dark basemap (CartoDB), colored by ONE hero metric, Zillow-style map↔panel sync. Map is `dynamic(ssr:false)` client island; entity content stays server-rendered (every entity keeps its indexable URL). Viewport bbox fetch with zoom-scaled `min_score` floor. |
| **Schema / AEO** | JSON-LD (Dataset w/ `dateModified` + `variableMeasured` + `distribution`, Place/Organization/ItemList/Breadcrumb/FAQ) on every page type. **Sharded sitemaps** (`generateSitemaps`, 50k cap) + manual `/sitemap-index.xml`. **llms.txt + ai.txt** (generated from rollups, not hardcoded). Dynamic per-type **OG images** (`opengraph-image.tsx`). Honest **freshness** (`dataLastUpdated` from MAX source timestamp → drives "Updated" stamp + all dateModified + sitemap lastmod). **IndexNow** after every deploy. HF dataset mirror + Wikidata entity for AI citation. |
| **GSC loop** | **Autonomous SEO loop:** daily cron pulls GSC Search Analytics → opportunity engine flags striking-distance (pos 8-20), low-CTR-high-impression, content gaps, decliners → Claude auto-applies title/meta/content fixes (through compliance gate) or mints pages → re-ping IndexNow → measure. Needs GSC property verified + a Google service account as a GSC user. (Kenny's one stored OAuth token already grants Search Console READ across all his sites — see `memory/google-api-access.md`.) |
| **Accounts / claims** | **Supabase Auth** (`@supabase/ssr`, `/auth/callback` route, Resend SMTP, product-scoped trigger). Claim model for owned entities (email-domain→DNS→manual verify); Watch/Save/Suggest-edit for unowned. **Overlay-merge** — UGC writes to `*_entity_overrides`, merged at read, never mutating canonical (doubles as freshness engine). |
| **Email** | **Resend** verified-domain SMTP for auth + notifications (Gmail SMTP fallback until each domain is verified). |
| **Compliance gate** | `next.config.ts headers()` = 8/8 security (HSTS preload, tuned CSP, X-Frame DENY, COOP/CORP, Permissions-Policy). W3C 0 errors, WAVE ≤2, AA contrast both themes. Generic 5xx (never leak Postgres internals), IP rate-limit on anon full-mode, secrets server-only, RLS on accounts tables. |
| **Design discipline** | **Kill the "AI build" tells:** NO teal/cyan accent (each property gets a distinctive signature color — see per-vertical), NO rotated-square logo, NO generic number-pill badges. Custom inline-SVG monogram. Distinctive type (Space Grotesk display + Geist Mono figures). Offer 2-3 live brand mockups before committing. |

**Reusable assets to copy into each property:** `build-rollups.mjs`, `entity-slug.ts`, `src/lib/schema.ts`, `sitemap.ts` + `sitemap-index.xml/route.ts`, the map components, the theme system, the `grid-api/{db,utils,demo}` route-handler lib, the compliance `next.config.ts headers()`, the accounts migrations + overlay-merge, IndexNow key+ping, the GSC-loop schema. AEO/Stripe/compliance pattern source: AutomateDojo `lib/aeo-files.ts`, `lib/api-tokens.ts`, `lib/compliance-scanner.ts`.

---

## 3. Domain Shortlist

One row per vertical. **Recommended** = the top available `.com` (census-family preferred — it's the proven brand system); **Alt** = the strongest available backup. All recommended/alt domains are confirmed available; the previously-ideal names noted as taken are excluded.

| # | Vertical | Recommended (.com) | Alternative | Effort | Priority |
|---|---|---|---|---|---|
| 1 | ADAS / Auto Glass Calibration | **adascensus.com** | calibratemap.com | L | next |
| 2 | Backup Power Install | **powercensus.com** | grideready.com | L | next |
| 3 | Wireless / Cell Towers | **towercensus.com** | antennacensus.com | L | next |
| 4 | EV Charging Reliability | **chargecensus.com** | plugcensus.com | L | next |
| 5 | Oil & Gas Well Integrity | **wellcensus.com** | plugcensus.com | L | next |
| 6 | Commercial Kitchen Equip Service | **kitchencensus.com** | hoodcensus.com | M | next |
| 7 | Municipal EV Fleets | **fleetcensus.com** | fleetwatt.com | L | next |
| 8 | Ag Equipment Telematics | **farmcensus.com** | tractorcensus.com | L | next |
| 9 | Storm Chasers / Severe Wx | **stormcensus.com** | chasercensus.com | L | next |
| 10 | Fire Suppression / Sprinkler | **firecensus.com** | sprinklercensus.com | L | next |
| 11 | Elevator Maintenance | **liftcensus.com** | elevatorcensus.com | L | next |
| 12 | Residential Solar Installers | **panelcensus.com** | installerscore.com | L | next |
| 13 | Medical Imaging Service (ISOs) | **imagingcensus.com** | scannercensus.com | L | next |
| 14 | Commercial HVAC / BAS | **buildingcensus.com** | hvaccensus.com | L | next |
| 15 | Fleet / Truck Repair Shops | **shopcensus.com** | rigcensus.com | L | next |
| 16 | Industrial Robotics Service | **servocensus.com** | armcensus.com | L | next |
| 17 | Data Center Infrastructure | **dccensus.com** | colocensus.com | L | next |
| 18 | Water Utility Infrastructure | **pipecensus.com** | aquacensus.com | L | next |
| 19 | Parking Structure Condition | **garagecensus.com** | parkcensus.com | L | next |

> **Naming note:** `fleetcensus.com` is the natural top pick for BOTH #7 (Municipal EV Fleets) and #15 (Truck Repair). Resolve the collision by assigning **fleetcensus.com → #7 Municipal EV Fleets** (cleaner fit — fleets of vehicles) and **shopcensus.com → #15 Truck Repair** (centers the shop, the actual census unit). Alt for #7 is fleetwatt.com if a sharper EV signal is wanted.

---

## 4. Per-Vertical Deep Dives

---

### #1 — CalibrateNet · ADAS / Auto Glass Calibration
**Recommended domain:** `adascensus.com` · alt `calibratemap.com`, `calibrationcensus.com`

**Thesis.** ADAS-equipped vehicles went 11% (2020) → 50% (2025) → ~75% by 2030, but 70% of collision shops can't calibrate and Safelite can't scale into the gap. There's no comprehensive public census of WHO can calibrate WHAT, WHERE. Enumerate every calibration-capable facility + auto glass shop into the richest free per-location dataset in the market — the distribution flywheel that front-runs the CalibrateNet network play.

**Competitors & weaknesses.**
- **Car ADAS locator** — only ~80 franchise centers; a sales funnel, not a census.
- **Glass Shop Finder** — generic glass directory, zero ADAS dimension, dated UX, no structured data.
- **AGSC locator** — authoritative but plain-text registry, members-only, no maps/capability data.
- **OPUS IVS ADAS Map** — paywalled B2B technical reference, no consumer SEO.
- **Safelite store locator** — single-brand (the incumbent we're disrupting), no comparison/transparency.

**Our edge.** The ONE comprehensive, free, map-first census: every calibration-capable facility AND glass shop, with the richest per-location data anywhere — calibration types (static/dynamic/mobile), equipment brand (Autel/Hunter/Bosch/Car-O-Liner), OEM make certs, AGSC + I-CAR creds, insurance/DRP acceptance, "last verified" freshness. Full SEO/AEO to win the long-tail `[make] ADAS calibration [city]`. Free claim accounts double as the warm-lead pipeline of network-ready independents.

**Census moat.** UNIT = calibration-capable facility / auto glass shop. Roll up by city/metro/state + OEM-make + equipment-brand facets. Sources: AGSC registries, I-CAR Gold Class locator, Car ADAS locator, equipment-maker dealer locators, Google Places/OSM, chain locators, insurer DRP lists. **~80k-150k pages.**

**Design.** Accent `#F4511E` (safety-orange / calibration-target). Mood: trustworthy automotive-precision, instrument-panel feel. Map-first. North-star: gridcensus map + OpenChargeMap/PlugShare clarity.

---

### #2 — PowerReady · Backup Power Installation
**Recommended domain:** `powercensus.com` · alt `grideready.com`, `backupcensus.com`

**Thesis.** $6.6B US standby SAM, $28.5B global by 2035. Supply side is invisible/fragmented — homeowners dig through manufacturer locators and solar-first listings with no standardized credential/pricing/resilience data. Enumerate every licensed backup-power installer + a geographic grid-resilience layer; own the organic graph, then convert to the certified-network business.

**Competitors & weaknesses.**
- **Generac Dealer Locator** — single-brand, zip-search-only, no indexable pages.
- **EnergySage** — solar-first, ~500 curated installers, lead-gated, generators absent.
- **Qmerit** — EV-charger-first, a lead-routing black box, zero per-installer SEO.
- **Shovels.ai** — excellent permit data but paywalled B2B (use as INGEST SOURCE, not competitor).
- **State license boards** — 50 ugly portals, no cross-state search, no specialization filter.

**Our edge.** Only FREE multi-brand installer census + only public grid-resilience map. Full coverage (all license boards + Shovels permits + dealer networks, not a curated 500). Richest per-entity page (license freshness, permit-derived install volume + inspection pass-rate). The map-first **resilience layer** (EIA/utility outage frequency × installer density) nobody builds. Full AEO stack + claim flywheel.

**Census moat.** UNIT = backup-power installer + 2nd layer of US geography (county/metro resilience pages). Sources: 50 state license boards, Shovels permits, Generac/Tesla/Kohler/Enphase/Qmerit cert lists, EIA + PowerOutage.us, Census TIGER. **~90k-160k pages.**

**Design.** Accent `#F25C05` (high-voltage amber). Mood: grid-ops control room, consumer-friendly. Map-first. North-star: EnergySage depth + Shovels rigor, presented map-first like Windy/PowerOutage.us.

---

### #3 — TowerCensus · Wireless Infrastructure
**Recommended domain:** `towercensus.com` · alt `antennacensus.com`, `macrocensus.com`

**Thesis.** Every registered tall structure carrying wireless gear is public record in the FCC ASR (~100k+ structures) + ULS license layer — but it sits in a 1990s gov UI with no maps, no owner cross-links, no SEO. Enumerate every antenna structure into one indexable map-first page each, cross-linked by owner (American Tower/Crown Castle/SBA) and carrier. The free census on-ramp to the TowerTrack paid carrier-capex intelligence layer.

**Competitors & weaknesses.**
- **FCC ASR** — authoritative but brutal gov form, no per-tower pages, zero SEO.
- **AntennaSearch.com** — dated, radius-search-only, no clean URLs, no owner roll-ups.
- **CellMapper.net** — crowd RF map, not a structured registry, app SPA (no indexable pages).
- **CellTowerMaps/Finder** — thin FCC skins for ad traffic, shallow data.
- **Inside Towers Database** — most complete but fully paywalled B2B (we win the free layer).

**Our edge.** Out-census the gov source, out-open the paywalled incumbents. One map-first page per structure with the richest free data (geo/height/owner/tenants/carriers/frequencies/FAA study/lighting/history). Entity cross-linking (owner + carrier + municipality roll-ups). Provenance + freshness (ASR/ULS/FAA cites + "last verified"). Full AEO. Claim-this-tower accounts seed the paid TowerTrack layer.

**Census moat.** UNIT = antenna structure (+ 2nd tier of small-cell/WCF permits). Sources: FCC ASR bulk, FCC ULS, FAA OE-AAA, municipal permit portals (top 500 cities first), towerco filings. **~150k-200k at launch → 250k+.**

**Design.** Accent signal amber `#F59E0B` (tower obstruction lighting). Mood: infrastructure-grade, engineering register. Map-first. North-star: gridcensus + Mapbox/Felt dark maps + FlightAware.

---

### #4 — ChargeCensus · EV Charging Reliability
**Recommended domain:** `chargecensus.com` · alt `plugcensus.com`, `chargetruth.com`

**Thesis.** 16% of public charging attempts fail; networks score 59-66 on reliability — yet there's no neutral, SEO-discoverable per-station reliability record. Every app locks data behind a login with zero indexable pages. Enumerate every public station + port (DOE AFDC + OCM open data), publish one rich page each with a transparent ChargeScore and uptime trend — capturing the "will this charger actually work" query incumbents structurally can't answer on the open web.

**Competitors & weaknesses.**
- **PlugShare** — app-first/login-walled SPA, station pages not indexable, reliability buried.
- **DOE AFDC/NREL** — canonical free dataset but no scoring/crowd reports/landing pages (our richest ingest source).
- **ChargeHub** — only ~55k ports, app-gated, no transparent scoring/SEO.
- **Open Charge Map** — open API (great ingest) but bare map, no scoring/freshness/SEO.
- **ChargeFinder** — live availability only, thin indexable content, no historical score.

**Our edge.** Beat them on the open web, not in the app store. One indexable JSON-LD page per station AND per port. A transparent, methodology-published **ChargeScore** (success-rate × recency × volume). Richest dataset by merging AFDC + OCM + crowd reports. Real freshness signals. Free no-login browse + claim/report accounts. Network/operator hubs + city/corridor pages + public API + HF mirror.

**Census moat.** UNIT = public station (child = port). Sources: DOE AFDC/NREL API (spine), OCM open API, public OCPI feeds, crowd reports. Derived ChargeScore + uptime history. **~350k+ US-only v1 (~5× with global OCM).**

**Design.** Accent `#F59E0B` (electric amber). Mood: transit/infrastructure status board, neutral, freshness-forward. Map-first. North-star: PlugShare UX + Niche/FlightAware score-per-entity rigor.

---

### #5 — WellCheck · Oil & Gas Well Integrity
**Recommended domain:** `wellcensus.com` · alt `plugcensus.com`

**Thesis.** Become the definitive free public census of every US oil & gas well — one page per wellbore (918k+ active, 100k+ orphan), keyed by API-14, cross-linked to operator/county/formation/status. Every state agency already publishes well records but they're locked in 50+ siloed non-SEO portals with no unified national view. The integrity-monitoring/SCADA SaaS ($19.6B TAM, $4.7B federal orphan funds) monetizes on top.

**Competitors & weaknesses.**
- **Enverus** — enterprise-only ($20k-100k+/yr), zero public/indexable pages.
- **State portals** — authoritative source data but 50 dated siloed portals, no national view, no canonical URLs.
- **FracFocus** — only frac-chemical disclosures, PDF-centric, narrow.
- **EDF/USGS Orphan Well Map** — great but orphan-only (ignores the 918k active universe).
- **Mineral Watch** — mineral-owner focus, thin on integrity, partial coverage.

**Our edge.** The ONLY free national fully-indexed well census. One canonical SSR page per API-14 — richest single-well view (operator, lease, dates, formation, status, production sparkline, plugging/integrity flags, FracFocus link, nearby-wells map). Map-first national UX. Operator roll-up pages (Enverus charges five figures; state sites can't produce). Scheduled freshness. Full AEO. Free claim accounts for operators + the $4.7B-funded plugging-contractor industry.

**Census moat.** UNIT = wellbore (API-14). Sources: TX RRC, OK OCC, ND DMR, CA CalGEM, NM OCD, PA DEP + 40 more; USGS DOW; EDF; FracFocus; EPA methane; BLM. **~1M at MVP → 2M-3M nationally.**

**Design.** Accent pump-jack amber `#D98A00` + slate; red for orphan/leak alerts. Mood: Bloomberg-terminal-for-wells / public-records utility. Map-first. North-star: gridcensus mechanics + Enverus depth + EDF orphan map browse.

---

### #6 — KitchenCensus · Commercial Kitchen Equipment Service
**Recommended domain:** `kitchencensus.com` · alt `hoodcensus.com`, `kitchenwrench.com`

**Thesis.** Enumerate every commercial food-equipment service company (HVAC-R / cooking / refrigeration repair) into a free map-first census — one rich page per provider (certs, manufacturer authorizations, service categories, coverage, response-time signals, specialties, reviews) cross-linked to cities + equipment brands. ~10,000 fragmented independents, $28B annual repair spend, 0% centralized tracking — own the "who fixes my walk-in cooler in [city]" layer, then the IoT/predictive-maintenance SaaS sits on top.

**Competitors & weaknesses.**
- **CFESA Service Locator** — only ~548 certified members (94% coverage gap), no map/API, thin listings.
- **86 Repairs** — paid B2B SaaS for operators, not a public directory.
- **Google Maps / Yelp** — no kitchen-specific schema (authorizations, cert level, categories, SLA).
- **simPRO / ServiceTitan** — field-service software sold to providers, no public directory.
- **Inven listicles** — static "Top 24" articles, no per-entity pages or freshness.

**Our edge.** Comprehensive over certified-only: the full ~10,000+ universe (CFESA + Google Places + state licenses + manufacturer authorized-servicer lists). Deepest per-provider data (authorizations, CFESA level, categories, SLA, coverage, reviews, JSON-LD). Map-first browse. Free claimable profiles + restaurant-side equipment registry that hooks the SaaS upsell. Provider ↔ city ↔ brand ↔ category cross-linking. Full AEO.

**Census moat.** UNIT = provider company location (~10k-15k). Sources: CFESA directory, Google Places, state HVAC-R license boards, manufacturer servicer locators (Hobart/True/Rational/Hoshizaki/Manitowoc/Pitco), OSM, Yelp/BBB. **~13k-15k pages.** _(Note: smaller/tighter dataset → effort "M", a faster first ship.)_

**Design.** Accent ember orange `#E8590C`. Mood: industrial-utility, stainless-steel grays, technician-trustworthy. Map-first. North-star: gridcensus + Yelp profile depth + Google Maps radius.

---

### #7 — FleetForward · Municipal EV Fleets
**Recommended domain:** `fleetcensus.com` · alt `fleetwatt.com`, `municensus.com`

**Thesis.** 90,887 US local-gov entities each make independent EV-purchasing/charging decisions with zero coordination layer. Federal money is flooding in ($7.5B NEVI, $5B EPA Clean School Bus). Data is shattered across FHWA/EPA/state DOT/Census of Governments/90k+ procurement portals. Enumerate every local-gov entity into a free indexable census — one page per government showing fleet electrification status, charging sites on a map, every grant won, and peer benchmarks. Convert claimed-profile accounts into the FleetForward subscription funnel.

**Competitors & weaknesses.**
- **EV States NEVI Dashboard** — single non-indexable Tableau/ArcGIS, NEVI-only, 403s crawlers.
- **Atlas EV Hub** — login-gated (invisible to search), aggregated/state-level, not per-government.
- **AFDC / Joint Office tools** — federal calculators/compliance portals, not a directory.
- **DriveEVFleets.org** — procurement portal of pre-competed contracts, not a census.
- **EPA Clean School Bus map** — ArcGIS siloed to school buses only.

**Our edge.** One indexable free page per local-gov entity (90k+) UNIFYING what today's tools silo: fleet composition + charging installs on a map + every grant won, with peer benchmarking and bidirectional government↔vendor cross-links. Per-entity JSON-LD (GovernmentOrganization + Dataset), map-first browse, public read API, free claim-your-profile accounts.

**Census moat.** UNIT = local-gov entity (Census of Governments, 90,887). Secondary: states, vendors, NEVI charging sites. Sources: Census of Governments org file (spine), FHWA/Joint Office NEVI, EV States rows, EPA CSB EDAP, AFDC, NREL, data.gov, NCES EDGE, USAspending.gov. **~110k-120k pages.**

**Design.** Accent `#F4A300` (municipal amber). Mood: civic, authoritative, government-grade. Map-first (choropleth). North-star: gridcensus + USAspending/EPA EDAP feel + a public/indexable Atlas EV Hub map.

---

### #8 — FarmLink · Ag Equipment Telematics
**Recommended domain:** `farmcensus.com` · alt `tractorcensus.com`, `equipcensus.com`, `fleetfora.com`

**Thesis.** Farmers are locked into proprietary OEM data silos (Deere Operations Center, CNH AFS Connect, Climate FieldView). Right-to-repair momentum (FTC v. Deere Jan 2025, 13+ state bills) creates the opening. Build the neutral equipment-knowledge layer FIRST as a free census of every farm-equipment model + telematics/ISOBUS capability + retrofit path. Capture farmer/dealer/mechanic search, convert to claimed-fleet accounts — the wedge for the eventual aggregator.

**Competitors & weaknesses.**
- **TractorHouse / Machinery Pete** — transient for-sale listings (pages die when sold), no telematics data.
- **DataConnect** — OEM-owned, login-walled, thinnest data slice, 4-5 brands only.
- **agrirouter / AEF AgIN** — data middleware for pros, nothing to browse/index.
- **Climate FieldView** — Bayer-owned agronomy product, not an equipment census.
- **TractorData** — closest model census but ancient/ad-choked, no telematics/JSON-LD/freshness.

**Our edge.** Richest, freshest, fully-indexable census of MODELS (permanent URLs, not transient listings) with the one dataset nobody publishes: per-model **telematics capability** (factory telemetry, ISOBUS class, CAN-bus access, data-openness rating, retrofit path). True neutrality, modern SEO/AEO vs TractorData's 2005 tables, free accounts so farmers claim machines into a fleet graph.

**Census moat.** UNIT = equipment model/variant (not listings). Secondary: OEMs, dealers (map), retrofit devices. Sources: TractorData + OEM spec PDFs, AEF ISOBUS conformance DB, OEM telematics pages, dealer locators + Google Places, USDA Census of Ag, right-to-repair filings. **~30k-60k pages.**

**Design.** Accent harvest amber `#E0A82E` + soil-brown `#3B2A1A`. Mood: rugged, field-grade, equipment-documentation feel. **Directory/table-first** (model pages) with secondary map for dealers. North-star: TractorData depth rebuilt with gridcensus discipline.

---

### #9 — StormGrid · Storm Chasers / Severe Weather
**Recommended domain:** `stormcensus.com` · alt `chasercensus.com`, `chaserroster.com`

**Thesis.** The marketplace thesis (credentialed dispatch, $22B weather+insurance TAM) needs hard-to-bootstrap two-sided liquidity. The census de-risks it: enumerate every US storm chaser/spotter (~5,000 active, 10,000+ historical) into a free SEO-optimized public profile directory — one page per chaser, per severe-weather event, per NWS office, per storm market. Become the top organic surface for "storm chaser near me" / "[city] tornado footage" / chaser-name queries; harvest supply (chasers claim profiles) and demand (media/EM/insurer).

**Competitors & weaknesses.**
- **Spotter Network** — real-time coordination tool, profiles not crawlable, no event/archive pages.
- **SevereStudios** — streaming/licensing biz; only paying streamers get a page, thin coverage.
- **StormCenter / LiveStormChasing** — ephemeral live maps; pages vanish post-storm.
- **NOAA SPC / NCEI** — authoritative raw CSV (our ingest source), no landing pages/chaser linkage.
- **StormTrack / r/stormchasing** — unstructured forum/social, no canonical profiles.

**Our edge.** Durable indexable entity pages where everyone is ephemeral or gated. Total coverage (all ~5,000 active + historical). Richest dataset (NOAA events + footage history + equipment/certs + live-stream status + coverage geography). Full AEO (Person/Event/Place JSON-LD). Free claim accounts → the credentialing/dispatch rail the marketplace needs, acquired via organic search. Public API + HF mirror.

**Census moat.** UNIT = chaser (~15k) + 3 supporting layers: events (100k+ via NOAA), storm markets/geography (~3,400), NWS offices (122). Sources: NOAA SPC/NCEI, NWS CWA GIS, Spotter Network callsigns, SevereStudios/LiveStormChasing rosters, StormTrack/Reddit, chaser channels, SKYWARN. **~120k-250k pages.**

**Design.** Accent storm amber `#F59E0B`. Mood: field-ops dark-mode console, NWS-warning palette, radar-sweep accents. Map-first. North-star: RadarScope × gridcensus.

---

### #10 — FireShield · Fire Suppression / Sprinkler Inspection
**Recommended domain:** `firecensus.com` · alt `sprinklercensus.com`, `firesafetycensus.com`

**Thesis.** NFPA 25 sprinkler ITM across ~19,845 US fire-protection contractors operates with zero national data aggregation — records live in 50 state license boards, file cabinets, and walled-garden SaaS. Enumerate every licensed contractor (and where available every jurisdiction/AHJ) into a free SEO/AEO census with license status, NFPA scope, inspection cadence, owner/AHJ cross-links. The $52M building-safety-score / insurance-underwriting business monetizes on top.

**Competitors & weaknesses.**
- **Inspect Point** — walled-garden contractor SaaS, zero public pages.
- **BuildingReports** — compliance-doc tool behind paywalled portals, per-customer.
- **The Compliance Engine (Brycer)** — closed B2G submission pipe, patchy adoption.
- **NFSA / AFSA directories** — members-only fraction, thin data, weak SEO.
- **State fire-marshal lookups** — 50 fragmented POST-form gov portals invisible to crawlers.

**Our edge.** The ONE national free fully-indexable census. Federate all 50 boards + NFSA/AFSA rolls + AHJ lists (~20k vs members-only fractions). Per-contractor + per-jurisdiction static pages with JSON-LD (LocalBusiness + GovernmentService) — own the "fire sprinkler inspection [city]" / "is [contractor] licensed" SERPs the login-walls and POST-forms can't rank for. Deepest public record (license status/expiry, NFPA 13/25 scope, ITM cadence by occupancy). Map-first. Free contractor-claim + owner inspection-tracker flywheel.

**Census moat.** UNIT = licensed fire-protection contractor (~19,845) + secondary AHJ jurisdictions (~3,000) + aspirational owner-claimed buildings. Sources: 50 state boards (FL citizenserve, GA OCI, OH eLicense, TX TDI, CA CSLB C-16), NFSA/AFSA, TCE adoption list, NFPA 25 cadence data, Census/OSM geo, Google Business. **~24k-30k at launch → 80k+.**

**Design.** Accent signal red-orange `#E8442B`. Mood: civic public-safety record/registry, NFPA-document seriousness. Map-first. North-star: gridcensus + OpenCorporates/Regrid registry federation.

---

### #11 — LiftLogic · Elevator Maintenance
**Recommended domain:** `liftcensus.com` · alt `elevatorcensus.com`, `hoistcensus.com`

**Thesis.** Be "the Network of Record for Elevator & Vertical Transport Maintenance" — aggregate 15k+ fragmented technicians, break OEM lock-in (Otis/Schindler/KONE/TK = 55%+ of the $8-10B US service market). Every US elevator already exists in a state/city inspection registry (~900k devices in ~600k buildings). Enumerate device + building + contractor into free indexable pages, cross-link device→building→contractor, surface inspection-freshness + violation flags. The $5M-seed network play sits on top.

**Competitors & weaknesses.**
- **ElevatorAtlas** — the real incumbent (1.89M units), but built for hobbyists, no contractor profiles, minimal schema, no owner-claim/lead-gen.
- **The Elevator Database** — hobbyist solo project, ~10 states, no maps/API/SEO.
- **Angi / Yelp** — generic lead-gen, no equipment/inspection data.
- **NAEC / NAESA directories** — member-gated, no per-company SEO (use as seed).
- **State/city portals** — fragmented across 50+ jurisdictions, no cross-state search, no SEO.

**Our edge.** Beat ElevatorAtlas on PURPOSE + structure: three cross-linked census layers (device → building → contractor) where the contractor is a first-class claimable SEO page. Richest per-page data (manufacturer/installer/drive/capacity/last-inspection/violation flags + benchmark contract estimate). Full pSEO/AEO stack ElevatorAtlas lacks. **Freshness as a feature** — flag overdue inspections (the exact owner query). Free claim accounts (contractors + owners) + public API + HF mirror.

**Census moat.** UNIT = device (jurisdiction permit #), nested under buildings, cross-linked to contractors. Sources: NYC DOB NOW, FL DBPR, OH ICSearch, MD county XLS + CA/CO/CT/MA/NC/TX/PA; NAEC/NAESA + license registries for contractors. **~150k-300k from first 8-10 states → 1.5M+ at full coverage.**

**Design.** Accent signal amber `#F5A623` (hall-call / inspection-tag). Mood: industrial-civic public-records utility, inspection-status pills (green/amber/red). Map-first. North-star: ElevatorAtlas UX bar + gridcensus pSEO machine.

---

### #12 — SolarScore · Residential Solar Installers
**Recommended domain:** `panelcensus.com` · alt `installerscore.com`, `wattcensus.com`, `sunscorecard.com`

**Thesis.** The US residential solar installer market is structurally fragmented (top 3 = ~21% share, 70%+ subcontracted) with NO standardized public record of installer quality — acute for the $15B/yr solar-lending market and the post-ITC TPO shift. Regulatory tailwind (CFPB 2024 spotlight, MN AG suit). Enumerate every installer into a free fully-indexed profile, seed quality scoring from public data, capture the homeowner-researching flood. Lender-underwriting subscriptions + data licensing is the revenue layer. _(This is the next-up sibling to gridcensus per the playbook — `panelcensus.com`.)_

**Competitors & weaknesses.**
- **EnergySage** — gated marketplace, only joined installers, thin rural, marketplace-tier "score."
- **SolarReviews** — star-review-ranked, sparse for the long tail, no install/price data.
- **Angi** — generic lead broker, no solar-specific quality signal.
- **NABCEP Directory** — cert lookup of individuals, no company profiles/scores (ingest as credential layer).
- **LBNL Tracking the Sun** — richest underlying data (4.5M systems) but static research CSV (our primary ingest source).

**Our edge.** The COMPLETE census, not a gated marketplace — derive the full installer universe from LBNL's 4.5M systems. One JSON-LD profile per installer with the deepest public dataset (install volume by year, median size + price, service geography heat-map, NABCEP creds, license + complaint records, reviews, transparent published **SolarScore**). Map-first hubs catch "best solar companies near me" (given away free vs incumbents' lead-gen). Full AEO + public API/HF mirror. Free claim flywheel; lender-grade underwriting export is the paid layer.

**Census moat.** UNIT = installer company + geo hubs + NABCEP pros (cross-linked). Sources: LBNL Tracking the Sun (backbone), NABCEP, state license boards (CSLB), state interconnection datasets (CA NEM, NY-Sun), BBB/Google/SolarReviews, SEIA/Wood Mac rankings, FTC/CFPB/AG actions. **~50k-70k pages → 100k+.**

**Design.** Accent solar amber `#F59E0B` + slate-navy. Mood: Carfax/credit-bureau trust for solar, data-dense, regulatory-grade. Map-first. North-star: Carfax × Zillow with research-dataset depth.

---

### #13 — MedService · Medical Imaging Equipment Service (ISOs)
**Recommended domain:** `imagingcensus.com` · alt `scannercensus.com`, `servicecensus.com`

**Thesis.** OEMs (GE/Siemens/Philips) control 70%+ of medical-equipment service at 2-3× fair rates; health systems waste $5-10B/yr. ~2,000 fragmented ISOs already serve 64% of hospitals (third-party share 36%→50% since 2019) but are invisible. Build the public census of every imaging-service ISO + every imaging facility/installed asset — the data layer that breaks OEM pricing lock-in by making the independent market findable, comparable, credentialed. The ISO-network capex business monetizes; the census feeds demand.

**Competitors & weaknesses.**
- **TechNation Buyers Guide** — vendor-submission-only (~250 listings), pay-to-play, no SEO pages/maps.
- **Block Imaging** — single operator's own marketing site (proves the SEO opportunity, leaves the slot open).
- **MXR / DirectMed / Agiliti** — the ISOs themselves, market only their own services.
- **MedicalsDir** — stale, ugly, lead-gen-paywalled generic listings.
- **FDA Establishment search** — authoritative raw source but brutal gov UI (caps at 100, no maps/SEO).

**Our edge.** The single neutral free fully-indexed census. COMPLETE coverage via the openFDA registration/listing API (every registered service establishment by imaging product code — not vendor self-submission). Deepest per-entity page (FDA status, product-code coverage, ISO 13485/9001 certs, footprint, owner/operator cross-links, quality scorecard). Map-first geographic discovery. **Two-sided** — cross-link the installed base (NPI + ACR accreditation) to the ISOs that can serve them. Free claim-your-listing flywheel. Full AEO.

**Census moat.** UNIT = ISO/FDA-registered service establishment + 2nd unit = imaging facility/asset location. Sources: openFDA device registration/listing API (free monthly bulk), FDA owner/operator linkage, ISO cert registries, NPPES NPI, CMS ACR-accredited lists, state registrations. **~50k-80k pages → 150k+.**

**Design.** Accent signal orange-red `#E8552D` + clinical near-black. Mood: clinical-precision instrument panel, status badges (in-service/decertified/OEM-locked). Map-first. North-star: OpenCorporates census + Zillow/Yelp locator.

---

### #14 — BuildingCensus · Commercial HVAC / Building Automation
**Recommended domain:** `buildingcensus.com` · alt `hvaccensus.com`, `bascensus.com`, `retrofitcensus.com`

**Thesis.** BuildingIQ's premise is breaking proprietary BAS vendor lock-in and aggregating ~15,000 fragmented HVAC servicers. The pSEO flip: enumerate every large US commercial building (abundant AND data-rich via energy-benchmarking disclosure laws), and on each page expose energy/emissions grade, compliance-penalty exposure (LL97/BERDO/BEPS/AB802), the BAS vendor controlling it, and nearby servicers. The building is the indexable atom; contractors + BAS vendors are cross-link layers. Captures owners ("is my building LL97 compliant"), FMs ("HVAC contractor [city]"), and ESG/retrofit firms at once.

**Competitors & weaknesses.**
- **DOE Building Performance Database** — 1M+ records but de-identified/aggregated, no addressable pages.
- **HVACinformed Directory** — ~506 thin listings, no maps/timestamps.
- **NYC Accelerator LL97 Calculator** — single-city, calculator-not-corpus.
- **Angi / Thumbtack** — residential-DNA marketplaces FMs don't use.
- **GlobalSpec BAS directory** — buried lead-gen UX, no per-building context.

**Our edge.** Three structural advantages: (1) **FUSION** — nobody joins building-level disclosure WITH a contractor directory WITH BAS-vendor lock-in mapping. (2) **ADDRESSABILITY** — re-identify DOE's de-identified data + unify ~40 BPS jurisdictions into one named/mapped/indexable page per building with a real penalty hook. (3) **FRESHNESS + CLAIM FLYWHEEL** — annual disclosure cycles give honest dateModified; claim-your-building (owners) + claim-your-company (contractors) seed the two-sided moat. Full JSON-LD vs incumbents' thin/no schema.

**Census moat.** UNIT = commercial building + 2 secondary units (HVAC servicers, BAS vendors). Sources: DOE BPD, NYC LL84/LL97, DC BEPS, CA AB802, Boston BERDO, Seattle/Chicago/Denver/St. Louis/Philly/WA (~40 jurisdictions), EPA ENERGY STAR, county assessors, OSM footprints, ACCA/NATE + license boards + Tridium/OEM partner-locators. **~60k v1 (NYC+CA+DC+Boston) → 300k-600k at maturity.**

**Design.** Accent signal orange `#E8552D`. Mood: civic-data utility with compliance-dashboard edge, monospace numerals, blueprint texture. Map-first. North-star: Zillow-for-buildings (penalty estimate = the "Zestimate"), NYC Energy Snapshot depth, gridcensus flywheel.

---

### #15 — FleetPulse · Fleet / Truck Repair Shops
**Recommended domain:** `shopcensus.com` · alt `rigcensus.com`, `rigrepair.com` (`fleetcensus.com` reserved for #7)

**Thesis.** The original FleetPulse plan is vertical SaaS/telematics; the pSEO re-cut is the wedge. 150,000+ independent US truck-repair shops are fragmented and hard to find — that fragmentation IS the SEO opportunity. Build the definitive free census of every commercial-truck/fleet repair shop (services, truck classes, brands, 24h road service, mobile flag, bay count, towing, DOT inspection). Capture huge breakdown-emergency search ("semi truck repair near me", "24 hour truck repair I-80"), convert owners with free claim accounts. The directory is the lead-gen funnel for the eventual telematics/credentialing network.

**Competitors & weaknesses.**
- **NTTS Breakdown Directory** — 1989 printed-book DNA, pay-to-list ($2,400-$10k+), outdated numbers.
- **Find Truck Service** — ~30k listings, tiered pay-to-list, thin templated city pages.
- **TruckDown** — 1997 legacy UI, advertiser-skewed, minimal SEO/AEO.
- **Fleetio Marketplace** — gated integration partner set, not a census.
- **Google Maps** — no truck-specific structured fields (truck classes, road-service radius, after-hours).

**Our edge.** Beat incumbents on completeness, freshness, structure, and openness simultaneously. Full 150k+ universe (OSM + state registries + Google Places + FMCSA/DOT + seed sets — not just advertisers). Richest schema (AutoRepair JSON-LD, truck classes, brands/engines, 24h road-service flag, mobile radius, bay count, DOT inspection, dateModified). Map-first with route-corridor browse (shops along I-80). Genuinely free + public API/export (opposite of pay-to-list). Owner-claim flywheel → credentialed-network/telematics upsell.

**Census moat.** UNIT = repair shop/service location. Secondary: FMCSA carriers, states, cities, Interstate corridors. Sources: OSM (truck_repair/truck_stop), Google Places, state SoS registries, FMCSA SAFER + inspection data, DOT inspection stations, OEM dealer locators, NTTS/FTS/TruckDown seed scrapes, Yelp/GBP. **~180k-200k pages.**

**Design.** Accent safety-orange / hi-vis amber `#F97316` (diesel hazard-stripe). Mood: rugged industrial, road-sign clarity, fast roadside-on-phone. Map-first. North-star: gridcensus + Google Maps roadside utility + trucking-app corridor browse.

---

### #16 — RoboServ · Industrial Robotics Service
**Recommended domain:** `servocensus.com` · alt `armcensus.com`, `fleetservo.com`, `roboservhq.com`

**Thesis.** The $22.5B global robotics-service market (SAM $6.2B NA) is gatekept by four OEMs (Fanuc/ABB/KUKA/Yaskawa) who restrict parts/diagnostics. ~382,000 robots installed in US plants; ~5,000+ independent automation techs are fragmented with no central index. Enumerate every independent robot-service provider (+ the installed-robot base) into a free SEO/AEO census, then free claim accounts build the two-sided dispatch/marketplace moat. Capture "FANUC R-2000 repair near me" / "KUKA KR210 service company Ohio."

**Competitors & weaknesses.**
- **Robo Reliance** — single-company 1099 network, no per-provider/region pages.
- **T.I.E. Industrial** — vendor marketing site, no comparison/map.
- **A3/RIA Certified Integrators** — integrators (system-build) not service, members-only, no indexable pages.
- **GlobalSpec** — 2000s catalog aggregator, no model granularity/freshness.
- **GES Repair** — component-repair vendor page, single-location footprint.

**Our edge.** The only COMPLETE free map-first census of independent robot-service providers cross-linked to the robots they service. Coverage (all 5,000+ independents vs a few hundred curated), granularity (per-provider AND per-robot-model pages), geography (map-first "repair near me"), freshness, AEO (Dataset/LocalBusiness/Service JSON-LD), and free claim accounts that turn a static directory into the live availability + dispatch layer RoboServ monetizes.

**Census moat.** PRIMARY UNIT = robot-service provider (~5,000+) + secondary robot model/family (~300-500) + geo hubs. Sources: A3/RIA lists, GlobalSpec/RoboticsTomorrow directories, Google Business Profile API (already authorized), OEM authorized-partner lists, robot-forum data, state registries, IFR installed-base stats, OEM spec sheets. **~6k-8k at launch → ~15k.**

**Design.** Accent safety-orange `#FF6A1A` (robot-caution). Mood: heavy-industry precision, graphite/steel, blueprint-grid, plant-equipment feel. Map-first. North-star: Carbon-style map directory + G2/Crunchbase entity depth + gridcensus.

---

### #17 — DataPulse · Data Center Infrastructure
**Recommended domain:** `dccensus.com` · alt `colocensus.com`, `datacentercensus.com`, `wattcensus.com`

**Thesis.** "PowerOutage.us for data centers" — a unified intelligence layer over a market where 70%+ of cloud infra is invisible. The full vision (telemetry + capacity marketplace + REIT/lender dashboards) needs facility-side integrations we can't get day one. The census carves the WEDGE: enumerate every NA/EU data center into a free indexable per-facility page with the richest public dataset (operator, location, power MW, PUE, cooling, build status, connectivity, certs, and a DataPulse Reliability Score from public incident history). Then upsell the marketplace + finance products.

**Competitors & weaknesses.**
- **Data Center Map** — largest (11,783) but shallow, lead-gen, stale, weak per-facility SEO.
- **Baxtel** — good map UX but a lead funnel; sparse pages, no standardized score.
- **dcmap.us** — strong US dataset but US-only, no reliability dimension, no claim flywheel.
- **usdatamap.com** — only ~800 facilities, placeholder freshness, no depth/API.
- **SemiAnalysis Datacenter Model** — authoritative but hard-paywalled spreadsheet, zero free SEO.

**Our edge.** Beat them on four axes each misses: (1) DEPTH per entity (power MW, PUE, cooling, Uptime Tier/SOC2, connectivity, status, + public-source **Reliability Score**). (2) **INCIDENT LAYER** — ingest public outage/incident history so each facility/operator carries a freshness-stamped track record ("PowerOutage.us for DCs"). (3) AEO — own the long-tail ("Equinix DC11 Ashburn power capacity", "colocation Phoenix Tier III"). (4) FREE + claim flywheel. Table/filter-rich for power-buyers + map-first.

**Census moat.** UNIT = data center facility + operator + metro hubs + incident records. Sources: dcmap.us, PNNL Data Center Atlas (free gov), PeeringDB (open API — highest-leverage), OSM, FERC/utility interconnection queues, operator status pages, Uptime Tier lists, SEC/REIT filings, EIA power. **~12k-15k entity pages → 30k+.**

**Design.** Accent signal orange `#F25C2A` (rack-LED glow). Mood: NOC dashboard / Bloomberg-terminal-for-DCs, dark slate, status palette, monospace metrics. Map-first. North-star: PowerOutage.us × Baxtel map × SemiAnalysis-grade dataset + gridcensus flywheel.

---

### #18 — AquaTrack · Water Utility Infrastructure
**Recommended domain:** `pipecensus.com` · alt `aquacensus.com`, `tapcensus.com`, `utilitycensus.com`

**Thesis.** "PowerOutage.us for water infrastructure." 148,000+ US public water systems (~51,000 community) on 45+ year-old pipes losing ~19.5% of treated water ($6.4B+/yr non-revenue water), a main break every 2 minutes, 9M+ EPA-mandated lead service lines. Hyper-fragmented; data buried in clunky gov databases. Enumerate every public water system into a free indexable census page (SDWIS inventory, ECHO violations, lead-line inventory, water-loss metrics, system age, source, population, operator cross-links) — the canonical SEO/AEO public record. Upsell SaaS analytics/benchmarking/compliance to utilities + contractors.

**Competitors & weaknesses.**
- **EPA SDWIS / EnviroFacts / ECHO** — authoritative raw source, 1990s form-driven UX, no per-utility pages, zero SEO.
- **AWWA Benchmarking** — aggregate-only/confidential, paywalled PDF, no per-utility pages.
- **IBNET** — global/developing-world focus, sparse/stale, clunky.
- **reqodata** — a vendor/tech directory, not a utility/asset census.
- **Smart Water Analytics / Bynry / Waterly** — closed B2B SaaS (the eventual upsell target).

**Our edge.** The only FREE fully-indexable cross-utility public record. Coverage (one page per system, 148k+, from EPA's own free APIs). SEO/AEO targeting "[city] water utility", "lead pipes in [zip]", "[utility] violations" — long-tail with real volume and zero good answers today. Map-first national choropleth (water loss / system age / violations / lead risk). Cross-links (operator → parent → portfolio). Nightly re-sync vs AWWA's annual PDF. Contributor flywheel.

**Census moat.** UNIT = public water system (PWSID key, ~148k; ~51k rich CWS). Secondary: parent operators (~500), county/state rollups. Sources: EPA SDWIS via EnviroFacts API, EPA ECHO SDWA, EPA Service Line Inventory / Lead & Copper, Census/TIGER, USGS water-use, state PUC filings. All free/federal. **~150k-155k pages.**

**Design.** Accent deep-water indigo `#1E3A8A` + copper/rust `#B45309` (pipes/aging). Mood: civic-infrastructure authority, public-record feel, monospace numerics. Map-first. North-star: PowerOutage.us / EPA ECHO map + ProPublica data explorers + Zillow polish.

---

### #19 — ParkCensus · Parking Structure Condition
**Recommended domain:** `garagecensus.com` · alt `parkcensus.com`, `deckcensus.com`, `structurecensus.com`

**Thesis.** 100,000+ US parking structures are aging out (1960s-80s builds hitting 40-50yr lifecycles) with $8B+ deferred maintenance and ZERO public condition tracking. Post-Champlain-Towers liability + REIT transparency demands are forcing first-time condition documentation. Yet no public census of structures-as-assets exists — consumer apps track availability/price for DRIVERS, never structural health for OWNERS. Enumerate every structure into a free map-first census page (construction era, deck type, replacement value, condition signals) + cross-linked restoration contractors/engineers per market. The $3M-seed condition-tracking SaaS sits on top.

**Competitors & weaknesses.**
- **Parkopedia** — driver-facing availability/price only, paywalled B2B API, no condition data.
- **SpotHero** — pure booking marketplace (~14k locations), no condition/capital data.
- **SafeGraph Parking Lots** — sells polygon geometry to data teams, no human-browsable pages.
- **IPMI / NPA** — trade bodies, no public structure-level inventory/condition DB.
- **Engineering/restoration firms** — brochure sites holding proprietary client data only.

**Our edge.** Build the asset layer no one owns: one free SEO/AEO map-first page for EVERY structure (not just bookable ones), keyed to the OWNER's view — era, structural system (post-tensioned/precast/cast-in-place), levels, replacement value, restoration history, and condition signals scraped from municipal inspection mandates (NYC LL126, FL SB-4D, Chicago). Cross-link to nearby restoration contractors + structural engineers with claimable profiles + benchmark pricing — the neutral comparison the brochure incumbents won't publish. Free, fast, Dataset JSON-LD + llms.txt. Claim flywheel → the paid condition-tracking + reserve-modeling SaaS.

**Census moat.** UNIT = parking structure + secondary contractors/engineers + metro hubs. Sources: OSM (parking=multi-storey), SafeGraph/Overture geometry, data.gov + city portals (~16k already catalogued), municipal mandated-inspection registries (LL126, SB-4D, Chicago), county assessors, Google Places (READ via shared OAuth), IPMI/NPA + license boards. **~120k-140k pages.**

**Design.** Accent safety-amber `#F5A623` (inspection-tape). Mood: industrial-civic asset-management dossier, concrete-grey, condition-grade chips (A-F). Map-first. North-star: gridcensus clarity + structural-inspection-report dossier feel + Zillow (structure-as-asset).

---

## 5. Prioritized Launch Sequence

All 19 are tagged "next" in the research, and 18 of 19 are large-effort ("L") on data ingestion — but the net-new code per property is small (the engine is ~90% reusable). The real sequencing lever is **(a) ingest tractability + dataset cleanliness, (b) organic-search demand, and (c) proximity to the proven gridcensus pattern.** Group as:

### NOW (highest opportunity × cleanest ingest — build first, in parallel)
These have the single cleanest authoritative public spine, the strongest "front-runs a real capex thesis" story, and either smaller datasets (fast ship) or near-identical-to-gridcensus mechanics.

| Order | Vertical | Domain | Why now |
|---|---|---|---|
| 1 | **#12 Solar Installers** | panelcensus.com | The explicit next-up sibling per the playbook; LBNL Tracking the Sun is a single clean 4.5M-row spine; regulatory tailwind; lender-monetization is real. |
| 2 | **#6 Kitchen Equip Service** | kitchencensus.com | Only "M" effort — smallest dataset (~13-15k pages), Google Places + CFESA ship fast. A quick win to validate the cross-vertical engine. |
| 3 | **#3 Cell Towers** | towercensus.com | FCC ASR/ULS is a clean federal bulk download; high-intent "tower near me" search; out-opens the paywalled Inside Towers. |
| 4 | **#4 EV Charging** | chargecensus.com | DOE AFDC/NREL API is the gold-standard clean spine; massive high-intent reliability search; map-first is a perfect fit. |

### NEXT (strong opportunity, heavier or multi-source ingest — second wave, parallelizable)
Clean-enough sources but more normalization (50-state federation or facility-side joins).

| Order | Vertical | Domain | Note |
|---|---|---|---|
| 5 | **#18 Water Utilities** | pipecensus.com | EPA SDWIS/ECHO APIs are clean federal; 148k systems; strong civic-data SEO. |
| 6 | **#5 Oil & Gas Wells** | wellcensus.com | API-14 is a great join key but 50 state agencies + 1M+ rows = heavy ingest; huge page count. |
| 7 | **#7 Municipal EV Fleets** | fleetcensus.com | Census-of-Governments spine is clean; grant-data joins add work; strong vendor/grant cross-links. |
| 8 | **#17 Data Centers** | dccensus.com | PeeringDB + PNNL Atlas are clean opens; incident-layer ingest is the differentiator + the effort. |
| 9 | **#1 ADAS Calibration** | adascensus.com | Rich per-location dataset but heavy multi-source enrichment (no single spine). |
| 10 | **#2 Backup Power** | powercensus.com | 50-state license boards + Shovels permits; the resilience-map layer is novel but adds scope. |
| 11 | **#13 Medical Imaging ISOs** | imagingcensus.com | openFDA API is clean; two-sided facility join (NPI/ACR) adds work. |

### LATER (great theses, hardest ingest / niche demand / dependent on scraping awkward portals)
Worth building, but each has a friction point: contractor-license federation, municipal-permit scraping, or thinner/niche search demand.

| Order | Vertical | Domain | Friction |
|---|---|---|---|
| 12 | **#10 Fire Suppression** | firecensus.com | 50 fire-marshal POST-form portals; ~24-30k pages; smaller-but-fiddly. |
| 13 | **#11 Elevators** | liftcensus.com | Per-jurisdiction device registries (NYC/FL/OH/MD…), big payoff but state-by-state grind. |
| 14 | **#14 Commercial HVAC/BAS** | buildingcensus.com | ~40 BPS disclosure jurisdictions to federate; re-identification work; high reward. |
| 15 | **#15 Truck Repair Shops** | shopcensus.com | OSM/Places-heavy (noisy), 150k+ shops; strong demand but data-cleaning intensive. |
| 16 | **#8 Ag Equipment** | farmcensus.com | Spec-PDF + telematics-capability data is bespoke/hand-assembled (the unique-but-slow dataset). |
| 17 | **#16 Robotics Service** | servocensus.com | Smallest demand + provider universe (~5-8k pages); niche but cheap — could slot earlier as a fast filler. |
| 18 | **#9 Storm Chasers** | stormcensus.com | NOAA events are clean but the chaser roster is scrape-heavy/social; seasonal demand. |
| 19 | **#19 Parking Structures** | garagecensus.com | Condition data depends on awkward municipal-mandate scraping; structure enumeration from OSM/Overture is noisy. |

**Parallelization.** Because each property is its own Supabase + Vercel + domain and shares ~90% of the code, **3-4 can be built concurrently** once the shared engine is templated. Suggested cadence: ship NOW group as a batch of 4 (validate the templated engine + cross-vertical claim/auth/AEO once), then run NEXT and LATER as rolling waves of 3-4. The first NOW build (panelcensus) doubles as the template-hardening pass; every subsequent property is a data binding + a domain + a brand.

---

## 6. What Kenny Does Next

1. **Approve the domain picks** (Section 3 table). Confirm the `fleetcensus.com → #7` vs `shopcensus.com → #15` collision resolution, or reassign.
2. **Approve the launch sequence** (Section 5) — or re-rank by gut/strategic priority. Easiest path: greenlight the **NOW group of 4** (panelcensus, kitchencensus, towercensus, chargecensus) to start.
3. **Approve the design directions** (per-vertical accent + map-first + north-star). Each will get 2-3 live brand mockups (`/preview/brand-<name>` with real data) before the logo is committed — but sign off on the signature accent colors now so none drift toward the AI-default cyan.
4. **Register the .coms** for the approved set (Cloudflare; apex A → Vercel anycast, www → cname.vercel-dns.com, DNS-only). Register the NOW group immediately; the rest can be registered wave-by-wave to avoid carrying-cost on properties that may get re-prioritized.
5. **Provision per-property infra** — one Supabase project + one Vercel project per property (Kenny's stored Google OAuth token already covers Search Console + Places READ across all his sites; no re-auth needed per `memory/google-api-access.md`).
6. **Then I build them in parallel** — template the shared gridcensus engine once, then bind data + brand + domain per property, ship through the compliance gate, verify in GSC, wire the autonomous SEO loop, and let organic traction pick the winners to monetize.

---

_Engine reference: `memory/data-property-playbook.md` (the 9-stage system + every hard-won gotcha). Worked example: `memory/gridscout-megawattsite-pseo.md` (gridcensus.com). Google access: `memory/google-api-access.md`._
