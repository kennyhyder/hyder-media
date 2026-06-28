import React from "react";
import { CR, card, labelStyle, mono, scoreColor, scoreColorSoft } from "./theme";

export function Label({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <div style={{ ...labelStyle, ...style }}>{children}</div>;
}

export function Card({
  children,
  style,
  pad = 20,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  pad?: number;
}) {
  return <div style={{ ...card, padding: pad, ...style }}>{children}</div>;
}

/** Small score chip — mono number on a translucent ramp-coloured pill. */
export function ScoreChip({ score }: { score: number | null | undefined }) {
  const c = scoreColor(score);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 44,
        padding: "2px 8px",
        borderRadius: 6,
        fontFamily: mono,
        fontVariantNumeric: "tabular-nums",
        fontSize: 13,
        fontWeight: 600,
        color: c,
        background: scoreColorSoft(score),
        border: `1px solid ${c}44`,
      }}
    >
      {score == null ? "—" : score.toFixed(1)}
    </span>
  );
}

/** Cyan-outline pill, glows on no JS needed (static). */
export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: CR.cyan,
        border: `1px solid ${CR.cyan}55`,
        background: "rgba(34,211,238,.06)",
        fontFamily: mono,
      }}
    >
      {children}
    </span>
  );
}

/** A single key/value stat row used inside the profile cards. */
export function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "9px 0",
        borderBottom: `1px solid ${CR.border}`,
        gap: 16,
      }}
    >
      <span style={{ ...labelStyle, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontFamily: mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 14,
          fontWeight: 600,
          color: accent ? CR.cyan : CR.text,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
