# SolarTrack: Data Coverage Analysis
## Free Sources vs. SEIA ($1K/yr) vs. Ohm Analytics ($30K/yr)

*Generated February 11, 2026*

---

## Current Database State (Free Sources Only)

| Metric | Count |
|--------|-------|
| **Total installations** | 260,426 |
| **Total equipment records** | 351,557 |
| **Total events** | ~2M (storm damage, recalls, generator changes) |
| **Primary data sources** | 16 |
| **Enrichment sources** | 12+ |
| **Municipal permit portals** | 23 cities |

### Installation Field Coverage

| Field | Count | Coverage | Primary Sources |
|-------|------:|----------|-----------------|
| state | 260,425 | 100.0% | All sources |
| site_type | 260,426 | 100.0% | All sources |
| site_status | 260,426 | 100.0% | All sources |
| county | 255,421 | 98.1% | Source data + city/state derivation |
| city | 244,700 | 94.0% | Source data + reverse geocoding |
| location_precision | 221,669 | 85.1% | Computed (running to 100%) |
| install_date | 204,686 | 78.6% | TTS, EIA-860, CA DGStats, NY-Sun, permits |
| zip_code | 206,929 | 79.5% | Source data + geocoding |
| installer_name | 185,821 | 71.4% | TTS, CA DGStats, NY-Sun, permits |
| address | 183,606 | 70.5% | Reverse geocoding, source data, cross-ref |
| capacity_mw | 166,468 | 63.9% | All primary sources |
| lat/lng | 121,907 | 46.8% | Source coords + ZCTA centroids |
| operator_name | 101,397 | 38.9% | EIA-860, eGRID, TTS utility, OSM, GEM |
| owner_name | 85,209 | 32.7% | WREGIS, EIA-860, eGRID, cross-ref, PJM-GATS |
| mount_type | 58,161 | 22.3% | NREL satellite classification + source data |
| developer_name | 6,730 | 2.6% | ISO queues, LBNL Queued Up |

### Equipment Field Coverage

| Field | Count | Coverage |
|-------|------:|----------|
| manufacturer | 335,096 | 95.3% |
| model | 200,888 | 57.1% |
| CEC specs (JSONB) | 87,568 | 24.9% |
| module_wattage_w | 58,011 | 16.5% |

---

## What SEIA Major Projects List Would Add

**Cost**: ~$1,000/year (SEIA membership)
**Source**: Solar Energy Industries Association Major Solar Projects List
**URL**: seia.org/research-resources/major-solar-projects-list

### Data Content

SEIA maintains the most comprehensive list of **utility-scale and large commercial** solar projects in the US. The dataset includes:

- **7,000+ projects** with detailed metadata
- **Developer name** for nearly every project (the single hardest field to source for free)
- **Owner name** (asset owner, often different from developer)
- **Offtaker / PPA buyer** (exclusive to SEIA -- unavailable in any free source)
- **EPC contractor** (engineering, procurement, construction firm)
- **Project capacity** (MW DC and AC)
- **Location** (state, county, sometimes coordinates)
- **Technology** (crystalline silicon, thin-film, tracker type)
- **Status** (operating, under construction, announced)
- **COD** (commercial operation date)

### Impact on SolarTrack

| Field | Current | With SEIA | Delta |
|-------|---------|-----------|-------|
| developer_name | 2.6% (6,730) | ~12-15% (+5,000-7,000) | **+4.6x coverage** |
| owner_name | 32.7% (85,209) | ~35-38% (+5,000-7,000) | Fills utility-scale gaps |
| operator_name | 38.9% | ~40-42% | EPC/operator overlap |
| Offtaker/PPA buyer | 0% | ~3-5% (utility-scale only) | **Entirely new field** |

### Why SEIA is Uniquely Valuable

1. **Developer names are nearly impossible to source for free.** Our 2.6% coverage comes entirely from ISO interconnection queues (which only cover proposed/pending projects) and LBNL Queued Up. SEIA covers operating projects with verified developer attribution.

2. **Offtaker data exists nowhere else for free.** Knowing who is buying the power (utility, corporate PPA, community choice aggregator) is critical for understanding the commercial relationships around each site. This field cannot be approximated from any public data source.

3. **EPC contractor names** fill a gap between our installer data (which covers distributed solar installers from TTS/CADG) and utility-scale construction firms. These are different companies entirely -- SunPower installs rooftop; McCarthy or Blattner builds utility farms.

4. **Cross-reference value**: SEIA project names can be matched to our EIA-860 and USPVDB records to fill multiple fields simultaneously on the highest-value sites in the database.

### ROI Assessment

