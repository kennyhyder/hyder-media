import type { CSSProperties, ReactNode } from "react";
import { V, mono, scoreColor } from "./theme";

/** Thin 1px-outline chip. Sharp 4px corners, no fill. */
export function Chip({
  children,
  accent,
}: {
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      style={{
        fontFamily: mono,
        fontSize: 11,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: accent ? V.accent : V.muted,
        border: `1px solid ${accent ? "rgba(196,240,0,0.4)" : V.border}`,
        borderRadius: 4,
        padding: "3px 8px",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Eyebrow label — uppercase mono, tight. */
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
        fontFamily: mono,
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        fontSize: 10.5,
        color: V.muted,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Card({
  children,
  pad = 20,
  style,
}: {
  children: ReactNode;
  pad?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: V.surface,
        border: `1px solid ${V.border}`,
        borderRadius: 4,
        padding: pad,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Signature score lockup — a big mono numeral with a thin segmented track
 * beneath. NOT a ring. The track fills in the accent only for the achieved
 * portion; the rest is hairline. Lime reserved for ≥75.
 */
export function ScoreLockup({
  score,
  size = "lg",
}: {
  score: number | null;
  size?: "lg" | "sm";
}) {
  const v = score ?? 0;
  const col = scoreColor(score);
  const big = size === "lg";
  const segs = 20;
  const filled = Math.round((v / 100) * segs);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontFamily: mono,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            fontSize: big ? 64 : 30,
            lineHeight: 1,
            color: col,
            letterSpacing: "-0.02em",
          }}
        >
          {score != null ? Math.round(v) : "—"}
        </span>
        <span
          style={{
            fontFamily: mono,
            fontSize: big ? 14 : 11,
            color: V.muted,
          }}
        >
          /100
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: big ? 3 : 2,
          marginTop: big ? 16 : 10,
        }}
      >
        {Array.from({ length: segs }).map((_, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: big ? 10 : 6,
              background: i < filled ? col : V.border,
              opacity: i < filled ? 1 : 0.6,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Sub-score row: label · mono value · hairline bar. */
export function SubScore({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const v = value ?? 0;
  const col = scoreColor(value);
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 13, color: V.text }}>{label}</span>
        <span
          style={{
            fontFamily: mono,
            fontVariantNumeric: "tabular-nums",
            fontSize: 13,
            color: col,
          }}
        >
          {value != null ? Math.round(v) : "—"}
        </span>
      </div>
      <div style={{ height: 2, background: V.border, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${Math.max(0, Math.min(100, v))}%`,
            background: col,
          }}
        />
      </div>
    </div>
  );
}

/** key/value stat row in detail cards. */
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
        padding: "9px 0",
        borderBottom: `1px solid ${V.surface2}`,
      }}
    >
      <span style={{ fontSize: 13, color: V.muted }}>{label}</span>
      <span
        style={{
          fontFamily: mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 13,
          color: accent ? V.accent : V.text,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
