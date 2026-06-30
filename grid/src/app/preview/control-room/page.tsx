import type { Metadata } from "next";
import { rollups, national, stateAgg } from "@/lib/rollups";
import { STATES, stateName } from "@/lib/geo";
import { topSites } from "@/lib/db";
import { CR, mono, sans, scoreColor } from "@/components/preview/control-room/theme";
import TopBar from "@/components/preview/control-room/TopBar";
import { ChoroplethClient } from "@/components/preview/control-room/MapClient";
import { Card, Label, Tag } from "@/components/preview/control-room/ui";
import SubScoreBar from "@/components/preview/control-room/SubScoreBar";
import TerminalTable from "@/components/preview/control-room/TerminalTable";
import type { StateDatum } from "@/components/preview/control-room/ChoroplethMap";

export const metadata: Metadata = {
  title: "Control Room — Design Preview",
  robots: { index: false, follow: false },
};

export const revalidate = 86400;

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}
function fmtCap(mw: number): string {
  if (mw >= 1_000_000) return `${(mw / 1_000_000).toFixed(1)} TW`;
  if (mw >= 1000) return `${(mw / 1000).toFixed(0)} GW`;
  return `${mw.toFixed(0)} MW`;
}
function monthYear(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", { month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

export default async function ControlRoomHome() {
  // Build the choropleth dataset keyed by full state name (GeoJSON join key).
  const states: Record<string, StateDatum> = {};
  for (const s of STATES) {
    const agg = stateAgg(s.code);
    if (!agg) continue;
    states[s.name] = {
      code: s.code,
      name: s.name,
      avgScore: agg.avgScore,
      count: agg.count,
    };
  }

  const va = stateAgg("VA");
  const vaSites = await topSites({ state: "VA" }, 10);

  return (
    <div
      style={{
        // Break out of the light root <main> container into a full-bleed dark
        // canvas. Root padding is px-4 py-6 on a max-w-7xl centered main.
        background: CR.canvas,
        color: CR.text,
        fontFamily: sans,
        margin: "-24px -16px",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 0 0 1px #1F2A40",
      }}
    >
      <TopBar />

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section
        style={{
          position: "relative",
          padding: "72px 32px 48px",
          maxWidth: 1180,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(900px 380px at 18% -10%, rgba(34,211,238,.10), transparent 60%), radial-gradient(700px 320px at 95% 0%, rgba(163,230,53,.06), transparent 55%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative" }}>
          <Tag>Datacenter site-selection intelligence</Tag>
          <h1
            style={{
              fontFamily: sans,
              fontWeight: 800,
              fontSize: "clamp(2.1rem, 4.6vw, 3.5rem)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: "22px 0 18px",
              maxWidth: 880,
            }}
          >
            Where can you energize{" "}
            <span
              style={{
                color: CR.cyan,
                textShadow: "0 0 28px rgba(34,211,238,.45)",
              }}
            >
              500&nbsp;MW
            </span>{" "}
            in under 3&nbsp;years?
          </h1>
          <p
            style={{
              color: CR.muted,
              fontSize: 17,
              lineHeight: 1.6,
              maxWidth: 620,
              margin: "0 0 30px",
            }}
          >
            We scored {fmtInt(rollups.totalSites)} candidate parcels across the
            U.S. grid on power, speed-to-power, fiber, water and hazard — so you
            can shortlist sites in minutes, not quarters.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <a
              href="#map"
              style={{
                fontFamily: sans,
                fontSize: 15,
                fontWeight: 600,
                color: CR.canvas,
                background: CR.cyan,
                padding: "12px 22px",
                borderRadius: 10,
                textDecoration: "none",
                boxShadow: "0 0 26px -6px rgba(34,211,238,.8)",
              }}
            >
              Explore the national map →
            </a>
            <a
              href="#virginia"
              style={{
                fontFamily: sans,
                fontSize: 15,
                fontWeight: 600,
                color: CR.cyan,
                padding: "12px 22px",
                borderRadius: 10,
                textDecoration: "none",
                border: `1px solid ${CR.cyan}66`,
                background: "rgba(34,211,238,.05)",
              }}
            >
              See Virginia ranking
            </a>
          </div>
        </div>
      </section>

      {/* ── NATIONAL STAT BAND ───────────────────────────────────── */}
      <section style={{ maxWidth: 1180, margin: "0 auto", padding: "0 32px 8px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            border: `1px solid ${CR.border}`,
            borderRadius: 12,
            background: CR.surface,
            overflow: "hidden",
          }}
        >
          <StatCell label="Catalogued sites" value={fmtInt(rollups.totalSites)} />
          <StatCell
            label="Avg readiness"
            value={national.avgScore.toFixed(1)}
            accent={scoreColor(national.avgScore)}
            divider
          />
          <StatCell
            label="Candidate capacity"
            value={fmtCap(national.totalCapacityMw)}
            divider
          />
          <StatCell
            label="Avg queue wait"
            value={`${national.avgQueueWaitYears.toFixed(1)} yrs`}
            divider
          />
        </div>
      </section>

      {/* ── NATIONAL MAP ─────────────────────────────────────────── */}
      <section
        id="map"
        style={{ maxWidth: 1180, margin: "0 auto", padding: "40px 32px 16px" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <Label>National readiness · state choropleth</Label>
            <h2
              style={{
                fontSize: 26,
                fontWeight: 700,
                margin: "8px 0 0",
                letterSpacing: "-0.01em",
              }}
            >
              Average site readiness by state
            </h2>
          </div>
          <Legend />
        </div>
        <ChoroplethClient states={states} height="560px" />
      </section>

      {/* ── FEATURED STATE: VIRGINIA ─────────────────────────────── */}
      <section
        id="virginia"
        style={{ maxWidth: 1180, margin: "0 auto", padding: "44px 32px 16px" }}
      >
        <Label>Featured market</Label>
        <h2
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: "8px 0 22px",
            letterSpacing: "-0.01em",
          }}
        >
          Virginia{" "}
          <span style={{ color: CR.muted, fontWeight: 400, fontSize: 18 }}>
            · {va ? fmtInt(va.count) : "—"} sites · PJM
          </span>
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 340px) minmax(0, 1fr)",
            gap: 20,
            alignItems: "start",
          }}
          className="cr-va-grid"
        >
          <Card pad={22}>
            <Label>Sub-score profile · state avg</Label>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                margin: "10px 0 20px",
              }}
            >
              <span
                style={{
                  fontFamily: mono,
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 40,
                  fontWeight: 700,
                  color: scoreColor(va?.avgScore),
                  textShadow: `0 0 22px ${scoreColor(va?.avgScore)}55`,
                }}
              >
                {va?.avgScore.toFixed(1) ?? "—"}
              </span>
              <span style={{ color: CR.muted, fontSize: 13 }}>avg readiness</span>
            </div>
            <div style={{ display: "grid", gap: 16 }}>
              <SubScoreBar label="Power" value={va?.avgSubScores.power} />
              <SubScoreBar label="Speed-to-power" value={va?.avgSubScores.speed} />
              <SubScoreBar label="Fiber" value={va?.avgSubScores.fiber} />
              <SubScoreBar label="Water" value={va?.avgSubScores.water} />
              <SubScoreBar label="Hazard" value={va?.avgSubScores.hazard} />
            </div>
          </Card>

          <Card pad={0} style={{ overflow: "hidden" }}>
            <div
              style={{
                padding: "16px 20px 14px",
                borderBottom: `1px solid ${CR.border}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Label>Top 10 sites · {stateName("VA")}</Label>
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: CR.muted,
                  letterSpacing: "0.06em",
                }}
              >
                ORDER BY dc_score DESC
              </span>
            </div>
            <TerminalTable sites={vaSites} />
          </Card>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "40px 32px 56px",
        }}
      >
        <div
          style={{
            borderTop: `1px solid ${CR.border}`,
            paddingTop: 22,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <p
            style={{
              color: CR.muted,
              fontSize: 12.5,
              lineHeight: 1.6,
              maxWidth: 640,
              margin: 0,
            }}
          >
            Scores are screening estimates derived from public grid, FCC, FEMA and
            WRI datasets. Candidate capacity reflects nearby substation headroom and
            is <em>not</em> a guarantee of deliverable interconnection — confirm with
            the serving utility and ISO queue before siting.
          </p>
          <div style={{ textAlign: "right" }}>
            <Label style={{ marginBottom: 4 }}>Data updated</Label>
            <span
              style={{
                fontFamily: mono,
                fontVariantNumeric: "tabular-nums",
                fontSize: 13,
                color: CR.text,
              }}
            >
              {monthYear(rollups.dataLastUpdated)}
            </span>
          </div>
        </div>
      </footer>

      <style>{`
        @media (max-width: 760px) {
          .cr-va-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
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
  accent?: string;
  divider?: boolean;
}) {
  return (
    <div
      style={{
        padding: "20px 22px",
        borderLeft: divider ? `1px solid ${CR.border}` : undefined,
      }}
    >
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: 10.5,
          color: CR.muted,
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 28,
          fontWeight: 700,
          color: accent || CR.text,
          textShadow: accent ? `0 0 22px ${accent}40` : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Legend() {
  const stops = [
    { c: "#F43F5E", l: "≤40" },
    { c: "#FB923C", l: "40–60" },
    { c: "#FBBF24", l: "60–75" },
    { c: "#A3E635", l: "≥75" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: 10.5,
          color: CR.muted,
        }}
      >
        Readiness
      </span>
      <div style={{ display: "flex", gap: 10 }}>
        {stops.map((s) => (
          <span
            key={s.l}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: s.c,
                boxShadow: `0 0 8px -1px ${s.c}`,
              }}
            />
            <span
              style={{
                fontFamily: mono,
                fontSize: 11,
                color: CR.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.l}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
