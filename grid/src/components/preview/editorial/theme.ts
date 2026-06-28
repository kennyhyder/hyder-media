// Editorial Light — scoped design tokens.
// Imported by preview/editorial components only. Does NOT touch the global theme.
// Every value here is applied via inline styles or the scoped wrapper, so the
// rest of the app is unaffected.

export const C = {
  canvas: "#FBFAF7", // warm white page
  surface: "#FFFFFF", // cards / map frames
  hairline: "#E7E2D9", // thin rules + borders
  hairlineSoft: "#EFEBE2", // even fainter row separators
  text: "#1A1A17", // near-black ink
  muted: "#6B6B63", // secondary text
  teal: "#0F766E", // deep teal accent
  tealInk: "#0B5A53", // darker teal for small type on light
  ink: "#1E3A5F", // navy ink secondary accent
  highlight: "#B45309", // warm highlight, used sparingly
} as const;

// Sequential teal ramp (light → dark) used for the choropleth + sub-score bars.
// Anchored at #EDF2F1 (≈no signal) → #0F766E (high signal).
export const RAMP = [
  "#EDF2F1",
  "#CFE2DE",
  "#A6CCC5",
  "#6FB0A6",
  "#3C9387",
  "#1B8175",
  "#0F766E",
] as const;

/**
 * Map a 0–100 score to a teal ramp color. Domain is clamped to roughly the
 * observed state-average band (≈40–62) so the national map shows real contrast
 * rather than washing out (all states land mid-scale on a raw 0–100 domain).
 */
export function rampColor(
  score: number | null | undefined,
  lo = 42,
  hi = 60
): string {
  if (score == null || !Number.isFinite(score)) return "#F2EFE8";
  const t = Math.max(0, Math.min(1, (score - lo) / (hi - lo)));
  const idx = Math.round(t * (RAMP.length - 1));
  return RAMP[idx];
}

// Shared inline-style fragments.
export const kicker: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: C.tealInk,
};

export const hr: React.CSSProperties = {
  border: 0,
  borderTop: `1px solid ${C.hairline}`,
  margin: 0,
};

export const monoNums: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1',
};

// 2-digit state FIPS → USPS postal code, for joining the GeoJSON `id`
// (FIPS) to rollups.json `states` (postal-keyed).
export const FIPS_TO_USPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "72": "PR",
};
