// Production map design tokens — THEME-AWARE. Unlike the /preview/map theme
// (hardcoded dark "Control Room" constants), every surface here reads the
// global CSS variables defined in globals.css (--surface, --border, --text,
// --muted, --accent + the score ramp). So the map panels/legend adapt to both
// the clean light theme and the Control Room dark theme automatically.

// ── Score ramp ──────────────────────────────────────────────────────────────
// Single source of truth for marker / choropleth / gauge colour. Matches the
// --score-low/mid/high/top vars in globals.css so the map agrees with the rest
// of the app's score colouring.
export function scoreColor(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 75) return "#a3e635"; // top  (lime)
  if (s >= 60) return "#fbbf24"; // high (amber)
  if (s >= 40) return "#fb923c"; // mid  (orange)
  return "#f43f5e"; //              low  (red)
}

/** Translucent glow of the ramp colour for marker halos. */
export function scoreGlow(score: number | null | undefined, alpha = 0.55): string {
  const hex = scoreColor(score);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const mono =
  "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace";
export const sans =
  "var(--font-geist-sans), system-ui, -apple-system, sans-serif";

// ── Theme-aware style fragments (read CSS vars) ─────────────────────────────
// Translucent glass surface used by every floating panel. color-mix keeps it
// legible over the map in BOTH themes (light surface @ 86%, dark surface @ 82%).
export const glass: React.CSSProperties = {
  background: "color-mix(in srgb, var(--surface) 86%, transparent)",
  backdropFilter: "blur(14px) saturate(140%)",
  WebkitBackdropFilter: "blur(14px) saturate(140%)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  boxShadow:
    "0 0 0 1px color-mix(in srgb, var(--border) 50%, transparent), 0 18px 50px -18px rgba(0,0,0,0.45)",
  color: "var(--text)",
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
  color: "var(--muted)",
  fontFamily: sans,
};

// DC-Readiness colour ramp — the legend's single source of truth.
export const RAMP: { label: string; range: string; color: string }[] = [
  { label: "Prime", range: "≥ 75", color: "#a3e635" },
  { label: "Strong", range: "60–75", color: "#fbbf24" },
  { label: "Fair", range: "40–60", color: "#fb923c" },
  { label: "Weak", range: "≤ 40", color: "#f43f5e" },
];

// ── Tile providers (theme-aware) ────────────────────────────────────────────
// CartoDB basemaps: Positron (light) + Dark Matter (dark). Read at runtime from
// the <html> class so a theme toggle re-tiles the map.
export const TILES = {
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  },
} as const;

/** Read the current theme from the <html> class. SSR-safe (returns "light"). */
export function readTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
