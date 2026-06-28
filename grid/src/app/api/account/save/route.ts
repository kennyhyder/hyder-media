// Toggle a saved/watched entity for the current user.
// POST { entity_type, entity_id, label?, meta? }  -> { saved: boolean }
// Graceful: if gc_saved_sites doesn't exist, gcWrite returns null -> 503-ish
// JSON the client surfaces softly.

import { NextResponse } from "next/server";
import { getCurrentUser, gcRead, gcWrite } from "@/lib/auth";
import type { EntityType } from "@/lib/overrides";

const ENTITY_TYPES = new Set<EntityType>([
  "site", "substation", "brownfield", "ixp", "datacenter", "company", "county",
]);

// GET ?entity_type=&entity_id= -> { signedIn, saved }
// Lets client Save buttons on STATIC entity pages resolve their own state
// without forcing the page dynamic server-side.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ signedIn: false, saved: false });
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entity_type") as EntityType | null;
  const entityId = searchParams.get("entity_id");
  if (!entityType || !ENTITY_TYPES.has(entityType) || !entityId) {
    return NextResponse.json({ signedIn: true, saved: false });
  }
  const rows = await gcRead<{ id: string }>("gc_saved_sites", {
    user_id: `eq.${user.id}`,
    entity_type: `eq.${entityType}`,
    entity_id: `eq.${entityId}`,
    select: "id",
    limit: "1",
  });
  return NextResponse.json({ signedIn: true, saved: rows.length > 0 });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  let body: {
    entity_type?: string;
    entity_id?: string;
    label?: string;
    meta?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const entityType = body.entity_type as EntityType;
  const entityId = body.entity_id;
  if (!entityType || !ENTITY_TYPES.has(entityType) || !entityId) {
    return NextResponse.json({ error: "bad_entity" }, { status: 400 });
  }

  // Already saved? -> unsave.
  const existing = await gcRead<{ id: string }>("gc_saved_sites", {
    user_id: `eq.${user.id}`,
    entity_type: `eq.${entityType}`,
    entity_id: `eq.${entityId}`,
    select: "id",
    limit: "1",
  });

  if (existing.length) {
    const del = await gcWrite("gc_saved_sites", "DELETE", undefined, {
      id: `eq.${existing[0].id}`,
    });
    if (del === null) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    return NextResponse.json({ saved: false });
  }

  const ins = await gcWrite("gc_saved_sites", "POST", {
    user_id: user.id,
    entity_type: entityType,
    entity_id: entityId,
    label: body.label ?? null,
    meta: body.meta ?? {},
  });
  if (ins === null) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ saved: true });
}
