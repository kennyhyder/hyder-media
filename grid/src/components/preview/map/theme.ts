// Map-preview design tokens. Scoped to /preview/map only. Reuses the shared
// Control Room palette + score ramp for visual consistency, then adds the
// glass-panel fragments specific to the map-first "front door" treatment.
//
// These are plain JS constants used in inline styles so they never touch the
// global light theme. Do NOT import into shared/production components.

import { CR, scoreColor, mono, sans } from "@/components/preview/control-room/theme";

export { CR, scoreColor, mono, sans };

/** Soft glow halo colour for a marker at a given score (rgba string). */
export function scoreGlow(score: number | null | undefined, alpha = 0.55): string {
  const hex = scoreColor(score);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Translucent glass surface used by every floating panel.
export const glass: React.CSSProperties = {
  background: "rgba(10,14,26,0.78)",
  backdropFilter: "blur(14px) saturate(140%)",
  WebkitBackdropFilter: "blur(14px) saturate(140%)",
  border: `1px solid ${CR.border}`,
  borderRadius: 14,
  boxShadow:
    "0 0 0 1px rgba(31,42,64,0.5), 0 18px 50px -18px rgba(0,0,0,0.7), 0 0 40px -28px rgba(34,211,238,0.5)",
  color: CR.text,
  fontFamily: sans,
};

export const monoFigure: React.CSSProperties = {
  fontFamily: mono,
  fontVariantNumeric: "tabular-nums",
};

export const labelStyle: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  fontSize: 10.5,
  color: CR.muted,
  fontFamily: sans,
};

// DC-Readiness colour ramp — the legend's single source of truth.
export const RAMP: { label: string; range: string; color: string }[] = [
  { label: "Prime", range: "≥ 75", color: "#A3E635" },
  { label: "Strong", range: "60–75", color: "#FBBF24" },
  { label: "Fair", range: "40–60", color: "#FB923C" },
  { label: "Weak", range: "≤ 40", color: "#F43F5E" },
];
