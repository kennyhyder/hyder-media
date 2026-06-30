import type { Metadata } from "next";
import Link from "next/link";
import { rollups, national, stateAgg } from "@/lib/rollups";
import { stateName } from "@/lib/geo";
import { topSites } from "@/lib/db";
import { V, mono, scoreColor } from "@/components/preview/brand-voltage/theme";
import { Shell, TopBar } from "@/components/preview/brand-voltage/Shell";
import {
  Card,
  Chip,
  Label,
  ScoreLockup,
  SubScore,
} from "@/components/preview/brand-voltage/ui";

export const metadata: Metadata = {
  title: "Voltage — Brand Direction",
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

export default async function VoltageHome() {
  const va = stateAgg("VA");
  const top = await topSites({ state: "VA" }, 6);

  // Top 4 states by site count for the breakdown rail.
  const topStates = Object.entries(national.byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <Shell>
      <TopBar active="home" />

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1140, margin: "0 auto", padding: "84px 28px 40px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 26 }}>
          <Chip accent>Live · {fmtInt(rollups.totalSites)} sites scored</Chip>
          <Chip>9 ISO regions</Chip>
        </div>
        <h1
          style={{
            fontWeight: 600,
            fontSize: "clamp(2.4rem, 5.4vw, 4.2rem)",
            lineHeight: 0.98,
            letterSpacing: "-0.035em",
            margin: "0 0 22px",
            maxWidth: 880,
          }}
        >
          Find grid-ready land
          <br />
          before the queue closes.
        </h1>
        <p
          style={{
            color: V.muted,
            fontSize: 17,
            lineHeight: 1.6,
            maxWidth: 560,
            margin: "0 0 34px",
          }}
        >
          Every candidate parcel in the U.S., scored on power, speed-to-power,
          fiber, water and hazard. Shortlist sites in minutes — not quarters.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <Link
            href="/preview/brand-voltage/site"
            style={{
              fontFamily: mono,
              fontSize: 13,
              color: V.bg,
              background: V.accent,
              padding: "12px 20px",
              borderRadius: 4,
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            See a scored site →
          </Link>
          <span
            style={{
              fontFamily: mono,
              fontSize: 13,
              color: V.text,
              padding: "12px 20px",
              borderRadius: 4,
              border: `1px solid ${V.border}`,
            }}
          >
            View methodology
          </span>
        </div>
      </section>

      {/* ── STAT STRIP ────────────────────────────────────────── */}
      <section style={{ maxWidth: 1140, margin: "0 auto", padding: "0 28px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            border: `1px solid ${V.border}`,
            borderRadius: 4,
            overflow: "hidden",
            background: V.surface2,
          }}
          className="vlt-stat-strip"
        >
          <StatCell label="Sites catalogued" value={fmtInt(rollups.totalSites)} />
          <StatCell
            label="Avg readiness"
            value={national.avgScore.toFixed(1)}
            accent
            divider
          />
          <StatCell label="Candidate capacity" value={fmtCap(national.totalCapacityMw)} divider />
          <StatCell label="Median queue wait" value={`${national.avgQueueWaitYears.toFixed(1)} yr`} divider />
        </div>
      </section>

      {/* ── FEATURED: top VA sites ────────────────────────────── */}
      <section style={{ maxWidth: 1140, margin: "0 auto", padding: "56px 28px 24px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 20,
          }}
        >
          <div>
            <Label>Featured market · PJM</Label>
            <h2
              style={{
                fontWeight: 600,
                fontSize: 28,
                letterSpacing: "-0.02em",
                margin: "10px 0 0",
              }}
            >
              Virginia&apos;s most build-ready land
            </h2>
          </div>
          <span style={{ fontFamily: mono, fontSize: 12, color: V.muted }}>
            {va ? fmtInt(va.count) : "—"} sites · {va ? va.avgScore.toFixed(1) : "—"} avg
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 320px",
            gap: 20,
            alignItems: "start",
          }}
          className="vlt-feat-grid"
        >
          {/* leaderboard */}
          <Card pad={0} style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "28px minmax(0,1fr) 64px 70px 56px",
                gap: 12,
                padding: "12px 18px",
                borderBottom: `1px solid ${V.border}`,
                fontFamily: mono,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: V.muted,
              }}
            >
              <span>#</span>
              <span>Site</span>
              <span style={{ textAlign: "right" }}>Cap</span>
              <span style={{ textAlign: "right" }}>Queue</span>
              <span style={{ textAlign: "right" }}>Score</span>
            </div>
            {top.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px minmax(0,1fr) 64px 70px 56px",
                  gap: 12,
                  padding: "13px 18px",
                  borderBottom:
                    i === top.length - 1 ? "none" : `1px solid ${V.surface2}`,
                  alignItems: "center",
                }}
              >
                <span style={{ fontFamily: mono, fontSize: 12, color: V.muted }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 14,
                      color: V.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {titleCase(s.name)}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: V.muted }}>
                    {s.county}, {s.state}
                  </span>
                </span>
                <span style={{ fontFamily: mono, fontSize: 12.5, color: V.text, textAlign: "right" }}>
                  {s.available_capacity_mw != null
                    ? `${Math.round(s.available_capacity_mw)}`
                    : "—"}
                </span>
                <span style={{ fontFamily: mono, fontSize: 12.5, color: V.muted, textAlign: "right" }}>
                  {s.avg_queue_wait_years != null
                    ? `${s.avg_queue_wait_years.toFixed(1)}y`
                    : "—"}
                </span>
                <span
                  style={{
                    fontFamily: mono,
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 15,
                    fontWeight: 600,
                    color: scoreColor(s.dc_score),
                    textAlign: "right",
                  }}
                >
                  {s.dc_score != null ? Math.round(s.dc_score) : "—"}
                </span>
              </div>
            ))}
          </Card>

          {/* sub-score profile */}
          <Card>
            <Label>State sub-score profile</Label>
            <div style={{ margin: "14px 0 20px" }}>
              <ScoreLockup score={va?.avgScore ?? null} size="sm" />
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <SubScore label="Power" value={va?.avgSubScores.power} />
              <SubScore label="Speed-to-power" value={va?.avgSubScores.speed} />
              <SubScore label="Fiber" value={va?.avgSubScores.fiber} />
              <SubScore label="Water" value={va?.avgSubScores.water} />
              <SubScore label="Hazard" value={va?.avgSubScores.hazard} />
            </div>
          </Card>
        </div>
      </section>

      {/* ── STATE RAIL ────────────────────────────────────────── */}
      <section style={{ maxWidth: 1140, margin: "0 auto", padding: "32px 28px 8px" }}>
        <Label style={{ marginBottom: 16 }}>Largest inventories</Label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
          }}
          className="vlt-state-rail"
        >
          {topStates.map(([code, count]) => {
            const agg = stateAgg(code);
            return (
              <div
                key={code}
                style={{
                  border: `1px solid ${V.border}`,
                  borderRadius: 4,
                  padding: "16px 16px 14px",
                  background: V.surface,
                }}
              >
                <div style={{ fontSize: 13, color: V.text, marginBottom: 4 }}>
                  {stateName(code)}
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: V.muted, marginBottom: 14 }}>
                  {fmtInt(count)} sites
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 22,
                      fontWeight: 600,
                      color: scoreColor(agg?.avgScore),
                    }}
                  >
                    {agg ? agg.avgScore.toFixed(1) : "—"}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 10.5, color: V.muted }}>
                    avg
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer style={{ maxWidth: 1140, margin: "0 auto", padding: "44px 28px 52px" }}>
        <div
          style={{
            borderTop: `1px solid ${V.border}`,
            paddingTop: 22,
            display: "flex",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <p style={{ color: V.muted, fontSize: 12, lineHeight: 1.6, maxWidth: 600, margin: 0 }}>
            Screening estimates from public grid, FCC, FEMA and WRI datasets.
            Candidate capacity reflects nearby substation headroom — confirm
            deliverable interconnection with the serving utility and ISO queue.
          </p>
          <div style={{ textAlign: "right" }}>
            <Label style={{ marginBottom: 4 }}>Data updated</Label>
            <span style={{ fontFamily: mono, fontSize: 12.5, color: V.text }}>
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
          .vlt-feat-grid { grid-template-columns: 1fr !important; }
          .vlt-state-rail { grid-template-columns: repeat(2, 1fr) !important; }
          .vlt-stat-strip { grid-template-columns: repeat(2, 1fr) !important; }
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
    <div
      style={{
        padding: "20px 22px",
        background: V.surface,
        borderLeft: divider ? `1px solid ${V.border}` : undefined,
      }}
    >
      <div
        style={{
          fontFamily: mono,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontSize: 10,
          color: V.muted,
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: accent ? V.accent : V.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}
