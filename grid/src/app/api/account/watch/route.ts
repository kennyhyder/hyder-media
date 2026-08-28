// Watchtower watch CRUD. Spec: grid/docs/watchtower-v1-spec.md
//
//   GET  ?dc_site_id=  | ?lat=&lng=      -> { signedIn, watched, id? }  (button state)
//   GET  (no params)                     -> { signedIn, watches: [...] } (account page)
//   POST { kind:'site', dc_site_id, label?, target_mw? }
//   POST { kind:'place', lat, lng, label, target_mw? }
//   DELETE { id }
//
// Plan caps (watch count): member/contributor 1 · owner (Pro) 25 ·
// enterprise/moderator/staff unlimited. Free tier is the upgrade funnel.

import { NextResponse } from "next/server";
import { getCurrentUser, gcRead, gcWrite, type GcRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const WATCH_LIMITS: Record<GcRole, number> = {
  member: 1,
  contributor: 1,
  owner: 25,
  enterprise: Infinity,
  moderator: Infinity,
  staff: Infinity,
};

export interface WatchRow {
  id: string;
  kind: "site" | "place" | "query";
  dc_site_id: string | null;
  lat: number | null;
  lng: number | null;
  label: string;
  target_mw: number | null;
  is_active: boolean;
  last_scanned_at: string | null;
  created_at: string;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ signedIn: false, watched: false });
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get("dc_site_id");
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (siteId || (lat && lng)) {
    const params: Record<string, string> = {
      user_id: `eq.${user.id}`,
      is_active: "eq.true",
      select: "id",
      limit: "1",
    };
    if (siteId) params.dc_site_id = `eq.${siteId}`;
    else {
      params.lat = `eq.${lat}`;
      params.lng = `eq.${lng}`;
    }
    const rows = await gcRead<{ id: string }>("gc_watches", params);
    return NextResponse.json({ signedIn: true, watched: rows.length > 0, id: rows[0]?.id ?? null });
  }

  const watches = await gcRead<WatchRow>("gc_watches", {
    user_id: `eq.${user.id}`,
    is_active: "eq.true",
    select: "id,kind,dc_site_id,lat,lng,label,target_mw,is_active,last_scanned_at,created_at",
    order: "created_at.desc",
    limit: "200",
  });
  const limit = WATCH_LIMITS[user.role] ?? 1;
  return NextResponse.json({
    signedIn: true,
    role: user.role,
    limit: Number.isFinite(limit) ? limit : null,
    watches,
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  let body: {
    kind?: string;
    dc_site_id?: string | number;
    lat?: number;
    lng?: number;
    label?: string;
    target_mw?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== "site" && kind !== "place") {
    // 'query' watches are reserved for v2 — reject honestly rather than
    // accepting a watch the scan cron won't process.
    return NextResponse.json({ error: "kind must be 'site' or 'place'" }, { status: 400 });
  }
  if (kind === "site" && body.dc_site_id == null) {
    return NextResponse.json({ error: "dc_site_id required" }, { status: 400 });
  }
  if (kind === "place" && (typeof body.lat !== "number" || typeof body.lng !== "number" || !body.label)) {
    return NextResponse.json({ error: "lat, lng, label required" }, { status: 400 });
  }

  // Plan cap.
  const existing = await gcRead<{ id: string }>("gc_watches", {
    user_id: `eq.${user.id}`,
    is_active: "eq.true",
    select: "id",
    limit: "500",
  });
  const limit = WATCH_LIMITS[user.role] ?? 1;
  if (existing.length >= limit) {
    return NextResponse.json(
      {
        error: "watch_limit",
        limit: Number.isFinite(limit) ? limit : null,
        upgrade: user.role === "member" || user.role === "contributor" ? "/pricing" : null,
      },
      { status: 402 }
    );
  }

  // Dedupe: same target twice is a no-op success.
  const dupParams: Record<string, string> = {
    user_id: `eq.${user.id}`,
    is_active: "eq.true",
    select: "id",
    limit: "1",
  };
  if (kind === "site") dupParams.dc_site_id = `eq.${body.dc_site_id}`;
  else {
    dupParams.lat = `eq.${body.lat}`;
    dupParams.lng = `eq.${body.lng}`;
  }
  const dup = await gcRead<{ id: string }>("gc_watches", dupParams);
  if (dup.length) return NextResponse.json({ ok: true, id: dup[0].id, deduped: true });

  let label = (body.label || "").slice(0, 160);
  let lat = body.lat ?? null;
  let lng = body.lng ?? null;

  if (kind === "site") {
    // Resolve coords + a display label from the site row so the scan cron
    // never has to join back to grid_dc_sites for geometry.
    const sites = await gcRead<{
      id: string;
      name: string | null;
      county: string | null;
      state: string | null;
      latitude: number | null;
      longitude: number | null;
    }>("grid_dc_sites", {
      id: `eq.${body.dc_site_id}`,
      select: "id,name,county,state,latitude,longitude",
      limit: "1",
    });
    const site = sites[0];
    if (!site) return NextResponse.json({ error: "site_not_found" }, { status: 404 });
    lat = site.latitude;
    lng = site.longitude;
    if (!label) {
      label = site.name || [site.county, site.state].filter(Boolean).join(", ") || `Site ${site.id}`;
    }
  }

  const rows = await gcWrite<{ id: string }>("gc_watches", "POST", {
    user_id: user.id,
    kind,
    dc_site_id: kind === "site" ? String(body.dc_site_id) : null,
    lat,
    lng,
    label,
    target_mw: typeof body.target_mw === "number" ? body.target_mw : null,
  });
  if (!rows || !rows[0]) return NextResponse.json({ error: "write_failed" }, { status: 503 });
  return NextResponse.json({ ok: true, id: rows[0].id });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // Hard delete (cascades snapshots/events); user_id filter scopes ownership.
  const res = await gcWrite("gc_watches", "DELETE", undefined, {
    id: `eq.${body.id}`,
    user_id: `eq.${user.id}`,
  });
  return NextResponse.json({ ok: res !== null });
}
