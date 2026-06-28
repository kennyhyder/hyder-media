// Submit a contribution (suggest-edit / report). REQUIRES a source citation.
// POST { entity_type, entity_id, kind?, diff?, source, note? } -> { status }
//
// Writes to gc_contributions only — NEVER to canonical grid_* data. Approval
// later promotes the diff into gc_entity_overrides (the overlay-merge layer).

import { NextResponse } from "next/server";
import { getCurrentUser, gcWrite } from "@/lib/auth";
import type { EntityType } from "@/lib/overrides";

const ENTITY_TYPES = new Set<EntityType>([
  "site", "substation", "brownfield", "ixp", "datacenter", "company", "county",
]);
const KINDS = new Set(["edit", "add", "report_stale", "report_incorrect"]);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  let body: {
    entity_type?: string;
    entity_id?: string;
    kind?: string;
    diff?: Record<string, unknown>;
    source?: string;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const entityType = body.entity_type as EntityType;
  const entityId = body.entity_id;
  const kind = body.kind || "edit";
  const source = (body.source || "").trim();

  if (!entityType || !ENTITY_TYPES.has(entityType) || !entityId) {
    return NextResponse.json({ error: "bad_entity" }, { status: 400 });
  }
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "bad_kind" }, { status: 400 });
  }
  // Source is REQUIRED for everything except a plain stale report.
  if (kind !== "report_stale" && !source) {
    return NextResponse.json({ error: "source_required" }, { status: 400 });
  }

  const ins = await gcWrite("gc_contributions", "POST", {
    entity_type: entityType,
    entity_id: entityId,
    kind,
    diff: body.diff ?? {},
    source: source || "(stale report — no source)",
    note: body.note ?? null,
    submitter_id: user.id,
    status: "pending",
  });
  if (ins === null) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  await gcWrite("gc_activity_log", "POST", {
    actor_id: user.id,
    action: "contribution_submitted",
    entity_type: entityType,
    entity_id: entityId,
    detail: { kind },
  });

  return NextResponse.json({ status: "pending" });
}
