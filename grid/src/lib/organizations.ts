// Unified ORGANIZATION substrate.
//
// GridCensus's differentiator: every owner/operator across the WHOLE dataset
// (utilities, landowners, DC operators, IXP orgs, railroads, fiber carriers)
// rolled up into ONE organization profile that aggregates ALL their assets and
// cross-links from every entity.
//
// Two layers:
//   1. The precomputed INDEX (src/data/organizations.json, built by
//      scripts/build-organizations.mjs) — counts + states + the raw owner-string
//      variants per source column. Used for hub ordering, params, and headline
//      counts. No DB hit.
//   2. LIVE per-asset queries — given an org's raw owner variants, pull the
//      actual asset rows (capped) so each profile section lists real, linked
//      entities. This keeps the page fast (counts from index) while still
//      rendering rich, cross-linked asset tables.

import "server-only";

import orgIndexRaw from "@/data/organizations.json";
import { restGet } from "@/lib/db";

export const ASSET_KEYS = [
  "datacenters",
  "candidate_sites",
  "substations",
  "transmission_lines",
  "fiber_routes",
  "rail_lines",
  "brownfields",
  "ixps",
  "parcels",
] as const;
export type AssetKey = (typeof ASSET_KEYS)[number];

export interface OrgAssets {
  datacenters: number;
  candidate_sites: number;
  substations: number;
  transmission_lines: number;
  fiber_routes: number;
  rail_lines: number;
  brownfields: number;
  ixps: number;
  parcels: number;
}

export interface OrgRecord {
  name: string;
  totalAssets: number;
  assets: OrgAssets;
  states: string[];
  /** raw owner strings per source column, for live in.() queries. */
  variants: Record<string, string[]>;
}

export interface OrgIndex {
  generatedAt: string;
  dataLastUpdated: string | null;
  totalOrganizations: number;
  totalAssets: number;
  organizations: Record<string, OrgRecord>;
}

const INDEX = orgIndexRaw as unknown as OrgIndex;

/** All organizations as [slug, record] pairs (unsorted). */
export function allOrganizations(): Array<{ slug: string } & OrgRecord> {
  return Object.entries(INDEX.organizations).map(([slug, rec]) => ({ slug, ...rec }));
}

/** Total org count + asset count for hub copy. */
export function orgIndexMeta(): { totalOrganizations: number; totalAssets: number } {
  return { totalOrganizations: INDEX.totalOrganizations, totalAssets: INDEX.totalAssets };
}

/** One org by slug (index record only — no live data). */
export function getOrgRecord(slug: string): OrgRecord | null {
  return INDEX.organizations[slug] ?? null;
}

/**
 * Should this org get an indexable profile? Real, non-blank name with at least
 * 2 catalogued assets — single-asset / junk orgs are noindex (thin content).
 */
export function orgShouldIndex(rec: OrgRecord): boolean {
  return !!rec.name && rec.name.trim().length > 1 && rec.totalAssets >= 2;
}

/** Top-N orgs by total assets (hub ranking + static params). */
export function topOrganizations(n?: number): Array<{ slug: string } & OrgRecord> {
  const all = allOrganizations()
    .filter((o) => orgShouldIndex(o))
    .sort((a, b) => b.totalAssets - a.totalAssets || a.name.localeCompare(b.name));
  return n != null ? all.slice(0, n) : all;
}

/** Stable slug list of every INDEXABLE org (for sitemap enumeration). */
export function indexableOrgSlugs(): string[] {
  return allOrganizations()
    .filter((o) => orgShouldIndex(o))
    .map((o) => o.slug)
    .sort();
}

/** How many sitemap shards the org list needs at `perShard` URLs each. */
export function orgSitemapShardCount(perShard = 50000): number {
  return Math.max(1, Math.ceil(indexableOrgSlugs().length / perShard));
}

// ── Live per-asset fetchers ──────────────────────────────────────────────────
// Each takes the org record + a per-section cap and resolves the actual rows
// owned/operated by that org, using the precomputed raw owner variants.

/** Build a PostgREST `in.(...)` value list, quoting + escaping each string. */
function inList(values: string[]): string | null {
  const clean = Array.from(new Set(values.filter((v) => v != null && v !== "")));
  if (!clean.length) return null;
  // PostgREST in.() — wrap each value in double quotes, escape embedded quotes.
  const quoted = clean.map((v) => `"${String(v).replace(/"/g, '""')}"`);
  return `in.(${quoted.join(",")})`;
}