**Extremely high.** At $1,000/year, SEIA is the single most cost-effective paid source available. Developer_name jumps from near-zero to meaningful coverage for utility-scale. The offtaker field is genuinely exclusive -- no amount of free scraping or API access can replicate it.

**Recommendation: Purchase immediately.** The data would take less than a day to ingest via a cross-reference script matching on project name + state + capacity to existing records.

---

## What Ohm Analytics Would Add

**Cost**: ~$30,000/year (subscription)
**Source**: Ohm Analytics Solar Intelligence Platform
**URL**: ohmanalytics.com

### Data Content

Ohm Analytics maintains the most comprehensive **distributed solar equipment database** in the US. Their data covers:

- **500,000+ residential and commercial installations** with equipment details
- **Panel manufacturer and model** per installation (the exact data Blue Water Battery needs for equipment sourcing)
- **Inverter manufacturer and model** per installation
- **Installer company** per installation
- **Installation date** and **system size**
- **Location** (address-level for most records)
- Coverage across **3,000+ municipal jurisdictions** (vs. our 23 cities)

### How Ohm Sources Their Data

Ohm's methodology consists of three pillars (in order of importance):

1. **Building permit scraping** (~40-50% of their data)
   - Solar building permits require listing panel/inverter manufacturer and model
   - Ohm scrapes permits from ~3,000 municipal portals nationwide
   - This IS replicable (we do it for 23 cities), but matching their scale would require 100x more portal integrations

2. **Monitoring platform partnerships** (~30-40% of their data)
   - Enphase and SolarEdge fleet data (through data partnerships)
   - Monitoring platforms know exact equipment installed at every connected site
   - **This CANNOT be replicated for free** -- requires commercial data-sharing agreements

3. **Installer data partnerships** (~10-20% of their data)
   - Solar companies share project details in exchange for platform access
   - Similar to how Zillow gets MLS data via agent relationships
   - **This CANNOT be replicated for free** -- requires a marketplace/platform business model

### Impact on SolarTrack

| Field | Current | With Ohm | Delta |
|-------|---------|----------|-------|
| Equipment per site | 43.1% (sites with equip) | ~90%+ | **2x coverage** |
| equip.manufacturer | 95.3% (of equip records) | ~98%+ | Marginal improvement |
| equip.model | 57.1% (of equip records) | ~85%+ | **+50% improvement** |
| installer_name | 71.4% | ~85-90% | +15-20% coverage |
| address | 70.5% | ~80-85% | +10-15% coverage |

### What We CAN Replicate (and Already Have)

