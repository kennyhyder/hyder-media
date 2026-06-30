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
  land_contact_name: string | null;
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
  "acreage", "parcel_owner", "parcel_apn", "land_owner_type", "land_contact_name", "land_manager", "buildability_score",
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
 * Nearby candidate sites by lat/lng bounding box (±`deg`). Ordered by dc_score
 * desc. Generic — used by substation / brownfield / IXP / datacenter profiles
 * which have no fips of their own but do have coordinates. `excludeId` skips a
 * self row when the entity happens to live in grid_dc_sites too (it usually
 * doesn't, so the default no-op exclusion is fine).
 */
export async function nearbySitesByLatLng(
  lat: number | null | undefined,
  lng: number | null | undefined,
  n = 6,
  deg = 0.4
): Promise<DcSite[]> {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return [];
  }
  return restGet<DcSite>("grid_dc_sites", {
    params: {
      select: TOP_SITE_COLS,
      order: "dc_score.desc.nullslast",
      latitude: [`gte.${lat - deg}`, `lte.${lat + deg}`],
      longitude: [`gte.${lng - deg}`, `lte.${lng + deg}`],
      dc_score: "not.is.null",
      limit: n,
    },
  });
}

// ── Substations (grid_substations) ───────────────────────────────────────────

export interface Substation {
  id: string;
  name: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  max_voltage_kv: number | null;
  min_voltage_kv: number | null;
  owners: string[] | null;
  connected_line_count: number | null;
  connected_line_ids: number[] | null;
  created_at: string | null;
}

const SUBSTATION_COLS = [
  "id", "name", "state", "latitude", "longitude", "max_voltage_kv", "min_voltage_kv",
  "owners", "connected_line_count", "connected_line_ids", "created_at",
].join(",");

export async function getSubstationByShortId(
  state: string,
  shortId: string
): Promise<Substation | null> {
  if (!/^[0-9a-f]{8}$/i.test(shortId)) return null;
  const { lo, hi } = uuidRangeFromShortId(shortId);
  const rows = await restGet<Substation>("grid_substations", {
    params: {
      select: SUBSTATION_COLS,
      state: `eq.${state}`,
      id: [`gte.${lo}`, `lte.${hi}`],
      limit: 1,
    },
  });
  return rows[0] ?? null;
}

/** Top substations in a state by max voltage (real-named only). */
export async function topSubstationsByState(state: string, n = 60): Promise<Substation[]> {
  return restGet<Substation>("grid_substations", {
    params: {
      select: SUBSTATION_COLS,
      state: `eq.${state}`,
      name: "not.like.UNKNOWN*",
      order: "max_voltage_kv.desc.nullslast",
      limit: n,
    },
  });
}

export interface TransmissionLine {
  hifld_id: number | null;
  voltage_kv: number | null;
  owner: string | null;
  status: string | null;
  length_miles: number | null;
}

/** Resolve the connected transmission lines for a substation by their hifld_ids. */
export async function linesByHifldIds(ids: number[], n = 12): Promise<TransmissionLine[]> {
  const clean = (ids || []).filter((x) => Number.isFinite(x)).slice(0, 40);
  if (!clean.length) return [];
  const rows = await restGet<TransmissionLine>("grid_transmission_lines", {
    params: {
      select: "hifld_id,voltage_kv,owner,status,length_miles",
      hifld_id: `in.(${clean.join(",")})`,
      order: "voltage_kv.desc.nullslast",
      limit: n,
    },
  });
  return rows;
}

// ── Brownfield sites (grid_brownfield_sites) ─────────────────────────────────

export interface BrownfieldSite {
  id: string;
  name: string | null;
  site_type: string | null;
  former_use: string | null;
  state: string | null;
  county: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  acreage: number | null;
  eia_plant_id: number | null;
  existing_capacity_mw: number | null;
  retirement_date: string | null;
  grid_connection_voltage_kv: number | null;
  epa_id: string | null;
  cleanup_status: string | null;
  contaminant_type: string | null;
  nearest_substation_id: string | null;
  nearest_substation_distance_km: number | null;
  operator_name: string | null;
  operator_address: string | null;
  created_at: string | null;
}

const BROWNFIELD_COLS = [
  "id", "name", "site_type", "former_use", "state", "county", "city", "latitude", "longitude",
  "acreage", "eia_plant_id", "existing_capacity_mw", "retirement_date", "grid_connection_voltage_kv",
  "epa_id", "cleanup_status", "contaminant_type", "nearest_substation_id",
  "nearest_substation_distance_km", "operator_name", "operator_address", "created_at",
].join(",");

