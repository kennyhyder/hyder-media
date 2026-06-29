// Amber palette — warm Bloomberg-terminal-meets-modern. Gold accent used as a
// hairline edge + figure highlight, never a fill.

export const A = {
  bg: "#15161A",
  surface: "#1E2026",
  surface2: "#191B20",
  border: "#2C2F37",
  text: "#EDE9E3",
  muted: "#969089",
  accent: "#F5A623", // amber / gold
  accentDim: "rgba(245,166,35,0.16)",
} as const;

export const serif = "var(--amb-serif), Georgia, serif";
export const sans = "var(--amb-sans), ui-sans-serif, system-ui, sans-serif";
export const mono = "var(--amb-mono), ui-monospace, monospace";

// Warm 4-stop readiness ramp tuned to the amber world.
export function scoreColor(s: number | null | undefined): string {
  if (s == null) return A.muted;
  if (s >= 75) return "#F5A623"; // gold — top tier
  if (s >= 60) return "#D8B27A"; // muted gold
  if (s >= 40) return "#A89A86";
  return "#857B6E";
}