| Ohm Capability | Our Replication | Coverage Gap |
|----------------|-----------------|--------------|
| Permit scraping (23 cities) | `ingest-permits.py` | 23 vs ~3,000 cities |
| Equipment from permits | `parse-permit-equipment.py` | 1,063 equip vs ~200K+ |
| Installer names | TTS + CADG + permits | 71.4% vs ~90% |
| System size | All primary sources | 63.9% vs ~95% |
| Satellite mount type | NREL Panel-Segmentation | 22.3% vs N/A (Ohm doesn't do this) |

### What We CANNOT Replicate

1. **Monitoring platform integrations**: Enphase and SolarEdge fleet data contains exact panel/inverter models for millions of sites. These companies will not share data without a commercial partnership agreement and significant user base to offer in return.

2. **Installer data partnerships**: Solar installation companies share project data with Ohm in exchange for market intelligence. Building this two-sided marketplace requires a product that installers want to use.

3. **Coverage scale**: Scaling our permit scraper from 23 to 3,000 cities would require:
   - Researching 3,000+ municipal data portals
   - Building custom parsers for dozens of portal platforms (Socrata, ArcGIS, Accela, OpenGov, etc.)
   - Maintaining connections as APIs change
   - Estimated effort: 6-12 months of full-time engineering

### ROI Assessment

**Moderate to low, depending on use case.** At $30,000/year, Ohm is only worth it if Blue Water Battery needs near-complete equipment-per-site data for **distributed** solar (25 kW - 1 MW). For **utility-scale** sites (>1 MW), our existing EIA-860 + USPVDB + LBNL coverage already provides 95%+ of equipment data.

The key question: How many of Blue Water Battery's sales leads come from distributed solar vs. utility-scale?

- If primarily utility-scale: **Skip Ohm.** Our data is already comprehensive for these sites.
- If distributed solar is important: **Consider Ohm.** The monitoring platform data is genuinely irreplaceable.
- If budget-constrained: **Expand permit scraping first.** Adding 50-100 more cities to `ingest-permits.py` would close ~20% of the gap at zero cost.

---

## Coverage Gap: Free vs. Paid

| Capability | SolarTrack (Free) | +SEIA ($1K) | +Ohm ($30K) | +Both ($31K) |
|------------|-------------------|-------------|-------------|--------------|
| **Total sites** | 260,426 | Same | ~300-350K | ~300-350K |
| **Site count (utility)** | ~34,271 | Same | Same | Same |
| **Site count (commercial)** | ~226,155 | Same | ~266-316K | ~266-316K |
| **capacity_mw** | 63.9% | ~65% | ~75% | ~76% |
| **install_date** | 78.6% | ~79% | ~85% | ~86% |
| **owner_name** | 32.7% | ~36% | ~38% | ~42% |
| **developer_name** | 2.6% | **~13%** | ~5% | **~15%** |
| **installer_name** | 71.4% | Same | ~85% | ~85% |
| **operator_name** | 38.9% | ~41% | ~42% | ~44% |
| **Offtaker/PPA** | 0% | **~4%** | 0% | **~4%** |
| **Equipment per site** | ~43% | Same | **~90%** | **~90%** |
| **equip. model** | 57.1% | Same | ~85% | ~85% |
| **mount_type** | 22.3% | Same | Same | Same |
| **Storm damage events** | ~188K sites | Same | Same | Same |
| **Recall tracking** | 3,113 sites | Same | Same | Same |

---

## Recommendation

### Tier 1: Buy Now ($1,000/year)

**SEIA Major Projects List** -- The single best investment for SolarTrack.

- Developer names jump from 2.6% to ~13% (the hardest free field by far)
- Offtaker/PPA buyer is an entirely new, exclusive data dimension
- Cross-references cleanly with existing EIA/USPVDB records
- Ingestion effort: 1 day (write cross-reference script)
- ROI: **$1,000 for data that would take months to source otherwise**

### Tier 2: Expand Free Sources First ($0)

Before considering Ohm, extract more value from free sources:

1. **Census Batch Geocoder** (when API recovers): +97,420 addresses geocoded, lat/lng from 46.8% to ~70%+
2. **Satellite classification batch 3**: mount_type from 22.3% to ~40%+
3. **More permit cities** (50-100 cities): equipment coverage +10-15%, installer coverage +5-10%
4. **PJM API key** (free registration): Developer names for ~1,500+ PJM queue projects
5. **SEIA data ingestion**: Developer/owner enrichment for 7K+ utility-scale sites

### Tier 3: Consider If Distributed Solar is Critical ($30,000/year)

**Ohm Analytics** -- Only if Blue Water Battery needs comprehensive distributed equipment data.

The monitoring platform partnerships (Enphase/SolarEdge fleet data) are genuinely irreplaceable. No amount of permit scraping can match this -- it's proprietary data behind commercial agreements. But if the business primarily targets utility-scale sites, the free data is already sufficient.

---

## What Our Free Pipeline Does Better Than Paid Sources

| Capability | SolarTrack Advantage |
|------------|---------------------|
| **Storm damage tracking** | 188K sites with county-level hail/wind events (11 years). Neither SEIA nor Ohm provides weather damage data. This is our killer feature for Blue Water Battery. |
| **Equipment recall tracking** | 3,113 sites with recalled equipment. Automatic CPSC cross-reference. |
| **Satellite mount type** | NREL Panel-Segmentation classification. No paid source offers ML-based mount type detection from satellite imagery. |
| **ISO queue coverage** | 6 of 7 ISO queues with real-time developer/project data. Better pipeline/proposed project coverage than SEIA for planned projects. |
| **Multi-source cross-reference** | 9,933 enrichment patches from matching records across 16 sources. Bidirectional field filling catches what single-source databases miss. |
| **Event timeline** | Generator uprates, derates, retirements, and repowers from EIA-860. Equipment lifecycle data unavailable elsewhere. |
| **Cost per record** | $0 for 260K records. SEIA: ~$0.14/record. Ohm: ~$0.06/record but only for the incremental ~240K records we'd gain. |

---

## Summary

**Bottom line**: Our free data pipeline covers ~260K installations with comprehensive location (98%+ county), installer (71%), and storm damage (72% of sites with events) data. The two critical gaps are:

1. **Developer/offtaker names** (2.6% / 0%) -- SEIA closes this for $1K/yr. No free alternative exists.
2. **Distributed equipment-per-site** (~43% coverage) -- Ohm closes this for $30K/yr. Partial replication possible via permit scraping (23 cities today, scalable to 100+).

Buy SEIA. Expand permits. Evaluate Ohm based on distributed solar importance to Blue Water Battery's sales pipeline.
