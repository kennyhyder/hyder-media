// Watchtower scan cron — every 30 min (vercel.json), cursor-free: each run
// takes the oldest-due active watches (bounded batch), re-assembles signals,
// diffs vs the last snapshot, and emits events. High-severity events send an
// immediate alert email (capped). Spec: grid/docs/watchtower-v1-spec.md
//
// Auth: Authorization: Bearer ${CRON_SECRET} — FAIL-CLOSED (unlike older crons;
// per the estate rule: new ingest crons are protected fail-closed).

import { NextResponse } from "next/server";
import { gcRead, gcWrite, type GcRole } from "@/lib/auth";
import { assembleVetData, buildSnapshot, snapshotHash, type Snapshot, type SiteScoreRow } from "@/lib/vet-signals";
import {
  scanIntervalHours,
  diffSnapshots,
  renderDigestHtml,
  sendEmail,
  emailsSentRecently,
  logEmail,
} from "@/lib/watchtower";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 25;
const SOFT_DEADLINE_MS = 45_000;
const SNAPSHOT_KEEP = 10;
const ALERT_DAILY_CAP = 3;

interface WatchRow {
  id: string;
  user_id: string;
  kind: "site" | "place" | "query";
  dc_site_id: string | null;
  lat: number | null;
  lng: number | null;
  label: string;
  target_mw: number | null;
  last_scanned_at: string | null;
}

function authorized(request: Request): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return false; // fail closed
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();

  // Oldest-scanned first; nulls (never scanned) first.
  const watches = await gcRead<WatchRow>("gc_watches", {
    is_active: "eq.true",
    select: "id,user_id,kind,dc_site_id,lat,lng,label,target_mw,last_scanned_at",
    order: "last_scanned_at.asc.nullsfirst",
    limit: String(BATCH * 3),
  });
  if (!watches.length) return NextResponse.json({ ok: true, scanned: 0, due: 0 });

  // Role per user (cadence).
  const userIds = [...new Set(watches.map((w) => w.user_id))];
  const users = await gcRead<{ id: string; role: GcRole; email: string | null }>("gc_users", {
    id: `in.(${userIds.join(",")})`,
    select: "id,role,email",
  });
  const byUser = new Map(users.map((u) => [u.id, u]));

  const now = Date.now();
  const due = watches
    .filter((w) => {
      const role = byUser.get(w.user_id)?.role ?? "member";
      if (!w.last_scanned_at) return true;
      return now - Date.parse(w.last_scanned_at) >= scanIntervalHours(role) * 3600_000;
    })
    .slice(0, BATCH);

  let scanned = 0;
  let changed = 0;
  let alerts = 0;
  const errors: string[] = [];

  for (const w of due) {
    if (Date.now() - started > SOFT_DEADLINE_MS) break;
    try {
      if (w.lat == null || w.lng == null || w.kind === "query") {
        await touch(w.id);
        continue;
      }

      // Site-kind watches also snapshot the score row.
      let site: SiteScoreRow | null = null;
      if (w.kind === "site" && w.dc_site_id) {
        const rows = await gcRead<SiteScoreRow>("grid_dc_sites", {
          id: `eq.${w.dc_site_id}`,
          select: "dc_score,score_power,score_speed_to_power,score_fiber",
          limit: "1",
        });
        site = rows[0] ?? null;
      }

      const data = await assembleVetData({ lat: w.lat, lng: w.lng, label: w.label }, w.target_mw, w.label);
      const snap = buildSnapshot(data, site);
      const hash = snapshotHash(snap);

      const prevRows = await gcRead<{ id: string; signals: Snapshot; signals_hash: string }>(
        "gc_watch_snapshots",
        { watch_id: `eq.${w.id}`, select: "id,signals,signals_hash", order: "taken_at.desc", limit: "1" }
      );
      const prev = prevRows[0];

      if (!prev) {
        await gcWrite("gc_watch_snapshots", "POST", { watch_id: w.id, signals: snap, signals_hash: hash });
        await gcWrite("gc_watch_events", "POST", {
          watch_id: w.id,
          event_type: "baseline",
          severity: "info",
          summary: `Watch started — baseline captured for ${w.label}`,
          payload: { signals: Object.keys(snap) },
        });
      } else if (prev.signals_hash !== hash) {
        const events = diffSnapshots(prev.signals, snap);
        await gcWrite("gc_watch_snapshots", "POST", { watch_id: w.id, signals: snap, signals_hash: hash });
        for (const e of events) {
          await gcWrite("gc_watch_events", "POST", { watch_id: w.id, ...e });
        }
        if (events.length) changed++;

        // Immediate alerts for high severity (capped per user per day).
        const highs = events.filter((e) => e.severity === "high");
        const user = byUser.get(w.user_id);
        if (highs.length && user?.email) {
          const sent = await emailsSentRecently(w.user_id, "alert", 24);
          if (sent < ALERT_DAILY_CAP) {
            const html = renderDigestHtml(
              [
                {
                  watchLabel: w.label,
                  watchHref: "https://gridcensus.com/account/watchtower",
                  events: highs.map((e) => ({ severity: e.severity, summary: e.summary, created_at: "" })),
                },
              ],
              { alert: true }
            );
            const id = await sendEmail(user.email, `⚡ Watchtower alert: ${w.label}`, html);
            if (id) {
              alerts++;
              await logEmail(w.user_id, "alert", id);
              // Mark the alerted events as digested so the next digest doesn't repeat them.
              await gcWrite(
                "gc_watch_events",
                "PATCH",
                { digested_at: new Date().toISOString() },
                { watch_id: `eq.${w.id}`, severity: "eq.high", digested_at: "is.null" }
              );
            }
          }
        }

        // Prune old snapshots beyond SNAPSHOT_KEEP.
        const all = await gcRead<{ id: string }>("gc_watch_snapshots", {
          watch_id: `eq.${w.id}`,
          select: "id",
          order: "taken_at.desc",
          limit: "50",
        });
        const stale = all.slice(SNAPSHOT_KEEP).map((r) => r.id);
        if (stale.length) {
          await gcWrite("gc_watch_snapshots", "DELETE", undefined, { id: `in.(${stale.join(",")})` });
        }
      }

      await touch(w.id);
      scanned++;
    } catch (e) {
      errors.push(`${w.id}: ${e instanceof Error ? e.message : String(e)}`);
      await touch(w.id); // don't wedge the queue on a poison watch
    }
  }

  return NextResponse.json({
    ok: true,
    due: due.length,
    scanned,
    changed,
    alerts,
    errors: errors.slice(0, 5),
    ms: Date.now() - started,
  });
}

async function touch(watchId: string): Promise<void> {
  await gcWrite("gc_watches", "PATCH", { last_scanned_at: new Date().toISOString() }, { id: `eq.${watchId}` });
}
