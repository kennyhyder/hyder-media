import type { CSSProperties, ReactNode } from "react";
import { C, display, mono, scoreColor } from "./theme";

/** Solid-corner chip with an indigo left rule — structural, not a pill. */
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
        display: "inline-flex",
        alignItems: "center",
        fontFamily: mono,
        fontSize: 11,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: accent ? C.accentSoft : C.muted,
        background: C.surface2,
        borderLeft: `2px solid ${accent ? C.accent : C.border}`,
        padding: "4px 10px",
        borderRadius: "0 4px 4px 0",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

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
        letterSpacing: "0.13em",
        fontSize: 10.5,
        color: C.muted,
        ...style,
      }}
    >
      {children}
    </div>
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
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: pad,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Signature score gauge — a bespoke 200° segmented arc (NOT a closed ring).
 * 24 ticks sweep from lower-left to lower-right; lit ticks count up to the
 * score in indigo, the rest sit as faint border ticks. Numeral nested in the
 * arc's mouth.
 */
export function ArcScore({
  score,
  size = 168,
}: {
  score: number | null;
  size?: number;
}) {
  const v = score ?? 0;
  const col = scoreColor(score);
  const ticks = 26;
  const lit = Math.round((v / 100) * ticks);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = rOuter - size * 0.085;
  const startDeg = 160; // sweep from lower-left...
  const sweep = 220; //   ...around the top to lower-right
  const segs = Array.from({ length: ticks }).map((_, i) => {
    const a = ((startDeg + (sweep / (ticks - 1)) * i) * Math.PI) / 180;
    const x1 = cx + rInner * Math.cos(a);
    const y1 = cy + rInner * Math.sin(a);
    const x2 = cx + rOuter * Math.cos(a);
    const y2 = cy + rOuter * Math.sin(a);
    return { x1, y1, x2, y2, on: i < lit };
  });

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {segs.map((g, i) => (
          <line
            key={i}
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            stroke={g.on ? col : C.border}
            strokeWidth={size * 0.022}
            strokeLinecap="round"
            opacity={g.on ? 1 : 0.7}
          />
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: display,
            fontWeight: 700,
            fontSize: size * 0.32,
            lineHeight: 1,
            color: col,
            letterSpacing: "-0.03em",
          }}
        >
          {score != null ? Math.round(v) : "—"}
        </span>
        <span style={{ fontFamily: mono, fontSize: size * 0.07, color: C.muted, marginTop: 4 }}>
          READINESS
        </span>
      </div>
    </div>
  );
}

/** Sub-score: label · value · thin indigo-tracked bar with a node cap. */
export function SubScore({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const col = scoreColor(value);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
        <span style={{ fontSize: 13.5, color: C.text }}>{label}</span>
        <span style={{ fontFamily: mono, fontVariantNumeric: "tabular-nums", fontSize: 13, color: col }}>
          {value != null ? Math.round(value) : "—"}
        </span>
      </div>
      <div style={{ height: 3, background: C.surface2, borderRadius: 2, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: 3,
            width: `${v}%`,
            background: col,
            borderRadius: 2,
          }}
        />
        {/* node cap at the end of the fill */}
        <span
          style={{
            position: "absolute",
            top: "50%",
            left: `${v}%`,
            transform: "translate(-50%, -50%)",
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: col,
            boxShadow: `0 0 8px ${col}`,
          }}
        />
      </div>
    </div>
  );
}

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
        borderBottom: `1px solid ${C.surface2}`,
      }}
    >
      <span style={{ fontSize: 13, color: C.muted }}>{label}</span>
      <span
        style={{
          fontFamily: mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 13,
          color: accent ? C.accentSoft : C.text,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
