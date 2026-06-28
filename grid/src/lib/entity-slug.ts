// Generic per-entity slug helpers for keyword-rich, unique profile URLs.
//
// Pattern (shared by sites today; substations / brownfields / IXPs / datacenters
// later): `${slugify(name)}-${shortId}` where shortId is the first 8 chars of the
// entity's uuid. The name makes the URL keyword-rich; the 8-char id suffix makes
// it unique and reversible without a slug column.
//
// Because the uuid is a real Postgres `uuid` (not text), PostgREST `like` does
// not apply. We resolve by the canonical uuid RANGE the prefix implies:
//   gte `${shortId}-0000-0000-0000-000000000000`
//   lte `${shortId}-ffff-ffff-ffff-ffffffffffff`
// which is an exact PK-indexed lookup. See uuidRangeFromShortId().

import { slugify, stateByCode, countySlug } from "@/lib/geo";
import { countyRollup } from "@/lib/rollups";

export const SHORT_ID_LEN = 8;

/** Build a slug for any entity row that has an `id` (uuid) + optional name. */
export function entitySlug(
  row: { id: string; name?: string | null },
  fallbackName = "site"
): string {
  const base = slugify(row.name || fallbackName) || fallbackName;
  return `${base}-${row.id.slice(0, SHORT_ID_LEN)}`;
}

/** Site-specific convenience (keeps call sites readable). */
export function siteSlug(row: { id: string; name?: string | null }): string {
  return entitySlug(row, "site");
}

/** Substation slug: `${slugify(name)}-${shortId}`. */
export function substationSlug(row: { id: string; name?: string | null }): string {
  return entitySlug(row, "substation");
}

/** Brownfield slug. */
export function brownfieldSlug(row: { id: string; name?: string | null }): string {
  return entitySlug(row, "brownfield");
}

/** Internet exchange / IXP facility slug. */
export function ixpSlug(row: { id: string; name?: string | null }): string {
  return entitySlug(row, "internet-exchange");
}

/** Datacenter slug. */
export function datacenterSlug(row: { id: string; name?: string | null }): string {
  return entitySlug(row, "datacenter");
}

// ── Public profile-path builders ─────────────────────────────────────────────
// Each returns null when the row lacks the segments needed to address it (such
// rows are noindex anyway and get no inbound link).

import { stateByCode as _stateByCode } from "@/lib/geo";

/** `/substations/{state-slug}/{slug}` — needs a resolvable state code. */
export function substationProfilePath(row: {
  id: string;
  name?: string | null;
  state?: string | null;
}): string | null {
  if (!row.state) return null;
  const st = _stateByCode(row.state);
  if (!st) return null;
  return `/substations/${st.slug}/${substationSlug(row)}`;
}

/** `/brownfield-sites/{state-slug}/{slug}`. */
export function brownfieldProfilePath(row: {
  id: string;
  name?: string | null;
  state?: string | null;
}): string | null {
  if (!row.state) return null;
  const st = _stateByCode(row.state);
  if (!st) return null;
  return `/brownfield-sites/${st.slug}/${brownfieldSlug(row)}`;
}

/** `/internet-exchanges/{slug}` — flat (no state segment). */
export function ixpProfilePath(row: { id: string; name?: string | null }): string {
  return `/internet-exchanges/${ixpSlug(row)}`;
}

/** `/datacenters/{slug}` — flat (no state segment). */
export function datacenterProfilePath(row: { id: string; name?: string | null }): string {
  return `/datacenters/${datacenterSlug(row)}`;
}

/**
 * Pull the trailing short id out of a slug. Returns null if the slug has no
 * plausible 8-hex-char suffix (guards against malformed URLs → notFound()).
 */
export function parseShortId(slug: string): string | null {
  if (!slug) return null;
  const tail = slug.slice(-SHORT_ID_LEN).toLowerCase();
  return /^[0-9a-f]{8}$/.test(tail) ? tail : null;
}

/**
 * Build the public profile path for a site row, given its state code + fips +
 * id + name. The county segment must match the county page's slug, which is
 * derived from the FIPS-keyed rollup countyName (falling back to the row's own
 * `county` text). Returns null when state/fips/county can't be resolved — such
 * rows are noindex anyway and get no inbound link.
 */
export function siteProfilePath(row: {
  id: string;
  name?: string | null;
  state?: string | null;
  fips_code?: string | null;
  county?: string | null;
}): string | null {
  if (!row.state || !row.fips_code) return null;
  const st = stateByCode(row.state);
  if (!st) return null;
  const countyName = countyRollup(row.fips_code)?.countyName || row.county;
  if (!countyName) return null;
  return `/datacenter-sites/${st.slug}/${countySlug(countyName)}/${siteSlug(row)}`;
}

/**
 * Map an 8-char uuid prefix to the inclusive [lo, hi] uuid range it covers.
 * Used for an exact, PK-indexed REST lookup (PostgREST `like` can't target a
 * uuid column).
 */
export function uuidRangeFromShortId(shortId: string): { lo: string; hi: string } {
  const s = shortId.toLowerCase();
  return {
    lo: `${s}-0000-0000-0000-000000000000`,
    hi: `${s}-ffff-ffff-ffff-ffffffffffff`,
  };
}
