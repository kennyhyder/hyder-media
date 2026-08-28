// Watchtower engine — snapshot diffing, event severity, cadence, and email
// delivery. Used by /api/cron/watchtower-scan and /api/cron/watchtower-digest.
// Spec: grid/docs/watchtower-v1-spec.md
//
// v1 deliberately has NO LLM calls in the cron path (cost safety) — news
// changes ship as headlines; the click-triggered synthesis lives in /vet.

import { gcRead, gcWrite, type GcRole } from "@/lib/auth";
import type { Snapshot } from "@/lib/vet-signals";

// ── Cadence ──────────────────────────────────────────────────────────────────

/** Hours between scans by plan. Pro/enterprise nightly; free weekly. */
export function scanIntervalHours(role: GcRole): number {
  return role === "member" || role === "contributor" ? 7 * 24 : 24;
}

/** Free users get the Monday digest; paid plans daily. */
export function digestDueToday(role: GcRole, now = new Date()): boolean {
  if (role === "member" || role === "contributor") return now.getUTCDay() === 1;
  return true;
}

// ── Diffing ──────────────────────────────────────────────────────────────────

export interface WatchEvent {
  event_type: string;
  severity: "info" | "notable" | "high";
  summary: string;
  payload: Record<string, unknown>;
}

interface ScoreVal {
  dc_score: number | null;
}
interface RegVal {
  label: string;
  gated: string | null;
}
interface NewsItem {
  t: string;
  u: string;
  d: string;
}

function names(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : (x as { n?: string }).n ?? "")).filter(Boolean);
  return [];
}

/** Compare two snapshots signal-by-signal and emit typed events. */
export function diffSnapshots(prev: Snapshot, next: Snapshot): WatchEvent[] {
  const events: WatchEvent[] = [];

  // Score (site watches only)
  if (prev.score && next.score && prev.score.hash !== next.score.hash) {
    const a = (prev.score.value as ScoreVal).dc_score ?? 0;
    const b = (next.score.value as ScoreVal).dc_score ?? 0;
    const delta = Math.round((b - a) * 10) / 10;
    if (Math.abs(delta) >= 0.5) {
      events.push({
        event_type: "score_change",
        severity: Math.abs(delta) >= 5 ? "high" : Math.abs(delta) >= 2 ? "notable" : "info",
        summary: `DC-readiness score ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} (${a} → ${b})`,
        payload: { from: a, to: b, delta },
      });
    }
  }

  if (prev.regulatory && next.regulatory && prev.regulatory.hash !== next.regulatory.hash) {
    const a = prev.regulatory.value as RegVal;
    const b = next.regulatory.value as RegVal;
    events.push({
      event_type: "regulatory",
      severity: "high",
      summary:
        a.label !== b.label
          ? `Regulatory posture changed: ${a.label} → ${b.label}`
          : `Regulatory detail changed at your target MW (${b.gated ?? "gate updated"})`,
      payload: { from: a, to: b },
    });
  }

  if (prev.congestion && next.congestion && prev.congestion.hash !== next.congestion.hash) {
    events.push({
      event_type: "congestion",
      severity: "notable",
      summary: "ERCOT grid-constraint rankings shifted (statewide top bottlenecks changed)",
      payload: { to: next.congestion.value },
    });
  }

  if (prev.pipeline && next.pipeline && prev.pipeline.hash !== next.pipeline.hash) {
    const added = names(next.pipeline.value).filter((n) => !names(prev.pipeline.value).includes(n));
    if (added.length) {
      events.push({
        event_type: "pipeline",
        severity: "notable",
        summary: `New AI datacenter project${added.length > 1 ? "s" : ""} within 75 mi: ${added.join(", ")}`,
        payload: { added },
      });
    }
  }

  if (prev.datacenters && next.datacenters && prev.datacenters.hash !== next.datacenters.hash) {
    const prevNames = ((prev.datacenters.value as { names?: string[] })?.names ?? []) as string[];
    const nextNames = ((next.datacenters.value as { names?: string[] })?.names ?? []) as string[];
    const added = nextNames.filter((n) => !prevNames.includes(n));
    if (added.length) {
      events.push({
        event_type: "datacenter",
        severity: "notable",
        summary: `New datacenter${added.length > 1 ? "s" : ""} nearby: ${added.slice(0, 3).join(", ")}${added.length > 3 ? "…" : ""}`,
        payload: { added },
      });
    }
  }

  if (prev.news && next.news && prev.news.hash !== next.news.hash) {
    const prevUrls = new Set(((prev.news.value as NewsItem[]) ?? []).map((n) => n.u));
    const fresh = ((next.news.value as NewsItem[]) ?? []).filter((n) => !prevUrls.has(n.u));
    if (fresh.length) {
      events.push({
        event_type: "news",
        severity: fresh.length >= 3 ? "notable" : "info",
        summary: `${fresh.length} new local headline${fresh.length > 1 ? "s" : ""}: ${fresh[0].t}`,
        payload: { articles: fresh.slice(0, 6) },
      });
    }
  }

  return events;
}

