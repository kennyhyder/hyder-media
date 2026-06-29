import type { Metadata } from "next";
import Link from "next/link";
import { rollups, national, stateAgg } from "@/lib/rollups";
import { stateName } from "@/lib/geo";
import { topSites } from "@/lib/db";
import { A, serif, sans, mono, scoreColor } from "@/components/preview/brand-amber/theme";
import { Shell, TopBar } from "@/components/preview/brand-amber/Shell";
import { Card, Label, Tag, ScoreGauge, SubScore } from "@/components/preview/brand-amber/ui";

export const metadata: Metadata = {
  title: "Amber — Brand Direction",
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

export default async function AmberHome() {
  const va = stateAgg("VA");
  const top = await topSites({ state: "VA" }, 6);
  const topStates = Object.entries(national.byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const ticker: Array<[string, string]> = [
    ["SITES", fmtInt(rollups.totalSites)],
    ["AVG RDY", national.avgScore.toFixed(1)],
    ["CAPACITY", fmtCap(national.totalCapacityMw)],
    ["QUEUE", `${national.avgQueueWaitYears.toFixed(1)}y`],
    ["PJM", `${fmtInt(national.byIso.PJM ?? 0)} sites`],
    ["ERCOT", `${fmtInt(national.byIso.ERCOT ?? 0)} sites`],
  ];

  return (
    <Shell>
      <TopBar active="home" ticker={ticker} />

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "76px 28px 48px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 280px",
            gap: 48,
            alignItems: "end",
          }}
          className="amb-hero"
        >
          <div>
            <Label style={{ marginBottom: 22 }}>
              Datacenter site intelligence
            </Label>
            <h1
              style={{
                fontFamily: serif,
                fontWeight: 600,
                fontSize: "clamp(2.6rem, 5.2vw, 4.4rem)",
                lineHeight: 1.02,
                letterSpacing: "-0.02em",
                margin: "0 0 20px",
              }}
            >
              The terminal for{" "}
              <span style={{ fontStyle: "italic", color: A.accent }}>
                grid-ready
              </span>{" "}
              land.
            </h1>
            <p
              style={{
                fontFamily: sans,
                color: A.muted,
                fontSize: 17,
                lineHeight: 1.65,
                maxWidth: 540,
                margin: 0,
              }}
            >
              {fmtInt(rollups.totalSites)} candidate parcels across the U.S.
              grid, priced on power, speed-to-power, fiber, water and hazard.
              The desk a site-selection team checks first.
            </p>
            <div style={{ display: "flex", gap: 14, marginTop: 32 }}>
              <Link
                href="/preview/brand-amber/site"
                style={{
                  fontFamily: sans,
                  fontSize: 14,
                  color: A.bg,
                  background: A.accent,
                  padding: "12px 22px",
                  borderRadius: 5,
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                Open a site dossier →
              </Link>
              <span
                style={{
                  fontFamily: sans,
                  fontSize: 14,
                  color: A.text,
                  padding: "12px 22px",
                  borderRadius: 5,
                  border: `1px solid ${A.border}`,
                }}
              >
                Methodology
              </span>
            </div>
          </div>

          {/* national readiness gauge */}
          <Card pad={24}>
            <Label style={{ marginBottom: 18 }}>National avg</Label>
            <ScoreGauge score={national.avgScore} height={120} />
          </Card>
        </div>
      </section>

      {/* ── FEATURED MARKET ───────────────────────────────────── */}
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 28px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <Label>Featured market</Label>
            <h2
              style={{
                fontFamily: serif,
                fontWeight: 600,
                fontSize: 30,
                letterSpacing: "-0.01em",
                margin: "10px 0 0",
              }}
            >
              Virginia <span style={{ fontFamily: mono, fontSize: 16, color: A.muted, fontWeight: 400 }}>· PJM</span>
            </h2>
          </div>
          <span style={{ fontFamily: mono, fontSize: 12.5, color: A.muted }}>
            {va ? fmtInt(va.count) : "—"} sites
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "300px minmax(0,1fr)",
            gap: 20,
            alignItems: "start",
          }}
          className="amb-feat"
        >
          {/* sub-score dossier */}
          <Card>
            <Label style={{ marginBottom: 16 }}>State profile</Label>
            <div style={{ marginBottom: 22 }}>
              <ScoreGauge score={va?.avgScore ?? null} height={96} />
            </div>
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
            <div style={{ padding: "16px 22px", borderBottom: `1px solid ${A.border}` }}>
              <Label>Top sites · ranked by readiness</Label>
            </div>
            {top.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 80px 70px 48px",
                  gap: 14,
                  padding: "15px 22px",
                  borderBottom: i === top.length - 1 ? "none" : `1px solid ${A.surface2}`,
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: serif,
                      fontSize: 16,
                      color: A.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {titleCase(s.name)}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 11, color: A.muted }}>
                    {s.county}, {s.state} · {s.site_type ? titleCase(s.site_type) : "—"}
                  </div>
                </div>
                <span style={{ fontFamily: mono, fontSize: 12.5, color: A.text, textAlign: "right" }}>
                  {s.available_capacity_mw != null ? `${Math.round(s.available_capacity_mw)} MW` : "—"}
                </span>
                <span style={{ fontFamily: mono, fontSize: 12.5, color: A.muted, textAlign: "right" }}>
                  {s.avg_queue_wait_years != null ? `${s.avg_queue_wait_years.toFixed(1)}y` : "—"}
                </span>
                <span
                  style={{
                    fontFamily: serif,
                    fontWeight: 600,
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }} className="amb-rail">
          {topStates.map(([code, count]) => {
            const agg = stateAgg(code);
            return (
              <div
                key={code}
                style={{
                  border: `1px solid ${A.border}`,
                  borderRadius: 6,
                  padding: "18px 20px",
                  background: A.surface,
                }}
              >
                <div style={{ fontFamily: serif, fontSize: 17, color: A.text, marginBottom: 2 }}>
                  {stateName(code)}
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: A.muted, marginBottom: 16 }}>
                  {fmtInt(count)} sites
                </div>
                <span style={{ fontFamily: serif, fontWeight: 600, fontSize: 26, color: scoreColor(agg?.avgScore) }}>
                  {agg ? agg.avgScore.toFixed(1) : "—"}
                </span>
                <span style={{ fontFamily: mono, fontSize: 10.5, color: A.muted, marginLeft: 6 }}>avg readiness</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer style={{ maxWidth: 1120, margin: "0 auto", padding: "44px 28px 52px" }}>
        <div
          style={{
            borderTop: `1px solid ${A.border}`,
            paddingTop: 22,
            display: "flex",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <p style={{ fontFamily: serif, color: A.muted, fontSize: 13, lineHeight: 1.7, maxWidth: 600, margin: 0 }}>
            Screening estimates from public grid, FCC, FEMA and WRI datasets.
            Candidate capacity reflects nearby substation headroom — confirm
            deliverable interconnection with the serving utility and ISO queue.
          </p>
          <div style={{ textAlign: "right" }}>
            <Label style={{ marginBottom: 6 }}>Data updated</Label>
            <span style={{ fontFamily: mono, fontSize: 12.5, color: A.text }}>
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
          .amb-hero { grid-template-columns: 1fr !important; }
          .amb-feat { grid-template-columns: 1fr !important; }
          .amb-rail { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </Shell>
  );
}
