// Daily GSC pull cron for the GridCensus autonomous SEO loop.
//
// Schedule: 0 9 * * * (see vercel.json). GSC data lags 2-3 days, so we pull a
// trailing 3-day window and upsert — idempotent on (date,page,query,device,
// country). After ingest we run the opportunity engine.
//
// Auth: Authorization: Bearer ${CRON_SECRET}. Vercel cron sends this header
// automatically when CRON_SECRET is set as an env var.

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/grid-api/db";
import { gscConfigured, gscQueryAll, gscSiteUrl } from "@/lib/gsc/client";
import { runOpportunityEngine } from "@/lib/gsc/opportunities";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret is configured, allow (e.g. local dev). In prod, set CRON_SECRET.
  if (!secret) return true;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const sb = (() => {
    try {
      return getSupabase();
    } catch {
      return null;
    }
  })();

  // GSC has a 2-3 day reporting lag — pull the last 3 days and upsert.
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 2); // 3-day inclusive window (end-2 .. end)
  const startDate = ymd(start);
  const endDate = ymd(end);

  let rowsPulled = 0;
  let rowsUpserted = 0;
  let status: "success" | "error" = "success";
  let errorMsg: string | null = null;

  if (!gscConfigured()) {
    status = "error";
    errorMsg = "GSC not configured (missing GSC_* env vars)";
  } else if (!sb) {
    status = "error";
    errorMsg = "Supabase not configured";
  } else {
    try {
      const gscRows = await gscQueryAll({
        startDate,
        endDate,
        dimensions: ["date", "page", "query"],
      });
      rowsPulled = gscRows.length;

      if (gscRows.length > 0) {
        // dimensions order: [date, page, query]
        const records = gscRows.map((r) => ({
          date: r.keys[0],
          page: r.keys[1],
          query: r.keys[2],
          device: "", // not in this dimension set; part of unique key
          country: "", // not in this dimension set; part of unique key
          impressions: Math.round(r.impressions ?? 0),
          clicks: Math.round(r.clicks ?? 0),
          ctr: r.ctr ?? 0,
          position: r.position ?? 0,
        }));

        const CHUNK = 500;
        for (let i = 0; i < records.length; i += CHUNK) {
          const chunk = records.slice(i, i + CHUNK);
          const { error } = await sb
            .from("gc_gsc_performance")
            .upsert(chunk, { onConflict: "date,page,query,device,country" });
          if (error) {
            status = "error";
            errorMsg = `upsert failed: ${error.message}`;
            break;
          }
          rowsUpserted += chunk.length;
        }
      }
    } catch (e) {
      status = "error";
      errorMsg = (e as Error).message;
    }
  }

  // Run the opportunity engine (best-effort, even on a 0-row pull).
  let opportunities: Awaited<ReturnType<typeof runOpportunityEngine>> | null = null;
  if (status === "success" && sb) {
    try {
      opportunities = await runOpportunityEngine();
    } catch (e) {
      opportunities = { ok: false, analyzed: 0, upserted: 0, byType: {}, error: (e as Error).message };
    }
  }

  // Write a sync-log row (best-effort). Schema:
  // gc_gsc_sync_log(id, ran_at, date_from, date_to, rows_synced, status, note).
  if (sb) {
    const noteParts = [
      `site=${gscSiteUrl()}`,
      `pulled=${rowsPulled}`,
      `upserted=${rowsUpserted}`,
      `opps=${opportunities?.upserted ?? 0}`,
    ];
    if (errorMsg) noteParts.push(`error=${errorMsg}`);
    if (opportunities?.error) noteParts.push(`oppErr=${opportunities.error}`);
    try {
      await sb.from("gc_gsc_sync_log").insert({
        ran_at: startedAt.toISOString(),
        date_from: startDate,
        date_to: endDate,
        rows_synced: rowsUpserted,
        status,
        note: noteParts.join(" · ").slice(0, 1000),
      });
    } catch {
      /* give up on logging, don't fail the request */
    }
  }

  return NextResponse.json(
    {
      ok: status === "success",
      range: { startDate, endDate },
      rowsPulled,
      rowsUpserted,
      opportunities,
      error: errorMsg,
    },
    { status: status === "success" ? 200 : 500 },
  );
}
