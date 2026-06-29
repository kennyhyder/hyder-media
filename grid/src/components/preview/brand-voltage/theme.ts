// Voltage palette — electric-lime infra tool (Linear / Railway feel).
// Accent used sparingly as a SIGNAL, never as fill.

export const V = {
  bg: "#0A0B0D",
  surface: "#131519",
  surface2: "#0F1115",
  border: "#232830",
  text: "#ECEFF3",
  muted: "#8B919B",
  accent: "#C4F000", // electric lime — used as a signal only
  // a dimmer lime for hairlines / glows
  accentDim: "rgba(196,240,0,0.14)",
} as const;

export const display = "var(--vlt-display), ui-sans-serif, system-ui, sans-serif";
export const mono = "var(--vlt-mono), ui-monospace, monospace";

// Restrained 3-stop readiness ramp — desaturated so the lime accent stays the
// only truly vivid color on the page.
export function scoreColor(s: number | null | undefined): string {
  if (s == null) return V.muted;
  if (s >= 75) return "#C4F000"; // lime — the signal, reserved for top tier
  if (s >= 60) return "#9FB4C2"; // cool slate
  if (s >= 40) return "#6E7682";
  return "#565E69";
}
