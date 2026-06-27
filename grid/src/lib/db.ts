// Server-only Supabase REST helpers.
// NEVER import this into a "use client" file — it reads the service key.
//
// PostgREST AGGREGATES ARE DISABLED on this project: never use .avg()/.count()
// in select. All aggregate stats come from src/data/rollups.json. These helpers
// are only for (a) top-N site lists per page and (b) per-county detail rows.

import "server-only";

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
  params?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  // Next fetch revalidation (seconds). Defaults to 1 day.
  revalidate?: number;
}

function buildUrl(path: string, params?: RestGetOptions["params"]): string {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path.replace(/^\//, "")}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
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
