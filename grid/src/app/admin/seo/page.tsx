import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSupabase } from "@/lib/grid-api/db";
import ApplyButton from "./ApplyButton";

export const metadata: Metadata = {
  title: "SEO Loop — Admin",
  robots: { index: false, follow: false },
};

// Always fresh — this is an internal operational dashboard.
export const dynamic = "force-dynamic";

// ── Data ─────────────────────────────────────────────────────────────────────

interface PerfRow {
  date: string;
  page: string;
  query: string;
  impressions: number | null;
  clicks: number | null;
  position: number | null;
}

interface Opportunity {
  id: string;
  type: string;
  page: string;
  query: string | null;
  impressions: number | null;
  clicks: number | null;
  position: number | null;
  ctr: number | null;
  priority: number | null;
  status: string;
  recommendation: Record<string, unknown> | null;
}

interface DashboardData {
  configured: boolean;
  hasData: boolean;
  summary: { impressions: number; clicks: number; avgPosition: number; ctr: number };
  trend: Array<{ date: string; impressions: number; clicks: number; position: number }>;
  topPages: Array<{ page: string; impressions: number; clicks: number }>;
  topQueries: Array<{ query: string; impressions: number; clicks: number; position: number }>;
  opportunities: Opportunity[];
  lastSync: { status: string; date_to?: string; ran_at?: string; rows_synced?: number } | null;
}

