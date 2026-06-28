# GridCensus Data-Freshness Runbook

How every grid_* data source stays fresh: which refreshes are **automatable**
(API/REST, run on a schedule) vs **manual** (token-gated or multi-GB download),
the cadence for each, and where each runs (Vercel cron vs the droplet).

> **Hard safety rule.** The live site reads the `grid_*` tables. Every refresh
> MUST be **id-stable / additive** — upsert in place on a natural key, or PATCH
> NULL-only backfills. **Never** wipe-and-regenerate with new ids. All scripts
> below follow this; the EIA national re-ingests are the only "reviewed manual"
> writes and even those upsert on a separate `eia_*` keyspace.

---

## TL;DR — what runs where

| Tier | Runner | Where | Cadence |
|---|---|---|---|
| **A — automatable** | `cron-refresh.py` | Vercel cron (light) / droplet (heavy) | per source below |
| **B — manual / gated** | run by hand after staging files/tokens | local or droplet | per source below |

`cron-refresh.py --check` prints the last `last_import` for every Tier-A source.

---

## Tier A — automatable (in `cron-refresh.py`)

| Source | Script | Cadence | Where | Notes |
|---|---|---|---|---|
| **Fiber route distance** | `backfill-fiber-route-distance.py` | 2×/yr (after fiber-route ingest) | **droplet** | Loads 545k centroids + sjoin_nearest over ~32k null sites. ~6–10 min; exceeds Vercel's 300s. NULL-only, id-stable. |
| **PeeringDB (IXP)** | `ingest-peeringdb.py` | **weekly** | Vercel cron | Small REST pull; well under 300s. |
| **Interconnection queues** | `refresh-interconnection-queues.py` | **monthly** | Vercel cron (if `GRIDSTATUS_API_KEY`) | Auto if GridStatus key present; else prints LBNL manual fallback (exit 2 = "manual", not failure). |

**Cadence rationale**
- **EIA quarterly** — EIA Energy Atlas transmission/substation layers update ~quarterly. (EIA repoint is Tier-A-capable but staged as reviewed-manual; see below.)
- **PeeringDB weekly** — IXP/facility records change frequently; cheap to pull.
- **FEMA quarterly** — National Risk Index revisions land a few times a year.
- **Queues monthly** — ISO queues move monthly; LBNL "Queued Up" only ~annual.
- **Fiber 2×/yr** — fiber-route geometries (railroad ROW / DOT / NTIA middle-mile) refresh roughly twice a year; re-run the route-distance backfill after each route ingest.

### Vercel cron vs droplet
- **Vercel cron** (300s hard limit): anything that finishes fast — PeeringDB, queue refresh, small REST upserts. Wrap `cron-refresh.py --only <job>` behind an authenticated API route, or call the script from a tiny serverless shim.
- **Droplet `104.131.105.89`** (no 300s limit): heavy jobs — `backfill-fiber-route-distance.py` (545k centroid load), any national EIA re-ingest, FCC hex-surface build, NREL DLR. Schedule via cron/systemd on the droplet.

---

## EIA repoint (HIFLD Open is discontinued)

HIFLD Open retired Aug–Sep 2025. Transmission / substations / gas now come from
the **EIA U.S. Energy Atlas** ArcGIS FeatureServers.

| Layer | Script | Source FeatureServer | Count (2026-06) |
|---|---|---|---|
| Transmission lines | `ingest-eia-transmission.py` | `services2.arcgis.com/FiaPA4ga0iQKduv3/.../US_Electric_Power_Transmission_Lines/FeatureServer/0` | 94,619 |
| Substations | `ingest-eia-substations.py` | `services5.arcgis.com/HDRa0B57OVrv2E1q/.../Electric_Substations/FeatureServer/0` | 75,328 |
| Natural gas pipelines | (enrich) `enrich-gas-pipelines.py` repoint → `Natural_Gas_Interstate_and_Intrastate_Pipelines_1/FeatureServer/0` | `services2.arcgis.com/FiaPA4ga0iQKduv3/...` | 32,892 |

**These national loads are REVIEWED MANUAL runs** (they extend the layers the
live site reads). Both EIA scripts default to a safe `--test` (5 rows, no write)
and refuse `--full` without `--i-reviewed-this`. Writes are **additive upserts**:
transmission rows get `source_record_id = eia_{ID}` (separate keyspace from the
old `hifld_*` rows — no collision, no wipe); substations upsert on a ~50 m
coordinate-tolerance natural key so the same physical substation is updated in
place rather than duplicated.

```bash
# verify mapping (safe, read-only):
python3 scripts/ingest-eia-transmission.py --test
python3 scripts/ingest-eia-substations.py  --test
# small live bbox sanity-check (additive eia_* / coord-match):
python3 scripts/ingest-eia-transmission.py --bbox -106.7,30.2,-106.0,30.8 --limit 50
# REVIEWED national load (droplet, do NOT run unattended):
python3 scripts/ingest-eia-transmission.py --full --i-reviewed-this
python3 scripts/ingest-eia-substations.py  --full --i-reviewed-this
```

Gas: `enrich-gas-pipelines.py` already pulls EIA pipelines via a `geo.dot.gov`
mirror; repoint its FeatureServer URL to the EIA org layer above if the mirror
goes stale (it's the same EIA dataset).

---

## Tier B — manual / gated (NOT in `cron-refresh.py`)

Run by hand after staging the file/token. None of these are scheduled.

| Source | What's needed | Size | Script / notes |
|---|---|---|---|
| **NREL DLR** | OpenEI download | **~19 GB** HDF5 | `enrich-dlr-capacity.py`. Dynamic line ratings. Droplet only. Annual. |
| **eGRID** | EPA eGRID workbook | XLSX | Plant emissions/generation. Annual. Manual parse. |
| **LBNL "Queued Up"** | emp.lbl.gov/queues | multi-tab XLSX | The comprehensive national queue dataset; ~annual. `refresh-interconnection-queues.py` flags this when no GridStatus key. |
| **FCC BDC fiber providers** | FCC BDC API **token** + per-state bulk CSVs | **~30–60 GB** | `enrich-fcc-fiber-hexsurface.py` (skeleton). Build H3 hex surface → point-in-polygon. Raises `fcc_fiber_providers` 46% → ~100%. See that file's docstring for the full STEP A–E runbook. Droplet only. |
| **EIA national re-ingest** | (none — but reviewed) | — | `ingest-eia-transmission.py` / `ingest-eia-substations.py --full --i-reviewed-this`. Reviewed manual. |

---

## Freshness signal

All freshness lives in **`grid_data_sources`** (`name`, `last_import`,
`record_count`, `url`, `description`). Each refresh script stamps its own row on
success; `cron-refresh.py` also stamps as a backstop. Source names added by this
work: `eia_transmission`, `eia_substations`, `fiber_route_distance` (implicit
via the backfill), `interconnection_queues`.

Quick freshness audit:
```bash
python3 scripts/cron-refresh.py --check
```

---

## Adding a new automatable source

1. Write the ingest/enrich script — **additive / id-stable** (upsert on a
   natural key or NULL-only PATCH). Mirror `backfill-fips-from-latlng.py` /
   `backfill-fiber-route-distance.py` (geopandas + keyset-paginated REST + batched PATCH).
2. Have it stamp `grid_data_sources` (`last_import`, `record_count`) on success.
3. Add a `(key, [script], source_name, supports_dry, timeout_s)` row to
   `TIER_A` in `cron-refresh.py`.
4. Pick Vercel-cron (<300s) vs droplet (heavy) and wire the schedule.
5. Document cadence + tier in the tables above.