/** All brownfield sites in a state, by existing capacity (for the state index). */
export async function brownfieldsByState(state: string, n = 200): Promise<BrownfieldSite[]> {
  return restGet<BrownfieldSite>("grid_brownfield_sites", {
    params: {
      select: BROWNFIELD_COLS,
      state: `eq.${state}`,
      name: "not.is.null",
      order: "existing_capacity_mw.desc.nullslast",
      limit: n,
    },
  });
}

export async function getBrownfieldByShortId(
  state: string,
  shortId: string
): Promise<BrownfieldSite | null> {
  if (!/^[0-9a-f]{8}$/i.test(shortId)) return null;
  const { lo, hi } = uuidRangeFromShortId(shortId);
  const rows = await restGet<BrownfieldSite>("grid_brownfield_sites", {
    params: {
      select: BROWNFIELD_COLS,
      state: `eq.${state}`,
      id: [`gte.${lo}`, `lte.${hi}`],
      limit: 1,
    },
  });
  return rows[0] ?? null;
}

// ── Internet exchange facilities (grid_ixp_facilities) ───────────────────────

export interface IxpFacility {
  id: string;
  name: string | null;
  org_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  ix_count: number | null;
  network_count: number | null;
  website: string | null;
  notes: string | null;
  address: string | null;
  zipcode: string | null;
  created_at: string | null;
}

const IXP_COLS = [
  "id", "name", "org_name", "city", "state", "country", "latitude", "longitude",
  "ix_count", "network_count", "website", "notes", "address", "zipcode", "created_at",
].join(",");

export async function getIxpByShortId(shortId: string): Promise<IxpFacility | null> {
  if (!/^[0-9a-f]{8}$/i.test(shortId)) return null;
  const { lo, hi } = uuidRangeFromShortId(shortId);
  const rows = await restGet<IxpFacility>("grid_ixp_facilities", {
    params: {
      select: IXP_COLS,
      id: [`gte.${lo}`, `lte.${hi}`],
      limit: 1,
    },
  });
  return rows[0] ?? null;
}

/** Top IXP facilities by connected-network count (for the hub list). */
export async function topIxps(n = 120): Promise<IxpFacility[]> {
  return restGet<IxpFacility>("grid_ixp_facilities", {
    params: {
      select: IXP_COLS,
      name: "not.is.null",
      order: "network_count.desc.nullslast",
      limit: n,
    },
  });
}

/** Other IXP facilities in the same metro (city+state), excluding self. */
export async function nearbyIxps(ixp: IxpFacility, n = 6): Promise<IxpFacility[]> {
  if (!ixp.city || !ixp.state) return [];
  return restGet<IxpFacility>("grid_ixp_facilities", {
    params: {
      select: IXP_COLS,
      city: `eq.${ixp.city}`,
      state: `eq.${ixp.state}`,
      id: `neq.${ixp.id}`,
      order: "network_count.desc.nullslast",
      limit: n,
    },
  });
}

// ── Datacenters (grid_datacenters) ───────────────────────────────────────────

export interface Datacenter {
  id: string;
  name: string | null;
  operator: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity_mw: number | null;
  sqft: number | null;
  dc_type: string | null;
  year_built: number | null;
  address: string | null;
  zipcode: string | null;
  website: string | null;
  status: string | null;
  created_at: string | null;
}

const DATACENTER_COLS = [
  "id", "name", "operator", "city", "state", "latitude", "longitude", "capacity_mw",
  "sqft", "dc_type", "year_built", "address", "zipcode", "website", "status", "created_at",
].join(",");

export async function getDatacenterByShortId(shortId: string): Promise<Datacenter | null> {
  if (!/^[0-9a-f]{8}$/i.test(shortId)) return null;
  const { lo, hi } = uuidRangeFromShortId(shortId);
  const rows = await restGet<Datacenter>("grid_datacenters", {
    params: {
      select: DATACENTER_COLS,
      id: [`gte.${lo}`, `lte.${hi}`],
      limit: 1,
    },
  });
  return rows[0] ?? null;
}

/** Top datacenters by footprint (for the hub list). */
export async function topDatacenters(n = 120): Promise<Datacenter[]> {
  return restGet<Datacenter>("grid_datacenters", {
    params: {
      select: DATACENTER_COLS,
      name: "not.is.null",
      state: "not.is.null",
      order: "sqft.desc.nullslast",
      limit: n,
    },
  });
}

