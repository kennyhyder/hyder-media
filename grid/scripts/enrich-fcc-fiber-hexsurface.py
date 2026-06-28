#!/usr/bin/env python3
"""
enrich-fcc-fiber-hexsurface.py — SKELETON / RUNBOOK (does NOT run unattended).

Goal: raise fcc_fiber_providers coverage on grid_dc_sites from ~46% to ~100%
by building a NATIONWIDE fiber-provider hex surface from the FCC Broadband Data
Collection (BDC) bulk fixed-availability CSVs, then point-in-polygon joining
every site's lat/long against it.

WHY a hex surface (and not per-point API calls):
  * The FCC BDC public API (listAvailableFixed) has been returning 405 since
    early 2026 (see ingest-fcc-fiber.py) — per-location queries are dead.
  * BDC bulk CSVs are published per-state, per-technology, and are LARGE
    (tens of GB nationwide). They are keyed by 15-digit Census BLOCK GEOID,
    not lat/long. Joining 164k points directly to ~8M blocks is slow and the
    block geometries are a separate 10+ GB TIGER download.
  * Aggregating BDC fiber records to an H3 hex surface (res 8 ≈ 0.46 km²)
    once, then doing a single vectorized point-in-hex lookup per site, is the
    fast, repeatable path. The hex surface is small enough to cache + re-join
    cheaply on each refresh.

  Fiber technologies in BDC = technology codes 50 (Fiber to the Premises).
  "Provider count" per hex = COUNT(DISTINCT provider_id) among fiber records
  whose block centroid falls in that hex.

────────────────────────────────────────────────────────────────────────────
GATING — DO NOT RUN WITHOUT THESE (manual, one-time):
────────────────────────────────────────────────────────────────────────────
  1. FCC BDC API token (free): register at https://bdc.fcc.gov/ , then
     https://broadbandmap.fcc.gov/login → "Manage API access". Set:
         export FCC_BDC_USERNAME="you@email"
         export FCC_BDC_TOKEN="..."           # hex token
  2. ~30–60 GB free disk for the per-state fiber CSVs + block-centroid lookup.
  3. h3 + pandas + geopandas (geopandas already available; `pip install h3`).
  4. Census block centroids (for block GEOID -> lat/long). Either:
       - TIGER block centroid file (per state), OR
       - the Census "Gazetteer" block-centroid CSVs (much smaller, lat/long
         per GEOID) — preferred. https://www.census.gov/geographies/
         reference-files/time-series/geo/gazetteer-files.html

────────────────────────────────────────────────────────────────────────────
RUNBOOK (manual steps — each is gated, none run from this script today):
────────────────────────────────────────────────────────────────────────────
  STEP A — Discover + download bulk BDC fiber files
    GET https://broadbandmap.fcc.gov/api/public/map/downloads/listAvailabilityData/{as_of_date}
        Authorization headers: username + hash_value (token)
    Filter the manifest to: category="State", subcategory="Fixed Broadband",
        technology_code=50 (Fiber). Download each state's CSV (a few hundred MB
        each; ~30–60 GB total). Store under data/fcc_bdc/<state>/.

  STEP B — Build the block-centroid lookup
    Load the Census Gazetteer block-centroid CSV(s): GEOID -> (lat, lng).
    (8M+ rows, but it's a flat CSV — pandas handles it.)

  STEP C — Aggregate to H3 hex provider counts
    For each state fiber CSV:
        read columns: block_geoid, provider_id, technology (==50), …
        map block_geoid -> centroid (lat,lng) via STEP B
        hex = h3.latlng_to_cell(lat, lng, H3_RES)   # H3_RES = 8
        accumulate set(provider_id) per hex
    Result: hex -> distinct fiber provider count. Persist to
        data/fcc_bdc/_fiber_hex_res8.parquet  (small — a few M hexes).

  STEP D — Point-in-hex join every site
    Load grid_dc_sites (id, latitude, longitude) via keyset pagination.
    For each site: hex = h3.latlng_to_cell(lat, lng, H3_RES); look up count.
    Optionally widen to k-ring(1) and take MAX if the exact hex is empty
    (handles sites on a hex boundary / sparse rural blocks).

  STEP E — Upsert (ADDITIVE / id-stable — same pattern as the other backfills)
    Batched PATCH grid_dc_sites?id=in.(...) SET fcc_fiber_providers=<n>.
    Only touch rows where fcc_fiber_providers IS NULL (re-runnable).
    Optionally bump score_fiber by re-running score-dc-sites.py afterwards
    (score_fiber reads fcc_fiber_providers for the redundancy bonus).

  RUN (only after STEPS A–C are staged and the token is set):
    python3 scripts/enrich-fcc-fiber-hexsurface.py --build-hex   # C (heavy)
    python3 scripts/enrich-fcc-fiber-hexsurface.py --join        # D+E (writes)
    python3 scripts/enrich-fcc-fiber-hexsurface.py --join --dry  # D, no writes

SAFETY: writes are additive PATCHes on existing ids (NULL-only). No wipe, no
id reassignment. The live site reads grid_dc_sites — same id-stable rule as
backfill-fiber-route-distance.py.
"""
import os
import sys

H3_RES = 8  # ~0.46 km² hexes — finer than a Census block in most metros
HEX_CACHE = os.path.join(os.path.dirname(__file__), "..", "data",
                         "fcc_bdc", "_fiber_hex_res8.parquet")
BDC_DOWNLOADS_API = ("https://broadbandmap.fcc.gov/api/public/map/downloads/"
                     "listAvailabilityData/{as_of_date}")


def _require_token():
    user = os.environ.get("FCC_BDC_USERNAME")
    token = os.environ.get("FCC_BDC_TOKEN")
    if not (user and token):
        sys.exit("FCC_BDC_USERNAME + FCC_BDC_TOKEN not set — see runbook in "
                 "this file's docstring (STEP 1). Gated; nothing downloaded.")
    return user, token


def build_hex():
    """STEP C — aggregate downloaded BDC fiber CSVs to an H3 provider-count
    surface. STUB: requires STEP A files staged under data/fcc_bdc/. Not
    implemented to run unattended (multi-GB, manual download)."""
    _require_token()
    raise NotImplementedError(
        "build_hex: stage the per-state BDC fiber CSVs (STEP A) + Census block "
        "centroids (STEP B) first, then implement the h3 aggregation (STEP C). "
        "See the runbook in the module docstring. Intentionally not run here.")


def join_and_upsert(dry=False):
    """STEP D+E — point-in-hex lookup per site + additive PATCH. STUB: needs
    HEX_CACHE built by build_hex() first."""
    if not os.path.exists(HEX_CACHE):
        sys.exit(f"hex cache missing: {HEX_CACHE}. Run --build-hex first "
                 "(after staging BDC CSVs). Gated; nothing written.")
    raise NotImplementedError(
        "join_and_upsert: implement once the hex surface exists. Reuse the "
        "keyset-load + batched-PATCH pattern from backfill-fiber-route-distance.py.")


def main():
    args = sys.argv[1:]
    if "--build-hex" in args:
        build_hex()
    elif "--join" in args:
        join_and_upsert(dry="--dry" in args)
    else:
        print(__doc__)
        print("\nThis is a gated SKELETON. Needs an FCC BDC token + multi-GB "
              "manual CSV downloads.\nFlags: --build-hex (STEP C) | --join "
              "[--dry] (STEP D+E). See the runbook above.")


if __name__ == "__main__":
    main()
