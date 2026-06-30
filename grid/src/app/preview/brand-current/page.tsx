import type { Metadata } from "next";
import Link from "next/link";
import { rollups, national, stateAgg } from "@/lib/rollups";
import { stateName } from "@/lib/geo";
import { topSites } from "@/lib/db";
import { C, display, mono, scoreColor } from "@/components/preview/brand-current/theme";
import { Shell, TopBar } from "@/components/preview/brand-current/Shell";
import { Card, Chip, Label, ArcScore, SubScore } from "@/components/preview/brand-current/ui";

export const metadata: Metadata = {
  title: "Current — Brand Direction",
  robots: { index: false, follow: false },
};

export const revalidate = 86400;

function fmtInt(n: number) {
  return n.toLocaleString("en-US");
}
function fmtCap(mw: number) {
  if (mw >= 1_000_000) return `${(mw / 1_000_000).toFixed(1)} TW`;
  if (mw >= 1000) return `${(mw / 1000).toFixed(0)} GW`;
  return `${mw.toFixed(0)} MW`;
}
function titleCase(s: string | null) {
  if (!s) return "Unnamed site";
  return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export default async function CurrentHome() {
  const va = stateAgg("VA");
  const top = await topSites({ state: "VA" }, 5);
  const topStates = Object.entries(national.byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <Shell>
      <TopBar active="home" />

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "92px 28px 44px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 28 }}>
          <Chip accent>Live · {fmtInt(rollups.totalSites)} sites</Chip>
          <Chip>9 ISO regions</Chip>
        </div>
        <h1
          style={{
            fontFamily: display,
            fontWeight: 800,
            fontSize: "clamp(2.6rem, 5.6vw, 4.6rem)",
            lineHeight: 1.0,
            letterSpacing: "-0.035em",
            margin: "0 auto 22px",
            maxWidth: 920,
          }}
        >
          The definitive map of{" "}
          <span style={{ color: C.accentSoft }}>grid-ready</span> land.
        </h1>
        <p
          style={{
            color: C.muted,
            fontSize: 18,
            lineHeight: 1.6,
            maxWidth: 600,
            margin: "0 auto 34px",
          }}
        >
          Every U.S. candidate parcel, scored on power, speed-to-power, fiber,
          water and hazard. Authoritative data for the teams siting the next
          generation of datacenters.
        </p>
        <div style={{ display: "flex", gap: 14, justifyContent: "center" }}>
          <Link
            href="/preview/brand-current/site"
            style={{
              fontFamily: display,
              fontSize: 14.5,
              fontWeight: 600,
              color: "#fff",
              background: C.accent,
              padding: "13px 24px",
              borderRadius: 8,
              textDecoration: "none",
              boxShadow: "0 8px 26px -8px rgba(99,102,241,0.9)",
            }}
          >
            Explore a scored site →
          </Link>
          <span
            style={{
              fontFamily: display,
              fontSize: 14.5,
              fontWeight: 500,
              color: C.text,
              padding: "13px 24px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}
          >
            How we score
          </span>
        </div>
      </section>

      {/* ── STAT STRIP ────────────────────────────────────────── */}
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "8px 28px 0" }}>
        <Card pad={0} style={{ overflow: "hidden" }}>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}
            className="cur-stat"
          >
            <StatCell label="Sites catalogued" value={fmtInt(rollups.totalSites)} />
            <StatCell label="Avg readiness" value={national.avgScore.toFixed(1)} accent divider />
            <StatCell label="Candidate capacity" value={fmtCap(national.totalCapacityMw)} divider />
            <StatCell label="Median queue wait" value={`${national.avgQueueWaitYears.toFixed(1)} yr`} divider />
          </div>
        </Card>
      </section>

      {/* ── FEATURED MARKET ───────────────────────────────────── */}
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "56px 28px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
          <div>
            <Label>Featured market · PJM</Label>
            <h2 style={{ fontFamily: display, fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em", margin: "10px 0 0" }}>
              Virginia&apos;s build-ready leaders
            </h2>
          </div>
          <span style={{ fontFamily: mono, fontSize: 12.5, color: C.muted }}>
            {va ? fmtInt(va.count) : "—"} sites
          </span>
        </div>

        <div
          style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr)", gap: 20, alignItems: "start" }}
          className="cur-feat"
        >
          {/* state arc + sub-scores */}
          <Card>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
              <ArcScore score={va?.avgScore ?? null} size={172} />
            </div>
            <Label style={{ marginBottom: 14, textAlign: "center" }}>State sub-score profile</Label>
            <div style={{ display: "grid", gap: 13 }}>
              <SubScore label="Power" value={va?.avgSubScores.power} />
              <SubScore label="Speed-to-power" value={va?.avgSubScores.speed} />
              <SubScore label="Fiber" value={va?.avgSubScores.fiber} />
              <SubScore label="Water" value={va?.avgSubScores.water} />
              <SubScore label="Hazard" value={va?.avgSubScores.hazard} />
            </div>
          </Card>

          {/* leaderboard */}
          <Card pad={0} style={{ overflow: "hidden" }}>
            <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}` }}>
              <Label>Top sites · ranked by readiness</Label>
            </div>
            {top.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 86px 64px 56px",
                  gap: 14,
                  padding: "16px 22px",
                  borderBottom: i === top.length - 1 ? "none" : `1px solid ${C.surface2}`,
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 500,
                      color: C.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {titleCase(s.name)}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 11, color: C.muted }}>
                    {s.county}, {s.state}
                  </div>
                </div>
                <span style={{ fontFamily: mono, fontSize: 12.5, color: C.text, textAlign: "right" }}>
                  {s.available_capacity_mw != null ? `${Math.round(s.available_capacity_mw)} MW` : "—"}
                </span>
                <span style={{ fontFamily: mono, fontSize: 12.5, color: C.muted, textAlign: "right" }}>
                  {s.avg_queue_wait_years != null ? `${s.avg_queue_wait_years.toFixed(1)}y` : "—"}
                </span>
                <span
                  style={{
                    fontFamily: display,
                    fontWeight: 700,
                    fontSize: 19,
                    color: scoreColor(s.dc_score),
                    textAlign: "right",
                  }}
                >
                  {s.dc_score != null ? Math.round(s.dc_score) : "—"}
                </span>
              </div>
            ))}
          </Card>
        </div>
      </section>

      {/* ── STATE RAIL ────────────────────────────────────────── */}
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 28px 8px" }}>
        <Label style={{ marginBottom: 16 }}>Largest inventories</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }} className="cur-rail">
          {topStates.map(([code, count]) => {
            const agg = stateAgg(code);
            return (
              <Card key={code} pad={20}>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 2 }}>
                  {stateName(code)}
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: C.muted, marginBottom: 16 }}>
                  {fmtInt(count)} sites
                </div>
                <span style={{ fontFamily: display, fontWeight: 700, fontSize: 26, color: scoreColor(agg?.avgScore) }}>
                  {agg ? agg.avgScore.toFixed(1) : "—"}
                </span>
                <span style={{ fontFamily: mono, fontSize: 10.5, color: C.muted, marginLeft: 6 }}>avg</span>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer style={{ maxWidth: 1120, margin: "0 auto", padding: "44px 28px 52px" }}>
        <div
          style={{
            borderTop: `1px solid ${C.border}`,
            paddingTop: 22,
            display: "flex",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.6, maxWidth: 600, margin: 0 }}>
            Screening estimates from public grid, FCC, FEMA and WRI datasets.
            Candidate capacity reflects nearby substation headroom — confirm
            deliverable interconnection with the serving utility and ISO queue.
          </p>
          <div style={{ textAlign: "right" }}>
            <Label style={{ marginBottom: 6 }}>Data updated</Label>
            <span style={{ fontFamily: mono, fontSize: 12.5, color: C.text }}>
              {new Date(rollups.dataLastUpdated).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </footer>

      <style>{`
        @media (max-width: 860px) {
          .cur-feat { grid-template-columns: 1fr !important; }
          .cur-rail { grid-template-columns: repeat(2, 1fr) !important; }
          .cur-stat { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </Shell>
  );
}

function StatCell({
  label,
  value,
  accent,
  divider,
}: {
  label: string;
  value: string;
  accent?: boolean;
  divider?: boolean;
}) {
  return (
    <div style={{ padding: "22px 24px", borderLeft: divider ? `1px solid ${C.border}` : undefined }}>
      <div
        style={{
          fontFamily: mono,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontSize: 10,
          color: C.muted,
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: display,
          fontVariantNumeric: "tabular-nums",
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: accent ? C.accentSoft : C.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}
