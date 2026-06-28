// Server-only account data reads (saved sites / lists / alerts). All graceful:
// returns empty arrays if the gc_ tables don't exist yet.

import "server-only";
import { gcRead } from "./auth";
import type { EntityType } from "./overrides";

export interface SavedSite {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  label: string | null;
  meta: Record<string, unknown>;
  note: string | null;
  created_at: string;
}

export async function getSavedSites(userId: string): Promise<SavedSite[]> {
  return gcRead<SavedSite>("gc_saved_sites", {
    user_id: `eq.${userId}`,
    select: "*",
    order: "created_at.desc",
    limit: "200",
  });
}

export interface UserList {
  id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  slug: string | null;
  created_at: string;
}

export async function getLists(userId: string): Promise<UserList[]> {
  return gcRead<UserList>("gc_lists", {
    user_id: `eq.${userId}`,
    select: "*",
    order: "created_at.desc",
    limit: "100",
  });
}

export interface Alert {
  id: string;
  alert_type: string;
  params: Record<string, unknown>;
  channel: string;
  is_active: boolean;
  last_fired_at: string | null;
  created_at: string;
}

export async function getAlerts(userId: string): Promise<Alert[]> {
  return gcRead<Alert>("gc_alerts", {
    user_id: `eq.${userId}`,
    select: "*",
    order: "created_at.desc",
    limit: "100",
  });
}

/** Is a given entity saved by this user? Used to set the Save button state. */
export async function isSaved(
  userId: string,
  entityType: EntityType,
  entityId: string,
): Promise<boolean> {
  const rows = await gcRead<{ id: string }>("gc_saved_sites", {
    user_id: `eq.${userId}`,
    entity_type: `eq.${entityType}`,
    entity_id: `eq.${entityId}`,
    select: "id",
    limit: "1",
  });
  return rows.length > 0;
}
