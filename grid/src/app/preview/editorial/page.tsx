import type { Metadata } from "next";
import { national, stateAgg, rollups } from "@/lib/rollups";
import { topSites } from "@/lib/db";
import { stateName, SITE_TYPES } from "@/lib/geo";
import { fmtInt } from "@/lib/format";
import Wrapper, { styles } from "@/components/preview/editorial/Wrapper";
import Masthead from "@/components/preview/editorial/Masthead";
import {
  Kicker,
  Rule,
  SectionHead,
  StatRow,
  SubScoreBreakdown,
  RuledTable,
  ScoreChip,
} from "@/components/preview/editorial/primitives";
import { ChoroplethMap } from "@/components/preview/editorial/MapLoaders";
import { C } from "@/components/preview/editorial/theme";

export const metadata: Metadata = {
  title: "Editorial Light — Design Preview",
  robots: { index: false, follow: false },
};

const FEATURED = "VA";

function monthYear(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default async function EditorialHome() {
  const updated = monthYear(rollups.dataLastUpdated);
  const totalSites = rollups.totalSites;

  // State choropleth data — postal-keyed averages + counts.
  const stateData = Object.entries(rollups.states)
    .map(([code, agg]) => ({
      code,
      avgScore: agg.avgScore,
      count: agg.count,
    }))
    .filter((s) => Number.isFinite(s.avgScore));

  // Featured state (Virginia) + its top sites (real REST query).
  const va = stateAgg(FEATURED)!;
  const vaSites = await topSites({ state: FEATURED }, 10);

  // Leading site types nationally, by count.
  const topTypes = Object.entries(national.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <Wrapper>
      <Masthead dateline={`Updated ${updated} · ${fmtInt(totalSites)} sites screened`} />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className={styles.shell} style={{ padding: "3.5rem 0 2.25rem" }}>
        <div style={{ maxWidth: "44rem" }}>
          <Kicker>Datacenter Site Intelligence</Kicker>
          <h1
            className={styles.serif}
            style={{
              fontSize: "clamp(2.4rem, 5vw, 3.6rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              lineHeight: 1.08,
              color: C.text,
              margin: "0.9rem 0 0",
            }}
          >
            Where the next gigawatt of compute can actually be built.
          </h1>
          <p
            className={styles.serif}
            style={{
              fontSize: "1.1875rem",
              lineHeight: 1.55,
              color: C.muted,
              margin: "1.1rem 0 0",
              maxWidth: "38rem",
            }}
          >
            A continent-wide screening of {fmtInt(totalSites)} candidate parcels —
            scored across power, speed-to-energization, fiber, water, and hazard —
            to surface the ground where hyperscale capacity is genuinely deliverable.
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              marginTop: "1.4rem",
              fontSize: "0.8125rem",
              color: C.muted,
            }}
          >
            <span
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                fontWeight: 600,
                color: C.tealInk,
                fontSize: "0.6875rem",
              }}
            >
              By the GridCensus Data Desk
            </span>
            <span style={{ color: C.hairline }}>│</span>
            <span className={styles.serif} style={{ fontStyle: "italic" }}>
              {updated}
            </span>
          </div>
        </div>
      </section>

      {/* ── MAP ──────────────────────────────────────────────────────────── */}
      <section className={styles.shell} style={{ paddingBottom: "2.5rem" }}>
        <Rule weight="bold" style={{ marginBottom: "0.75rem" }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1.1rem",
          }}
        >
          <div>
            <Kicker>Figure 1 · National Screening</Kicker>
            <h2
              className={styles.serif}
              style={{
                fontSize: "1.4rem",
                fontWeight: 600,
                color: C.text,
                margin: "0.3rem 0 0",
              }}
            >
              Average site score by state
            </h2>
          </div>
          <Legend />
        </div>

        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.hairline}`,
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          }}
        >
          <ChoroplethMap states={stateData} domain={[42, 60]} />
        </div>
        <p
          className={styles.serif}
          style={{
            fontSize: "0.8125rem",
            fontStyle: "italic",
            color: C.muted,
            margin: "0.7rem 0 0",
          }}
        >
          Darker teal indicates a higher mean screening score across the state&rsquo;s
          candidate parcels. Hover any state for its average and site count.
          Base tiles &copy; CARTO &amp; OpenStreetMap.
        </p>
      </section>

      {/* ── NATIONAL FIGURES ─────────────────────────────────────────────── */}
      <section className={styles.shell} style={{ paddingBottom: "2.75rem" }}>
        <SectionHead kicker="The Numbers" title="National figures at a glance" />
        <StatRow
          stats={[
            { figure: fmtInt(national.count), label: "Candidate sites", sub: "across 51 jurisdictions" },
            { figure: national.avgScore.toFixed(1), label: "Mean screening score", sub: "0–100 composite" },
            { figure: (national.totalCapacityMw / 1_000_000).toFixed(1), unit: "GW", label: "Candidate capacity", sub: "indicative, not deliverable" },
            { figure: national.avgQueueWaitYears.toFixed(1), unit: "yrs", label: "Avg. interconnect wait", sub: `${fmtInt(national.avgQueueDepth)}-deep median queue` },
          ]}
        />

        {/* Inventory by site type — editorial mono list. */}
        <div style={{ marginTop: "2rem" }}>
          <Kicker>Inventory by parcel class</Kicker>
          <div style={{ marginTop: "0.85rem" }}>
            {topTypes.map(([key, count], i) => {
              const pct = (count / national.count) * 100;
              const label = SITE_TYPES[key]?.label ?? key;
              return (
                <div
                  key={key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "12rem 1fr 5.5rem",
                    alignItems: "center",
                    gap: "1.25rem",
                    padding: "0.7rem 0",
                    borderTop: i === 0 ? `1px solid ${C.hairline}` : `1px solid ${C.hairlineSoft}`,
                    borderBottom: i === topTypes.length - 1 ? `1px solid ${C.hairline}` : "none",
                  }}
                >
                  <span className={styles.serif} style={{ fontSize: "0.9375rem", color: C.text }}>
                    {label}
                  </span>
                  <div style={{ height: 8, background: "#F1EDE4", borderRadius: 1, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: C.teal, opacity: 0.85 }} />
                  </div>
                  <span
                    className={styles.mono}
                    style={{ fontSize: "0.875rem", color: C.text, textAlign: "right", fontWeight: 500 }}
                  >
                    {fmtInt(count)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FEATURED STATE ───────────────────────────────────────────────── */}
      <section className={styles.shell} style={{ paddingBottom: "3rem" }}>
        <SectionHead
          kicker="State in Focus"
          title={`${stateName(FEATURED)} — the world's densest datacenter market`}
          note={`${fmtInt(va.count)} screened sites`}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,1.15fr)",
            gap: "2.5rem",
            alignItems: "start",
          }}
        >
          {/* Sub-score profile */}
          <div>
            <p
              className={styles.serif}
              style={{ fontSize: "1.0625rem", lineHeight: 1.6, color: C.text, margin: "0 0 1.25rem" }}
            >
              Virginia anchors the PJM interconnection and carries the deepest fiber
              and water resilience in the dataset — though queue depth, the deepest
              in the nation, tempers its speed-to-power story.
            </p>
            <Kicker>Average sub-scores</Kicker>
            <div style={{ marginTop: "0.85rem" }}>
              <SubScoreBreakdown
                scores={[
                  { label: "Power", value: va.avgSubScores.power },
                  { label: "Speed-to-power", value: va.avgSubScores.speed },
                  { label: "Fiber", value: va.avgSubScores.fiber },
                  { label: "Water", value: va.avgSubScores.water },
                  { label: "Hazard resilience", value: va.avgSubScores.hazard },
                ]}
              />
            </div>
          </div>

          {/* Top-10 sites table */}
          <div>
            <Kicker>Leading sites · {stateName(FEATURED)}</Kicker>
            <div style={{ marginTop: "0.85rem" }}>
              <RuledTable
                columns={[
                  {
                    key: "rank",
                    header: "#",
                    width: "2rem",
                    mono: true,
                    align: "right",
                    render: (r) => String((r.rank as number)),
                  },
                  {
                    key: "name",
                    header: "Site",
                    render: (r) => (
                      <span className={styles.serif} style={{ color: C.text }}>
                        {(r.name as string) || "Unnamed parcel"}
                      </span>
                    ),
                  },
                  { key: "county", header: "County" },
                  {
                    key: "type",
                    header: "Class",
                    render: (r) => (
                      <span style={{ color: C.muted, fontSize: "0.8125rem" }}>{r.type as string}</span>
                    ),
                  },
                  {
                    key: "score",
                    header: "Score",
                    align: "right",
                    width: "4rem",
                    render: (r) => <ScoreChip score={r.score as number} />,
                  },
                ]}
                rows={vaSites.map((s, i) => ({
                  rank: i + 1,
                  name: s.name,
                  county: s.county ?? "—",
                  type: SITE_TYPES[s.site_type ?? ""]?.label ?? s.site_type ?? "—",
                  score: s.dc_score,
                }))}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTNOTE ─────────────────────────────────────────────────────── */}
      <Footer updated={updated} />
    </Wrapper>
  );
}

