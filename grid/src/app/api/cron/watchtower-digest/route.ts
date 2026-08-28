// Watchtower digest cron — daily (vercel.json). Groups undigested events by
// user, honors cadence (Pro daily / free Mondays), sends one Resend email per
// user, marks events digested. Spec: grid/docs/watchtower-v1-spec.md
// Auth: Bearer CRON_SECRET, fail-closed.

import { NextResponse } from "next/server";
import { gcRead, gcWrite, type GcRole } from "@/lib/auth";
import { digestDueToday, renderDigestHtml, sendEmail, emailsSentRecently, logEmail, type DigestGroup } from "@/lib/watchtower";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface EventRow {
  id: string;
  watch_id: string;
  event_type: string;
  severity: string;
  summary: string;
  created_at: string;
}
interface WatchRow {
  id: string;
  user_id: string;
  label: string;
}

function authorized(request: Request): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const events = await gcRead<EventRow>("gc_watch_events", {
    digested_at: "is.null",
    select: "id,watch_id,event_type,severity,summary,created_at",
    order: "created_at.asc",
    limit: "500",
  });
  if (!events.length) return NextResponse.json({ ok: true, users: 0, sent: 0 });

  const watchIds = [...new Set(events.map((e) => e.watch_id))];
  const watches = await gcRead<WatchRow>("gc_watches", {
    id: `in.(${watchIds.join(",")})`,
    select: "id,user_id,label",
  });
  const watchById = new Map(watches.map((w) => [w.id, w]));

  const userIds = [...new Set(watches.map((w) => w.user_id))];
  const users = await gcRead<{ id: string; role: GcRole; email: string | null }>("gc_users", {
    id: `in.(${userIds.join(",")})`,
    select: "id,role,email",
  });
  const byUser = new Map(users.map((u) => [u.id, u]));

  // user -> watch -> events
  const perUser = new Map<string, Map<string, EventRow[]>>();
  for (const e of events) {
    const w = watchById.get(e.watch_id);
    if (!w) continue;
    if (!perUser.has(w.user_id)) perUser.set(w.user_id, new Map());
    const m = perUser.get(w.user_id)!;
    if (!m.has(e.watch_id)) m.set(e.watch_id, []);
    m.get(e.watch_id)!.push(e);
  }

  let sent = 0;
  let skipped = 0;
  for (const [userId, watchMap] of perUser) {
    const user = byUser.get(userId);
    if (!user?.email) {
      skipped++;
      continue;
    }
    if (!digestDueToday(user.role)) {
      skipped++;
      continue;
    }
    // Throttle: one digest per ~20h.
    if ((await emailsSentRecently(userId, "digest", 20)) > 0) {
      skipped++;
      continue;
    }

    const groups: DigestGroup[] = [...watchMap.entries()].map(([watchId, evts]) => ({
      watchLabel: watchById.get(watchId)?.label ?? "Watched location",
      watchHref: "https://gridcensus.com/account/watchtower",
      events: evts.map((e) => ({ severity: e.severity, summary: e.summary, created_at: e.created_at })),
    }));

    const nEvents = [...watchMap.values()].reduce((n, v) => n + v.length, 0);
    const html = renderDigestHtml(groups);
    const id = await sendEmail(
      user.email,
      `Watchtower: ${nEvents} change${nEvents > 1 ? "s" : ""} across ${groups.length} watched location${groups.length > 1 ? "s" : ""}`,
      html
    );
    if (!id) continue;
    sent++;
    await logEmail(userId, "digest", id);

    const ids = [...watchMap.values()].flat().map((e) => e.id);
    await gcWrite(
      "gc_watch_events",
      "PATCH",
      { digested_at: new Date().toISOString() },
      { id: `in.(${ids.join(",")})` }
    );
  }

  return NextResponse.json({ ok: true, users: perUser.size, sent, skipped });
}
