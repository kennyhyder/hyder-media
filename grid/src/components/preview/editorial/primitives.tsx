import type { ReactNode } from "react";
import { C, rampColor } from "./theme";
import { styles } from "./Wrapper";

/* ── Kicker ─────────────────────────────────────────────────────────────────
   Small-caps teal label that opens a section. */
export function Kicker({
  children,
  color = C.tealInk,
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <div
      style={{
        textTransform: "uppercase",
        letterSpacing: "0.16em",
        fontSize: "0.6875rem",
        fontWeight: 600,
        color,
      }}
    >
      {children}
    </div>
  );
}

/* ── Rule ──────────────────────────────────────────────────────────────────
   Hairline horizontal rule between sections. `weight="bold"` = a 2px ink rule
   for top-of-section emphasis (broadsheet style). */
export function Rule({
  weight = "hair",
  style,
}: {
  weight?: "hair" | "bold";
  style?: React.CSSProperties;
}) {
  return (
    <hr
      style={{
        border: 0,
        borderTop:
          weight === "bold" ? `2px solid ${C.text}` : `1px solid ${C.hairline}`,
        margin: 0,
        ...style,
      }}
    />
  );
}

/* ── SectionHead ────────────────────────────────────────────────────────────
   Kicker + serif heading with a top bold rule — the broadsheet section opener. */
export function SectionHead({
  kicker,
  title,
  note,
}: {
  kicker?: string;
  title: string;
  note?: string;
}) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <Rule weight="bold" style={{ marginBottom: "0.75rem" }} />
      {kicker && <Kicker>{kicker}</Kicker>}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          marginTop: kicker ? "0.35rem" : 0,
        }}
      >
        <h2
          className={styles.serif}
          style={{
            fontSize: "1.5rem",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: C.text,
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {title}
        </h2>
        {note && (
          <span style={{ fontSize: "0.75rem", color: C.muted }}>{note}</span>
        )}
      </div>
    </div>
  );
}

/* ── StatRow ────────────────────────────────────────────────────────────────
   A hairline-separated row of editorial statistics: large mono figure over a
   serif label, with a small unit. Used for the national figures band. */
export interface Stat {
  figure: string;
  label: string;
  unit?: string;
  sub?: string;
}

export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
        borderTop: `1px solid ${C.hairline}`,
        borderBottom: `1px solid ${C.hairline}`,
      }}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          style={{
            padding: "1.5rem 1.25rem",
            borderLeft: i === 0 ? "none" : `1px solid ${C.hairline}`,
          }}
        >
          <div
            className={styles.mono}
            style={{
              fontSize: "1.875rem",
              fontWeight: 500,
              color: C.text,
              lineHeight: 1,
              letterSpacing: "-0.01em",
            }}
          >
            {s.figure}
            {s.unit && (
              <span
                style={{
                  fontSize: "0.875rem",
                  color: C.muted,
                  marginLeft: "0.3rem",
                  fontWeight: 400,
                }}
              >
                {s.unit}
              </span>
            )}
          </div>
          <div
            className={styles.serif}
            style={{
              fontSize: "0.9375rem",
              color: C.text,
              marginTop: "0.6rem",
              fontWeight: 500,
            }}
          >
            {s.label}
          </div>
          {s.sub && (
            <div style={{ fontSize: "0.75rem", color: C.muted, marginTop: "0.2rem" }}>
              {s.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── SubScoreBreakdown ──────────────────────────────────────────────────────
   Labeled hairline bars with a teal fill — a calm, editorial alternative to a
   techy gauge. Each row: serif label · thin track · teal fill · mono value. */
export interface SubScore {
  label: string;
  value: number | null | undefined;
}

export function SubScoreBreakdown({
  scores,
  max = 100,
}: {
  scores: SubScore[];
  max?: number;
}) {
  return (
    <div>
      {scores.map((s, i) => {
        const v = s.value;
        const pct =
          v == null || !Number.isFinite(v)
            ? 0
            : Math.max(0, Math.min(100, (v / max) * 100));
        return (
          <div
            key={s.label}
            style={{
              display: "grid",
              gridTemplateColumns: "9.5rem 1fr 3rem",
              alignItems: "center",
              gap: "1rem",
              padding: "0.6rem 0",
              borderTop: i === 0 ? "none" : `1px solid ${C.hairlineSoft}`,
            }}
          >
            <span
              className={styles.serif}
              style={{ fontSize: "0.875rem", color: C.text }}
            >
              {s.label}
            </span>
            <div
              style={{
                height: 6,
                background: "#F1EDE4",
                borderRadius: 1,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: rampColor(v),
                  transition: "width .3s",
                }}
              />
            </div>
            <span
              className={styles.mono}
              style={{
                fontSize: "0.875rem",
                color: v == null ? C.muted : C.text,
                textAlign: "right",
                fontWeight: 500,
              }}
            >
              {v == null || !Number.isFinite(v) ? "—" : v.toFixed(0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── RuledTable ─────────────────────────────────────────────────────────────
   Financial-broadsheet table: top + bottom ink-ish rules, thin row separators,
   no vertical borders, mono figures right-aligned. */
export interface Column {
  key: string;
  header: string;
  align?: "left" | "right";
  mono?: boolean;
  width?: string;
  render?: (row: Record<string, unknown>) => ReactNode;
}

export function RuledTable({
  columns,
  rows,
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
}) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "0.875rem",
      }}
    >
      <thead>
        <tr style={{ borderTop: `2px solid ${C.text}`, borderBottom: `1px solid ${C.hairline}` }}>
          {columns.map((c) => (
            <th
              key={c.key}
              style={{
                textAlign: c.align ?? "left",
                padding: "0.55rem 0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontSize: "0.625rem",
                fontWeight: 600,
                color: C.muted,
                width: c.width,
                whiteSpace: "nowrap",
              }}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr
            key={ri}
            style={{
              borderTop: ri === 0 ? "none" : `1px solid ${C.hairlineSoft}`,
            }}
          >
            {columns.map((c) => (
              <td
                key={c.key}
                className={c.mono ? styles.mono : undefined}
                style={{
                  textAlign: c.align ?? "left",
                  padding: "0.6rem 0.75rem",
                  color: C.text,
                  verticalAlign: "baseline",
                  fontWeight: c.mono ? 500 : 400,
                }}
              >
                {c.render ? c.render(row) : (row[c.key] as ReactNode)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={columns.length} style={{ borderTop: `2px solid ${C.text}`, padding: 0 }} />
        </tr>
      </tfoot>
    </table>
  );
}

/* ── ScoreChip ──────────────────────────────────────────────────────────────
   A restrained mono score chip backed by the teal ramp — for table score cols. */
export function ScoreChip({ score }: { score: number | null | undefined }) {
  const bg = rampColor(score, 35, 75);
  const dark = score != null && score >= 55;
  return (
    <span
      className={styles.mono}
      style={{
        display: "inline-block",
        minWidth: "2.6rem",
        textAlign: "center",
        padding: "0.15rem 0.45rem",
        fontSize: "0.8125rem",
        fontWeight: 600,
        background: bg,
        color: dark ? "#FFFFFF" : C.text,
        borderRadius: 2,
      }}
    >
      {score == null || !Number.isFinite(score) ? "—" : score.toFixed(1)}
    </span>
  );
}
