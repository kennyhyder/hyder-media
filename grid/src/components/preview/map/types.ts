// Shared types + helpers for the map-first preview. Self-contained; only pulls
// from existing read-only libs (geo slugify, entity-slug siteSlug).

import { slugify, stateByCode, countySlug } from "@/lib/geo";
import { siteSlug } from "@/lib/entity-slug";

export interface MapSite {
  id: string;
  name: string | null;
  site_type: string | null;
  state: string | null;
  county?: string | null;
  latitude: number | null;
  longitude: number | null;
  dc_score: number | null;
  available_capacity_mw?: number | null;
  former_use?: string | null;
  substation_voltage_kv?: number | null;
  nearest_ixp_distance_km?: number | null;
  nearest_dc_distance_km?: number | null;
  acreage?: number | null;
}

export interface MapDatacenter {
  id: string;
  name: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  dc_type?: string | null;
}

export interface MapSubstation {
  id: string;
  name: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  max_voltage_kv?: number | null;
}

export interface MapLine {
  id: string;
  voltage_kv: number | null;
  owner: string | null;
  sub_1: string | null;
  sub_2: string | null;
  geometry_wkt: string | null;
  state: string | null;
}

export interface MapBrownfield {
  id: string;
  name: string | null;
  site_type: string | null;
  state: string | null;
  city?: string | null;
  county?: string | null;
  latitude: number | null;
  longitude: number | null;
  acreage?: number | null;
  existing_capacity_mw?: number | null;
  former_use?: string | null;
  cleanup_status?: string | null;
}

export interface MapDataResponse {
  sites: MapSite[];
  total?: number;
  returned?: number;
  datacenters?: MapDatacenter[];
  substations?: MapSubstation[];
  lines?: MapLine[];
}

/**
 * Build the public site-profile path from a map-data row. map-data does not
 * return fips_code, so we derive the county segment from the row's own county
 * text (the production route falls back to that same text when the FIPS rollup
 * is missing, so the link resolves). Returns null if state/county unknown.
 */
export function siteProfileHref(site: MapSite): string | null {
  if (!site.state) return null;
  const st = stateByCode(site.state);
  if (!st) return null;
  if (!site.county) return null;
  const slug = siteSlug({ id: site.id, name: site.name });
  return `/datacenter-sites/${st.slug}/${countySlug(site.county)}/${slug}`;
}

export { slugify };

// Human-readable site-type labels.
const TYPE_LABELS: Record<string, string> = {
  substation: "Substation",
  brownfield: "Brownfield",
  greenfield: "Greenfield",
  industrial: "Industrial",
  federal_excess: "Federal Excess",
  mine: "Former Mine",
  military_brac: "Military (BRAC)",
  shovel_ready: "Shovel-Ready",
  manufacturing: "Manufacturing",
};

export function siteTypeLabel(t: string | null | undefined): string {
  if (!t) return "Site";
  return TYPE_LABELS[t] || t.replace(/_/g, " ");
}
