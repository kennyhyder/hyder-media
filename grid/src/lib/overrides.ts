// Overlay-merge read path for GridCensus UGC.
//
// Approved community edits live in gc_entity_overrides (one active row per
// entity+field). They NEVER mutate the canonical ingested grid_* data. At
// render time we read the active overrides for an entity and merge them ON TOP
// of the canonical row. This keeps the ingest pipeline idempotent and lets us
// trust/distrust UGC independently.
//
// Graceful: if gc_entity_overrides doesn't exist yet, fetchOverrides() returns
// [] and mergeOverrides() returns the canonical entity unchanged.

import "server-only";

import { gcRead } from "./auth";

export type EntityType =
  | "site"
  | "substation"
  | "brownfield"
  | "ixp"
  | "datacenter"
  | "company"
  | "county";

export interface OverrideRow {
  field: string;
  value: unknown;
  source: string | null;
}

/**
 * Active overrides for one entity (graceful empty on missing table). Cached
 * (revalidate) so it can run inside ISR/static entity pages without forcing
 * them dynamic. Approved overrides are entity-level (not per-user), so caching
 * is correct; a moderation action busts it on the next revalidate window.
 */
export async function fetchOverrides(
  entityType: EntityType,
  entityId: string,
  revalidate = 3600,
): Promise<OverrideRow[]> {
  if (!entityId) return [];
  return gcRead<OverrideRow>(
    "gc_entity_overrides",
    {
      entity_type: `eq.${entityType}`,
      entity_id: `eq.${entityId}`,
      is_active: "eq.true",
      select: "field,value,source",
    },
    revalidate,
  );
}

export interface MergeResult<T> {
  /** Canonical row with approved overrides applied on top. */
  merged: T;
  /** Which fields were overridden, with their citation (for "community-edited" badges). */
  overridden: Array<{ field: string; source: string | null }>;
}

/**
 * Merge approved overrides onto a canonical entity. Only keys that already
 * exist on the canonical object are overridden (so a stray override can't
 * inject arbitrary fields into render). Pass the override rows you already
 * fetched, or use mergeEntity() to fetch + merge in one call.
 */
export function mergeOverrides<T extends Record<string, unknown>>(
  entity: T,
  overrides: OverrideRow[],
): MergeResult<T> {
  if (!overrides.length) return { merged: entity, overridden: [] };
  const merged: Record<string, unknown> = { ...entity };
  const overridden: Array<{ field: string; source: string | null }> = [];
  for (const o of overrides) {
    if (Object.prototype.hasOwnProperty.call(entity, o.field)) {
      merged[o.field] = o.value;
      overridden.push({ field: o.field, source: o.source });
    }
  }
  return { merged: merged as T, overridden };
}

/** Convenience: fetch active overrides for an entity and merge them in one go. */
export async function mergeEntity<T extends Record<string, unknown>>(
  entityType: EntityType,
  entityId: string,
  entity: T,
): Promise<MergeResult<T>> {
  const overrides = await fetchOverrides(entityType, entityId);
  return mergeOverrides(entity, overrides);
}