// ── Email (Resend REST, no SDK) ──────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = { high: "#b0392c", notable: "#a86a12", info: "#6a7382" };

export interface DigestGroup {
  watchLabel: string;
  watchHref: string;
  events: Array<{ severity: string; summary: string; created_at: string }>;
}

export function renderDigestHtml(groups: DigestGroup[], opts: { alert?: boolean } = {}): string {
  const rows = groups
    .map(
      (g) => `
    <tr><td style="padding:14px 0 4px;font-size:15px;font-weight:700;color:#1a1d24">
      <a href="${g.watchHref}" style="color:#6d3ff0;text-decoration:none">${g.watchLabel}</a>
    </td></tr>
    ${g.events
      .map(
        (e) => `
    <tr><td style="padding:3px 0;font-size:13.5px;color:#3d4351">
      <span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${SEV_COLOR[e.severity] ?? "#6a7382"};margin-right:8px"></span>${e.summary}
    </td></tr>`
      )
      .join("")}`
    )
    .join("");

  return `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:28px 20px">
    <div style="font-size:19px;font-weight:800;color:#1a1d24;margin-bottom:2px">Grid<span style="color:#6d3ff0">Census</span> Watchtower</div>
    <div style="font-size:12.5px;color:#6a7382;margin-bottom:18px">${opts.alert ? "High-priority change on a watched location" : "Changes across your watched locations"}</div>
    <div style="background:#fff;border:1px solid #e3e6ec;border-radius:10px;padding:6px 18px 16px">
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>
    <div style="font-size:11.5px;color:#8b93a1;margin-top:14px">
      Manage watches at <a href="https://gridcensus.com/account/watchtower" style="color:#6d3ff0">gridcensus.com/account/watchtower</a>
      · You get ${opts.alert ? "immediate alerts for high-severity changes" : "this digest when watched signals change"}.
    </div>
  </div></body></html>`;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  const key = (process.env.RESEND_API_KEY || "").trim();
  if (!key) return null;
  const from = (process.env.GC_RESEND_FROM || process.env.RESEND_FROM || "").trim();
  if (!from) return null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, reply_to: "kenny@hyder.me" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error("[watchtower] resend failed:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const j = await res.json();
    return (j?.id as string) ?? "sent";
  } catch (e) {
    console.error("[watchtower] resend error:", e);
    return null;
  }
}

/** Count emails of `kind` sent to a user in the trailing `hours`. */
export async function emailsSentRecently(userId: string, kind: string, hours: number): Promise<number> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const rows = await gcRead<{ id: string }>("gc_email_log", {
    user_id: `eq.${userId}`,
    kind: `eq.${kind}`,
    sent_at: `gte.${since}`,
    select: "id",
    limit: "10",
  });
  return rows.length;
}

export async function logEmail(userId: string, kind: string, resendId: string | null): Promise<void> {
  await gcWrite("gc_email_log", "POST", { user_id: userId, kind, resend_id: resendId });
}