function Legend() {
  const ramp = ["#EDF2F1", "#A6CCC5", "#3C9387", "#0F766E"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
      <span style={{ fontSize: "0.6875rem", color: C.muted, letterSpacing: "0.04em" }}>Lower</span>
      <div style={{ display: "flex", height: 10, width: 120 }}>
        {ramp.map((c) => (
          <div key={c} style={{ flex: 1, background: c }} />
        ))}
      </div>
      <span style={{ fontSize: "0.6875rem", color: C.muted, letterSpacing: "0.04em" }}>Higher</span>
    </div>
  );
}

function Footer({ updated }: { updated: string }) {
  return (
    <footer style={{ background: C.surface, borderTop: `2px solid ${C.text}` }}>
      <div className={styles.shell} style={{ padding: "2rem 0 2.5rem" }}>
        <p
          className={styles.serif}
          style={{
            fontSize: "0.8125rem",
            fontStyle: "italic",
            lineHeight: 1.65,
            color: C.muted,
            maxWidth: "46rem",
            margin: 0,
          }}
        >
          A note on method. Scores are desktop screening estimates derived from
          public infrastructure, hazard, and grid-queue datasets; they rank
          relative suitability and are not a determination that a parcel is
          shovel-ready. Candidate capacity reflects nearby grid headroom, not
          firm, deliverable power — interconnection studies and utility
          confirmation are required before any siting decision.
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "1.5rem",
            paddingTop: "1rem",
            borderTop: `1px solid ${C.hairline}`,
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <span className={styles.serif} style={{ fontWeight: 700, color: C.text }}>
            GridCensus
          </span>
          <span style={{ fontSize: "0.75rem", color: C.muted }}>
            Editorial Light · Design Preview · Data updated {updated}
          </span>
        </div>
      </div>
    </footer>
  );
}