/** Build a PostgREST array-overlap `ov.{...}` literal for a text[] column. */
function ovList(values: string[]): string | null {
  const clean = Array.from(new Set(values.filter((v) => v != null && v !== "")));
  if (!clean.length) return null;
  // Array literal members with commas/quotes/spaces must be double-quoted,
  // embedded quotes + backslashes escaped.
  const quoted = clean.map((v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `ov.{${quoted.join(",")}}`;
}

export interface OrgDatacenter {
  id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  capacity_mw: number | null;
  sqft: number | null;
  dc_type: string | null;
  status: string | null;
}

export async function orgDatacenters(rec: OrgRecord, limit = 50): Promise<OrgDatacenter[]> {
  const variants = rec.variants["datacenters_operator"] ?? [];
  const f = inList(variants);
  if (!f) return [];
  return restGet<OrgDatacenter>("grid_datacenters", {
    params: {
      select: "id,name,city,state,capacity_mw,sqft,dc_type,status",
      operator: f,
      order: "sqft.desc.nullslast",
      limit,
    },
  });
}

export interface OrgSite {
  id: string;
  name: string | null;
  site_type: string | null;
  state: string | null;
  county: string | null;
  fips_code: string | null;
  dc_score: number | null;
  available_capacity_mw: number | null;
  parcel_owner: string | null;
}

export async function orgCandidateSites(rec: OrgRecord, limit = 50): Promise<OrgSite[]> {
  const f = inList(rec.variants["dc_sites_parcel_owner"] ?? []);
  if (!f) return [];
  return restGet<OrgSite>("grid_dc_sites", {
    params: {
      select: "id,name,site_type,state,county,fips_code,dc_score,available_capacity_mw,parcel_owner",
      parcel_owner: f,
      order: "dc_score.desc.nullslast",
      limit,
    },
  });
}

export interface OrgSubstation {
  id: string;
  name: string | null;
  state: string | null;
  max_voltage_kv: number | null;
  connected_line_count: number | null;
}

export async function orgSubstations(rec: OrgRecord, limit = 50): Promise<OrgSubstation[]> {
  // owners is a text[]; `ov` (overlaps) matches rows whose array shares any value.
  const f = ovList(rec.variants["substations_owners"] ?? []);
  if (!f) return [];
  return restGet<OrgSubstation>("grid_substations", {
    params: {
      select: "id,name,state,max_voltage_kv,connected_line_count",
      owners: f,
      name: "not.like.UNKNOWN*",
      order: "max_voltage_kv.desc.nullslast",
      limit,
    },
  });
}

export interface OrgTransmissionLine {
  id: string;
  hifld_id: number | null;
  voltage_kv: number | null;
  owner: string | null;
  state: string | null;
  status: string | null;
  length_miles: number | null;
}

export async function orgTransmissionLines(rec: OrgRecord, limit = 50): Promise<OrgTransmissionLine[]> {
  const f = inList(rec.variants["transmission_owner"] ?? []);
  if (!f) return [];
  return restGet<OrgTransmissionLine>("grid_transmission_lines", {
    params: {
      select: "id,hifld_id,voltage_kv,owner,state,status,length_miles",
      owner: f,
      order: "voltage_kv.desc.nullslast",
      limit,
    },
  });
}

export interface OrgFiberRoute {
  id: string;
  name: string | null;
  operator: string | null;
  state: string | null;
  fiber_type: string | null;
}

export async function orgFiberRoutes(rec: OrgRecord, limit = 30): Promise<OrgFiberRoute[]> {
  const f = inList(rec.variants["fiber_operator"] ?? []);
  if (!f) return [];
  return restGet<OrgFiberRoute>("grid_fiber_routes", {
    params: {
      select: "id,name,operator,state,fiber_type",
      operator: f,
      order: "state.asc",
      limit,
    },
  });
}

export interface OrgRailLine {
  id: string;
  railroad_owner: string | null;
  state: string | null;
  subdivision: string | null;
  miles: number | null;
}

export async function orgRailLines(rec: OrgRecord, limit = 30): Promise<OrgRailLine[]> {
  const f = inList(rec.variants["rail_railroad_owner"] ?? []);
  if (!f) return [];
  return restGet<OrgRailLine>("grid_rail_lines", {
    params: {
      select: "id,railroad_owner,state,subdivision,miles",
      railroad_owner: f,
      order: "miles.desc.nullslast",
      limit,
    },
  });
}

export interface OrgBrownfield {
  id: string;
  name: string | null;
  state: string | null;
  city: string | null;
  county: string | null;
  former_use: string | null;
  existing_capacity_mw: number | null;
  operator_name: string | null;
}

export async function orgBrownfields(rec: OrgRecord, limit = 50): Promise<OrgBrownfield[]> {
  const f = inList(rec.variants["brownfields_operator_name"] ?? []);
  if (!f) return [];
  return restGet<OrgBrownfield>("grid_brownfield_sites", {
    params: {
      select: "id,name,state,city,county,former_use,existing_capacity_mw,operator_name",
      operator_name: f,
      order: "existing_capacity_mw.desc.nullslast",
      limit,
    },
  });
}

export interface OrgIxp {
  id: string;
  name: string | null;
  org_name: string | null;
  city: string | null;
  state: string | null;
  network_count: number | null;
}

export async function orgIxps(rec: OrgRecord, limit = 50): Promise<OrgIxp[]> {
  const f = inList(rec.variants["ixp_org_name"] ?? []);
  if (!f) return [];
  return restGet<OrgIxp>("grid_ixp_facilities", {
    params: {
      select: "id,name,org_name,city,state,network_count",
      org_name: f,
      order: "network_count.desc.nullslast",
      limit,
    },
  });
}

export interface OrgParcel {
  id: string;
  owner_name: string | null;
  state: string | null;
}

export async function orgParcels(rec: OrgRecord, limit = 30): Promise<OrgParcel[]> {
  const f = inList(rec.variants["parcels_owner_name"] ?? []);
  if (!f) return [];
  return restGet<OrgParcel>("grid_parcels", {
    params: {
      select: "id,owner_name,state",
      owner_name: f,
      order: "state.asc",
      limit,
    },
  });
}