/** Nearby IXP facilities by lat/lng bbox (for datacenter / site cross-links). */
export async function nearbyIxpsByLatLng(
  lat: number | null | undefined,
  lng: number | null | undefined,
  n = 5,
  deg = 0.6
): Promise<IxpFacility[]> {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  return restGet<IxpFacility>("grid_ixp_facilities", {
    params: {
      select: IXP_COLS,
      latitude: [`gte.${lat - deg}`, `lte.${lat + deg}`],
      longitude: [`gte.${lng - deg}`, `lte.${lng + deg}`],
      order: "network_count.desc.nullslast",
      limit: n,
    },
  });
}

/** Nearby datacenters by lat/lng bbox. */
export async function nearbyDatacentersByLatLng(
  lat: number | null | undefined,
  lng: number | null | undefined,
  excludeId: string | null,
  n = 5,
  deg = 0.5
): Promise<Datacenter[]> {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const params: Record<string, string | number | (string | number)[]> = {
    select: DATACENTER_COLS,
    latitude: [`gte.${lat - deg}`, `lte.${lat + deg}`],
    longitude: [`gte.${lng - deg}`, `lte.${lng + deg}`],
    order: "sqft.desc.nullslast",
    limit: n,
  };
  if (excludeId) params.id = `neq.${excludeId}`;
  return restGet<Datacenter>("grid_datacenters", { params });
}

// ── Sitemap enumerators for the new entities ─────────────────────────────────

interface SitemapEntityRow {
  id: string;
  name: string | null;
  state: string | null;
  created_at: string | null;
}

/**
 * Paginated full-state enumeration of substations for the sitemap. Only id /
 * name / state / created_at. The sitemap applies the name+coords noindex gate.
 */
export async function allSubstationsForStateSitemap(
  state: string
): Promise<SitemapEntityRow[]> {
  const PAGE = 1000;
  const out: SitemapEntityRow[] = [];
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const rows = await restGet<SitemapEntityRow>("grid_substations", {
      params: {
        select: "id,name,state,created_at",
        state: `eq.${state}`,
        // index gate mirror: only real-named subs get sitemap'd
        name: "not.like.UNKNOWN*",
        order: "id.asc",
      },
      headers: { Range: `${offset}-${offset + PAGE - 1}` },
    });
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** All brownfield sites (id/name/state) for the sitemap — single shard (~2k). */
export async function allBrownfieldsForSitemap(): Promise<SitemapEntityRow[]> {
  const PAGE = 1000;
  const out: SitemapEntityRow[] = [];
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const rows = await restGet<SitemapEntityRow>("grid_brownfield_sites", {
      params: {
        select: "id,name,state,created_at",
        name: "not.is.null",
        state: "not.is.null",
        order: "id.asc",
      },
      headers: { Range: `${offset}-${offset + PAGE - 1}` },
    });
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** All IXP facilities (id/name/state) for the sitemap — single shard (~1.4k). */
export async function allIxpsForSitemap(): Promise<SitemapEntityRow[]> {
  const PAGE = 1000;
  const out: SitemapEntityRow[] = [];
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const rows = await restGet<SitemapEntityRow>("grid_ixp_facilities", {
      params: {
        select: "id,name,state,created_at",
        name: "not.is.null",
        order: "id.asc",
      },
      headers: { Range: `${offset}-${offset + PAGE - 1}` },
    });
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** All datacenters (id/name/state) for the sitemap — single shard (~3.7k). */
export async function allDatacentersForSitemap(): Promise<SitemapEntityRow[]> {
  const PAGE = 1000;
  const out: SitemapEntityRow[] = [];
  for (let offset = 0; offset < 6000; offset += PAGE) {
    const rows = await restGet<SitemapEntityRow>("grid_datacenters", {
      params: {
        select: "id,name,state,created_at",
        name: "not.is.null",
        state: "not.is.null",
        order: "id.asc",
      },
      headers: { Range: `${offset}-${offset + PAGE - 1}` },
    });
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Distinct states present in a table (for hub-page state lists). Reads a
 * bounded page and dedups client-side — fine for our row volumes. */
export async function distinctStates(
  table: string,
  extraFilter?: Record<string, string>
): Promise<string[]> {
  const params: Record<string, string> = {
    select: "state",
    state: "not.is.null",
    order: "state.asc",
    ...(extraFilter ?? {}),
  };
  const rows = await restGet<{ state: string | null }>(table, {
    params,
    headers: { Range: "0-50000" },
  });
  return Array.from(new Set(rows.map((r) => r.state).filter((s): s is string => !!s)));
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