async function loadDashboard(): Promise<DashboardData> {
  const empty: DashboardData = {
    configured: false,
    hasData: false,
    summary: { impressions: 0, clicks: 0, avgPosition: 0, ctr: 0 },
    trend: [],
    topPages: [],
    topQueries: [],
    opportunities: [],
    lastSync: null,
  };

  let sb;
  try {
    sb = getSupabase();
  } catch {
    return empty;
  }
  empty.configured = true;

  // Last 28 days of performance.
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 28);
  const startStr = start.toISOString().slice(0, 10);

  let rows: PerfRow[] = [];
  try {
    const { data, error } = await sb
      .from("gc_gsc_performance")
      .select("date,page,query,impressions,clicks,position")
      .gte("date", startStr)
      .limit(50000);
    if (error) return empty; // table missing → empty state
    rows = (data ?? []) as PerfRow[];
  } catch {
    return empty;
  }

  if (rows.length === 0) {
    // Still load opportunities + last sync (both graceful).
    return { ...empty, hasData: false, ...(await loadOppsAndSync(sb)) };
  }

  // Aggregate summary + trend + top pages/queries.
  let imp = 0;
  let clk = 0;
  let posWeighted = 0;
  const byDate = new Map<string, { impr: number; clk: number; posImpr: number }>();
  const byPage = new Map<string, { impr: number; clk: number }>();
  const byQuery = new Map<string, { impr: number; clk: number; posImpr: number }>();

  for (const r of rows) {
    const i = r.impressions ?? 0;
    const c = r.clicks ?? 0;
    const p = r.position ?? 0;
    imp += i;
    clk += c;
    posWeighted += p * i;

    const d = byDate.get(r.date) ?? { impr: 0, clk: 0, posImpr: 0 };
    d.impr += i;
    d.clk += c;
    d.posImpr += p * i;
    byDate.set(r.date, d);

    if (r.page) {
      const pg = byPage.get(r.page) ?? { impr: 0, clk: 0 };
      pg.impr += i;
      pg.clk += c;
      byPage.set(r.page, pg);
    }
    if (r.query) {
      const q = byQuery.get(r.query) ?? { impr: 0, clk: 0, posImpr: 0 };
      q.impr += i;
      q.clk += c;
      q.posImpr += p * i;
      byQuery.set(r.query, q);
    }
  }

  const summary = {
    impressions: imp,
    clicks: clk,
    avgPosition: imp > 0 ? posWeighted / imp : 0,
    ctr: imp > 0 ? clk / imp : 0,
  };

  const trend = [...byDate.entries()]
    .map(([date, v]) => ({
      date,
      impressions: v.impr,
      clicks: v.clk,
      position: v.impr > 0 ? v.posImpr / v.impr : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topPages = [...byPage.entries()]
    .map(([page, v]) => ({ page, impressions: v.impr, clicks: v.clk }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15);

  const topQueries = [...byQuery.entries()]
    .map(([query, v]) => ({
      query,
      impressions: v.impr,
      clicks: v.clk,
      position: v.impr > 0 ? v.posImpr / v.impr : 0,
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15);

  return {
    configured: true,
    hasData: true,
    summary,
    trend,
    topPages,
    topQueries,
    ...(await loadOppsAndSync(sb)),
  };
}

async function loadOppsAndSync(
  sb: ReturnType<typeof getSupabase>,
): Promise<{ opportunities: Opportunity[]; lastSync: DashboardData["lastSync"] }> {
  let opportunities: Opportunity[] = [];
  try {
    const { data } = await sb
      .from("gc_seo_opportunities")
      .select("id,type,page,query,impressions,clicks,position,ctr,priority,status,recommendation")
      .neq("status", "dismissed")
      .order("priority", { ascending: false })
      .limit(100);
    opportunities = (data ?? []) as Opportunity[];
  } catch {
    /* table missing */
  }

  let lastSync: DashboardData["lastSync"] = null;
  try {
    const { data } = await sb
      .from("gc_gsc_sync_log")
      .select("status,date_to,ran_at,rows_synced")
      .order("ran_at", { ascending: false })
      .limit(1);
    lastSync = (data?.[0] as DashboardData["lastSync"]) ?? null;
  } catch {
    /* graceful */
  }

  return { opportunities, lastSync };
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

const TYPE_LABEL: Record<string, string> = {
  striking_distance: "Striking distance",
  low_ctr: "Low CTR",
  content_gap: "Content gap",
  rising: "Rising",
  declining: "Declining",
};
const TYPE_COLOR: Record<string, string> = {
  striking_distance: "#2563eb",
  low_ctr: "#d97706",
  content_gap: "#7c3aed",
  rising: "#16a34a",
  declining: "#dc2626",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-card rounded-xl p-4">
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold" style={{ color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminSeoPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff") notFound();

  const d = await loadDashboard();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>
          SEO Loop
        </h1>
        {d.lastSync && (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Last sync: {d.lastSync.status}
            {d.lastSync.date_to ? ` · through ${d.lastSync.date_to}` : ""}
            {d.lastSync.ran_at ? ` · ${new Date(d.lastSync.ran_at).toLocaleString()}` : ""}
          </span>
        )}
      </header>

      {!d.hasData ? (
        <div className="surface-card mt-8 rounded-xl p-8 text-center">
          <div className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            No GSC data yet — accumulating since launch
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--muted)" }}>
            The daily Search Console pull runs at 09:00 UTC. Once Google reports
            impressions for GridCensus pages (typically a few days after launch),
            organic trends and ranked opportunities will appear here.
          </p>
          {d.opportunities.length > 0 && (
            <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
              {d.opportunities.length} opportunit
              {d.opportunities.length === 1 ? "y" : "ies"} already queued below.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Summary */}
          <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Impressions (28d)" value={fmt(d.summary.impressions)} />
            <Stat label="Clicks (28d)" value={fmt(d.summary.clicks)} />
            <Stat label="Avg position" value={d.summary.avgPosition.toFixed(1)} />
            <Stat label="CTR" value={pct(d.summary.ctr)} />
          </section>

          {/* Trend */}
          <section className="mt-8">
            <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
              Daily trend
            </h2>
            <div className="surface-card mt-3 overflow-x-auto rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: "var(--muted)" }}>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Impr.</th>
                    <th className="px-3 py-2 text-right">Clicks</th>
                    <th className="px-3 py-2 text-right">Avg pos.</th>
                  </tr>
                </thead>
                <tbody>
                  {d.trend.map((t) => (
                    <tr key={t.date} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-3 py-1.5">{t.date}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(t.impressions)}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(t.clicks)}</td>
                      <td className="px-3 py-1.5 text-right">{t.position.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Top pages + queries */}
          <section className="mt-8 grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
                Top pages
              </h2>
              <div className="surface-card mt-3 overflow-x-auto rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: "var(--muted)" }}>
                      <th className="px-3 py-2 text-left">Page</th>
                      <th className="px-3 py-2 text-right">Impr.</th>
                      <th className="px-3 py-2 text-right">Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.topPages.map((p) => (
                      <tr key={p.page} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="px-3 py-1.5 truncate max-w-[16rem]" title={p.page}>
                          {p.page}
                        </td>
                        <td className="px-3 py-1.5 text-right">{fmt(p.impressions)}</td>
                        <td className="px-3 py-1.5 text-right">{fmt(p.clicks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
                Top queries
              </h2>
              <div className="surface-card mt-3 overflow-x-auto rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: "var(--muted)" }}>
                      <th className="px-3 py-2 text-left">Query</th>
                      <th className="px-3 py-2 text-right">Impr.</th>
                      <th className="px-3 py-2 text-right">Pos.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.topQueries.map((q) => (
                      <tr key={q.query} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="px-3 py-1.5 truncate max-w-[16rem]" title={q.query}>
                          {q.query}
                        </td>
                        <td className="px-3 py-1.5 text-right">{fmt(q.impressions)}</td>
                        <td className="px-3 py-1.5 text-right">{q.position.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Opportunity queue (always shown) */}
      <section className="mt-10">
        <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
          Opportunity queue
        </h2>
        {d.opportunities.length === 0 ? (
          <div className="surface-card mt-3 rounded-xl p-5 text-sm" style={{ color: "var(--muted)" }}>
            No opportunities yet. They appear once GSC data accumulates and the
            engine runs (after each daily pull).
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {d.opportunities.map((o) => {
              const rec = o.recommendation || {};
              const action = (rec.action as string) || "";
              const note = (rec.note as string) || "";
              return (
                <div key={o.id} className="surface-card rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="rounded px-2 py-0.5 text-xs font-semibold text-white"
                          style={{ background: TYPE_COLOR[o.type] || "#64748b" }}
                        >
                          {TYPE_LABEL[o.type] || o.type}
                        </span>
                        {o.status !== "open" && (
                          <span className="text-xs" style={{ color: "var(--muted)" }}>
                            {o.status}
                          </span>
                        )}
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          priority {Math.round(o.priority ?? 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1.5 text-sm font-medium truncate" style={{ color: "var(--text)" }} title={o.page}>
                        {o.page}
                      </div>
                      {o.query && (
                        <div className="text-xs" style={{ color: "var(--muted)" }}>
                          query: <span style={{ color: "var(--text)" }}>{o.query}</span>
                        </div>
                      )}
                      {action && (
                        <div className="mt-1 text-sm" style={{ color: "var(--text)" }}>
                          → {action}
                        </div>
                      )}
                      {note && (
                        <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                          {note}
                        </div>
                      )}
                    </div>
                    {o.status !== "applied" && <ApplyButton opportunityId={o.id} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
