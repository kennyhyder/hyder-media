// Current palette — authoritative deep-navy + electric indigo. Crisp indigo
// hairlines; accent used as a structural rule, not a fill.

export const C = {
  bg: "#0B1020",
  surface: "#141B30",
  surface2: "#0F1626",
  border: "#232C45",
  text: "#E6EAF2",
  muted: "#8993A8",
  accent: "#6366F1", // electric indigo
  accentSoft: "#A5B4FC",
  accentDim: "rgba(99,102,241,0.16)",
} as const;

export const display = "var(--cur-display), ui-sans-serif, system-ui, sans-serif";
export const mono = "var(--cur-mono), ui-monospace, monospace";

// Indigo-anchored readiness ramp.
export function scoreColor(s: number | null | undefined): string {
  if (s == null) return C.muted;
  if (s >= 75) return "#A5B4FC"; // bright indigo — top
  if (s >= 60) return "#818CF8";
  if (s >= 40) return "#6E7796";
  return "#586079";
}
