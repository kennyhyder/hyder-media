import type { CSSProperties, ReactNode } from "react";
import { A, serif, mono, scoreColor } from "./theme";

/** Terminal-style label: gold ticker dot + uppercase tracked sans. */
export function Label({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--amb-sans), system-ui, sans-serif",
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        fontSize: 10.5,
        color: A.muted,
        ...style,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: A.accent,
          boxShadow: `0 0 6px ${A.accent}`,
          flex: "none",
        }}
      />
      {children}
    </div>
  );
}

/** Underlined gold tag — terminal field marker, not a pill. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: mono,
        fontSize: 11.5,
        letterSpacing: "0.03em",
        color: A.text,
        borderBottom: `1.5px solid ${A.accent}`,
        paddingBottom: 2,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  pad = 22,
  style,
}: {
  children: ReactNode;
  pad?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: A.surface,
        border: `1px solid ${A.border}`,
        // subtle warm top edge
        borderTop: `1px solid ${A.border}`,
        borderRadius: 6,
        padding: pad,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Signature score treatment — a big serif numeral on the left with a vertical
 * gold tick-ladder on the right whose lit ticks count up to the score. Terminal
 * gauge, not a ring.
 */
export function ScoreGauge({
  score,
  height = 132,
}: {
  score: number | null;
  height?: number;
}) {
  const v = score ?? 0;
  const col = scoreColor(score);
  const ticks = 10;
  const lit = Math.round((v / 100) * ticks);
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 18, height }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <span
          style={{
            fontFamily: serif,
            fontWeight: 600,
            fontSize: height * 0.62,
            lineHeight: 0.9,
            color: col,
            letterSpacing: "-0.02em",
          }}
        >
          {score != null ? Math.round(v) : "—"}
        </span>
        <span style={{ fontFamily: mono, fontSize: 11, color: A.muted, marginTop: 4 }}>
          / 100 readiness
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column-reverse",
          gap: 3,
          justifyContent: "space-between",
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        {Array.from({ length: ticks }).map((_, i) => (
          <span
            key={i}
            style={{
              width: i < lit ? 20 : 13,
              height: 3,
              background: i < lit ? col : A.border,
              alignSelf: "flex-start",
              transition: "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Sub-score: serif label · gold ladder dots. */
export function SubScore({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const v = value ?? 0;
  const col = scoreColor(value);
  const dots = 10;
  const lit = Math.round((v / 100) * dots);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <span style={{ fontFamily: serif, fontSize: 14.5, color: A.text }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 2.5 }}>
          {Array.from({ length: dots }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: i < lit ? col : A.border,
              }}
            />
          ))}
        </div>
        <span
          style={{
            fontFamily: mono,
            fontVariantNumeric: "tabular-nums",
            fontSize: 13,
            color: col,
            width: 22,
            textAlign: "right",
          }}
        >
          {value != null ? Math.round(v) : "—"}
        </span>
      </div>
    </div>
  );
}

/** key/value stat row. */
export function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 0",
        borderBottom: `1px solid ${A.surface2}`,
      }}
    >
      <span style={{ fontFamily: serif, fontSize: 14, color: A.muted }}>{label}</span>
      <span
        style={{
          fontFamily: mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 13,
          color: accent ? A.accent : A.text,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
