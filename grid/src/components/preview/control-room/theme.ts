// Control Room design-preview theme tokens. Scoped to /preview/control-room
// pages only — these are plain JS constants used in inline styles so they never
// touch the global light theme. Do NOT import into shared/production components.

export const CR = {
  canvas: "#0A0E1A",
  surface: "#121829",
  surface2: "#0F1422",
  border: "#1F2A40",
  text: "#E6EDF7",
  muted: "#8A97AD",
  cyan: "#22D3EE",
  lime: "#A3E635",
} as const;

// Score ramp — single source of truth for every gauge / bar / chip.
export function scoreColor(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 75) return "#A3E635"; // lime
  if (s >= 60) return "#FBBF24"; // amber
  if (s >= 40) return "#FB923C"; // orange
  return "#F43F5E"; // red
}

// Slightly translucent fill of the same ramp colour, for tracks / chip bgs.
export function scoreColorSoft(score: number | null | undefined): string {
  const c = scoreColor(score);
  return c + "22";
}

export const mono =
  "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace";
export const sans =
  "var(--font-geist-sans), system-ui, -apple-system, sans-serif";

// Reusable inline style fragments.
export const card: React.CSSProperties = {
  background: CR.surface,
  border: `1px solid ${CR.border}`,
  borderRadius: 12,
  boxShadow: "0 0 0 1px rgba(31,42,64,.6), 0 8px 30px -12px rgba(34,211,238,.15)",
};

export const labelStyle: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 11,
  color: CR.muted,
  fontFamily: sans,
};

export const monoFigure: React.CSSProperties = {
  fontFamily: mono,
  fontVariantNumeric: "tabular-nums",
};
