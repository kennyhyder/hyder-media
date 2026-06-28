// Server-only Supabase REST helpers.
// NEVER import this into a "use client" file — it reads the service key.
//
// PostgREST AGGREGATES ARE DISABLED on this project: never use .avg()/.count()
// in select. All aggregate stats come from src/data/rollups.json. These helpers
// are only for (a) top-N site lists per page and (b) per-county detail rows.

import "server-only";

import { uuidRangeFromShortId } from "@/lib/entity-slug";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

function authHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    ...extra,
  };
}

export interface RestGetOptions {
  // Array values emit repeated query params for the same column — required for
  // range filters like id=gte.X & id=lte.Y on a single PostgREST column.
  params?: Record<string, string | number | (string | number)[] | undefined>;
  headers?: Record<string, string>;
  // Next fetch revalidation (seconds). Defaults to 1 day.
  revalidate?: number;
}

function buildUrl(path: string, params?: RestGetOptions["params"]): string {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path.replace(/^\//, "")}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

/** Generic GET against a PostgREST table/view. Returns parsed JSON array. */
export async function restGet<T = Record<string, unknown>>(
  path: string,
  opts: RestGetOptions = {}
): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return [];
  const url = buildUrl(path, opts.params);
  try {
    const res = await fetch(url, {
      headers: authHeaders(opts.headers),
      next: { revalidate: opts.revalidate ?? 86400 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as T[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Exact row count for a table given equality filters, via the
 * `Prefer: count=exact` header + Range:0-0, reading content-range.
 * Returns null on failure (caller should fall back to rollups).
 */
export async function getCount(
  table: string,
  filters: Record<string, string | number> = {}
): Promise<number | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  const params: Record<string, string> = { select: "id" };
  for (const [k, v] of Object.entries(filters)) {
    // caller passes plain value; we wrap as eq.
    params[k] = `eq.${v}`;
  }
  const url = buildUrl(table, params);
  try {
    const res = await fetch(url, {
      headers: authHeaders({ Prefer: "count=exact", Range: "0-0" }),
      next: { revalidate: 86400 },
    });
    const cr = res.headers.get("content-range"); // e.g. "0-0/6152"
    if (!cr) return null;
    const total = cr.split("/")[1];
    if (!total || total === "*") return null;
    const n = parseInt(total, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export interface DcSite {
  id: string;
  name: string | null;
  site_type: string | null;
  state: string | null;
  county: string | null;
  fips_code: string | null;
  latitude: number | null;
  longitude: number | null;
  substation_voltage_kv: number | null;
  available_capacity_mw: number | null;
  dc_score: number | null;
  score_power: number | null;
  score_speed_to_power: number | null;
  score_fiber: number | null;
  score_water: number | null;
  score_hazard: number | null;
  iso_region: string | null;
  queue_depth: number | null;
  avg_queue_wait_years: number | null;
  flood_zone: string | null;
  fcc_fiber_providers: number | null;
  parcel_owner: string | null;
  energy_price_mwh: number | null;
  former_use: string | null;
  nearest_ixp_name: string | null;
  nearest_ixp_distance_km: number | null;
}

const TOP_SITE_COLS = [
  "id",
  "name",
  "site_type",
  "state",
  "county",
  "fips_code",
  "latitude",
  "longitude",
  "substation_voltage_kv",
  "available_capacity_mw",
  "dc_score",
  "score_power",
  "score_speed_to_power",
  "score_fiber",
  "score_water",
  "score_hazard",
  "iso_region",
  "queue_depth",
  "avg_queue_wait_years",
  "flood_zone",
  "fcc_fiber_providers",
  "parcel_owner",
  "energy_price_mwh",
  "former_use",
  "nearest_ixp_name",
  "nearest_ixp_distance_km",
].join(",");

/**
 * Top-N sites ordered by dc_score desc, given equality filters
 * (e.g. { state: "VA", site_type: "brownfield", fips_code: "51107" }).
 */
export async function topSites(
  filters: Record<string, string | number> = {},
  limit = 25
): Promise<DcSite[]> {
  const params: Record<string, string | number> = {
    select: TOP_SITE_COLS,
    order: "dc_score.desc.nullslast",
    limit,
  };
  for (const [k, v] of Object.entries(filters)) {
    params[k] = `eq.${v}`;
  }
  return restGet<DcSite>("grid_dc_sites", { params });
}

export interface CountyDetail {
  fips_code: string;
  state: string | null;
  county_name: string | null;
  nri_score: number | null;
  nri_rating: string | null;
  construction_employment: number | null;
  construction_wages_avg: number | null;
  total_employment: number | null;
  cooling_degree_days: number | null;
  heating_degree_days: number | null;
  mean_annual_temp_f: number | null;
  water_stress_score: number | null;
  water_stress_label: string | null;
  has_dc_tax_incentive: boolean | null;
  dc_incentive_type: string | null;
  dc_incentive_details: string | null;
  has_fiber: boolean | null;
  fiber_provider_count: number | null;
  avg_commercial_rate_cents_kwh: number | null;
  avg_industrial_rate_cents_kwh: number | null;
  land_price_per_acre: number | null;
  ferc714_load_growth_pct: number | null;
  area_sq_miles: number | null;
}

const COUNTY_COLS = [
  "fips_code",
  "state",
  "county_name",
  "nri_score",
  "nri_rating",
  "construction_employment",
  "construction_wages_avg",
  "total_employment",
  "cooling_degree_days",
  "heating_degree_days",
  "mean_annual_temp_f",
  "water_stress_score",
  "water_stress_label",
  "has_dc_tax_incentive",
  "dc_incentive_type",
  "dc_incentive_details",
  "has_fiber",
  "fiber_provider_count",
  "avg_commercial_rate_cents_kwh",
  "avg_industrial_rate_cents_kwh",
  "land_price_per_acre",
  "ferc714_load_growth_pct",
  "area_sq_miles",
].join(",");

/** Per-county context row from grid_county_data, keyed by 5-digit FIPS. */
export async function countyDetail(
  fips: string
): Promise<CountyDetail | null> {
  const rows = await restGet<CountyDetail>("grid_county_data", {
    params: { select: COUNTY_COLS, fips_code: `eq.${fips}`, limit: 1 },
  });
  return rows[0] ?? null;
}

/** Alias matching the requested entity-infra naming. */
export async function getCountyByFips(fips: string): Promise<CountyDetail | null> {
  return countyDetail(fips);
}

// ── Per-site profile (full row) ──────────────────────────────────────────────

/**
 * A site row with the rich column set used by the per-entity profile page.
 * (All nullable — the profile renders defensively, omitting absent fields.)
 */
export interface FullDcSite {
  id: string;
  name: string | null;
  site_type: string | null;
  state: string | null;
  county: string | null;
  fips_code: string | null;
  latitude: number | null;
  longitude: number | null;
  dc_score: number | null;
  // power & interconnection
  substation_voltage_kv: number | null;
  available_capacity_mw: number | null;
  nearest_substation_name: string | null;
  nearest_substation_distance_km: number | null;
  lmp_zone: string | null;
  lmp_wholesale_mwh: number | null;
  iso_lmp_node: string | null;
  iso_lmp_avg: number | null;
  utility_name: string | null;
  utility_rate_commercial: number | null;
  energy_price_mwh: number | null;
  // speed-to-power
  iso_region: string | null;
  queue_depth: number | null;
  avg_queue_wait_years: number | null;
  recent_queue_wait_years: number | null;
  queue_completion_rate: number | null;
  queue_withdrawal_rate: number | null;
  // connectivity
  nearest_ixp_name: string | null;
  nearest_ixp_distance_km: number | null;
  fcc_fiber_providers: number | null;
  fcc_fiber_pct: number | null;
  fcc_max_down_mbps: number | null;
  nearest_cloud_provider: string | null;
  nearest_cloud_region: string | null;
  nearest_cloud_region_km: number | null;
  nearest_cloud_distance_km: number | null;
  // site characteristics
  acreage: number | null;
  parcel_owner: string | null;
  parcel_apn: string | null;
  land_owner_type: string | null;
  land_manager: string | null;
  buildability_score: number | null;
  nlcd_class: string | null;
  in_industrial_zone: boolean | null;
  former_use: string | null;
  existing_capacity_mw: number | null;
  cleanup_status: string | null;
  retirement_date: string | null;
  // risk & environment
  flood_zone: string | null;
  flood_zone_sfha: boolean | null;
  wri_water_stress: number | null;
  wri_basin_name: string | null;
  wetland_present: boolean | null;
  wetland_type: string | null;
  critical_habitat: boolean | null;
  critical_habitat_species: string | null;
  superfund_nearby: boolean | null;
  superfund_site_name: string | null;
  env_superfund_count: number | null;
  construction_cost_index: number | null;
  // location context / nearest-of
  nearest_dc_name: string | null;
  nearest_dc_distance_km: number | null;
  nearest_rail_km: number | null;
  nearest_gas_pipeline_km: number | null;
  nearest_fiber_km: number | null;
  // 13 sub-scores
  score_power: number | null;
  score_speed_to_power: number | null;
  score_fiber: number | null;
  score_water: number | null;
  score_hazard: number | null;
  score_labor: number | null;
  score_land: number | null;
  score_tax: number | null;
  score_climate: number | null;
  score_energy_cost: number | null;
  score_gas_pipeline: number | null;
  score_buildability: number | null;
  score_construction_cost: number | null;
  score_existing_dc: number | null;
  updated_at: string | null;
}

const FULL_SITE_COLS = [
  "id", "name", "site_type", "state", "county", "fips_code", "latitude", "longitude", "dc_score",
  "substation_voltage_kv", "available_capacity_mw", "nearest_substation_name",
  "nearest_substation_distance_km", "lmp_zone", "lmp_wholesale_mwh", "iso_lmp_node", "iso_lmp_avg",
  "utility_name", "utility_rate_commercial", "energy_price_mwh",
  "iso_region", "queue_depth", "avg_queue_wait_years", "recent_queue_wait_years",
  "queue_completion_rate", "queue_withdrawal_rate",
  "nearest_ixp_name", "nearest_ixp_distance_km", "fcc_fiber_providers", "fcc_fiber_pct",
  "fcc_max_down_mbps", "nearest_cloud_provider", "nearest_cloud_region", "nearest_cloud_region_km",
  "nearest_cloud_distance_km",
  "acreage", "parcel_owner", "parcel_apn", "land_owner_type", "land_manager", "buildability_score",
  "nlcd_class", "in_industrial_zone", "former_use", "existing_capacity_mw", "cleanup_status",
  "retirement_date",
  "flood_zone", "flood_zone_sfha", "wri_water_stress", "wri_basin_name", "wetland_present",
  "wetland_type", "critical_habitat", "critical_habitat_species", "superfund_nearby",
  "superfund_site_name", "env_superfund_count", "construction_cost_index",
  "nearest_dc_name", "nearest_dc_distance_km", "nearest_rail_km", "nearest_gas_pipeline_km",
  "nearest_fiber_km",
  "score_power", "score_speed_to_power", "score_fiber", "score_water", "score_hazard", "score_labor",
  "score_land", "score_tax", "score_climate", "score_energy_cost", "score_gas_pipeline",
  "score_buildability", "score_construction_cost", "score_existing_dc",
  "updated_at",
].join(",");

/**
 * Resolve a single site by state code + the 8-char short id from its slug.
 * Uses the uuid-range trick (PK-indexed) since the id column is a real uuid.
 * `fipsOrCounty` is accepted for signature stability but not required for the
 * lookup (state + short id is already unique in practice); when provided we use
 * it only as a soft validation hint at the call site.
 */
export async function getSiteByShortId(
  state: string,
  _fipsOrCounty: string | undefined,
  shortId: string
): Promise<FullDcSite | null> {
  if (!/^[0-9a-f]{8}$/i.test(shortId)) return null;
  const { lo, hi } = uuidRangeFromShortId(shortId);
  const rows = await restGet<FullDcSite>("grid_dc_sites", {
    params: {
      select: FULL_SITE_COLS,
      state: `eq.${state}`,
      id: [`gte.${lo}`, `lte.${hi}`],
      limit: 1,
    },
  });
  return rows[0] ?? null;
}

/**
 * Nearby comparable sites: same county (fips) when available, else a ±0.5°
 * lat/long bounding box. Ordered by dc_score desc, excludes self.
 */
export async function nearbySites(site: FullDcSite, n = 8): Promise<DcSite[]> {
  const params2: Record<string, string | number | (string | number)[]> = {
    select: TOP_SITE_COLS,
    order: "dc_score.desc.nullslast",
    id: `neq.${site.id}`,
    limit: n,
  };
  if (site.fips_code) {
    params2.fips_code = `eq.${site.fips_code}`;
  } else if (site.latitude != null && site.longitude != null) {
    params2.latitude = [`gte.${site.latitude - 0.5}`, `lte.${site.latitude + 0.5}`];
    params2.longitude = [`gte.${site.longitude - 0.5}`, `lte.${site.longitude + 0.5}`];
  } else {
    return [];
  }
  return restGet<DcSite>("grid_dc_sites", { params: params2 });
}

/**
 * Paginated full-state enumeration of sites for the sitemap (id/name/fips +
 * updated_at only). Skips nothing here; the sitemap applies the noindex gate.
 */
export async function allSitesForStateSitemap(
  state: string
): Promise<Array<{ id: string; name: string | null; fips_code: string | null; dc_score: number | null; updated_at: string | null }>> {
  const PAGE = 1000;
  const out: Array<{ id: string; name: string | null; fips_code: string | null; dc_score: number | null; updated_at: string | null }> = [];
  for (let offset = 0; offset < 60000; offset += PAGE) {
    const rows = await restGet<{ id: string; name: string | null; fips_code: string | null; dc_score: number | null; updated_at: string | null }>(
      "grid_dc_sites",
      {
        params: {
          select: "id,name,fips_code,dc_score,updated_at",
          state: `eq.${state}`,
          order: "id.asc",
        },
        headers: { Range: `${offset}-${offset + PAGE - 1}` },
      }
    );
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
