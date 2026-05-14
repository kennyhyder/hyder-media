// Shared formatting + market taxonomy used across all golf views.

export const MARKET_LABELS: Record<string, string> = {
  win: "Win",
  t5: "Top 5",
  t10: "Top 10",
  t20: "Top 20",
  t40: "Top 40",
  mc: "Make Cut",
  frl: "First Rd Leader",
  r1lead: "R1 Leader",
  r2lead: "R2 Leader",
  r3lead: "R3 Leader",
  r1t5: "R1 Top 5",
  r1t10: "R1 Top 10",
  r1t20: "R1 Top 20",
  r2t5: "R2 Top 5",
  r2t10: "R2 Top 10",
  r3t5: "R3 Top 5",
  r3t10: "R3 Top 10",
  eagle: "Eagle in Round",
  low_score: "Lowest Round Score",
};

export const MARKET_ORDER = [
  "win", "t5", "t10", "t20", "t40", "mc",
  "r1lead", "r2lead", "r3lead",
  "r1t5", "r1t10", "r1t20",
  "r2t5", "r2t10",
  "r3t5", "r3t10",
  "eagle", "low_score",
];

export const MARKET_GROUPS: { label: string; types: string[] }[] = [
  { label: "Tournament", types: ["win", "t5", "t10", "t20", "t40", "mc"] },
  { label: "Round leader", types: ["r1lead", "r2lead", "r3lead"] },
  { label: "Round top N", types: ["r1t5", "r1t10", "r1t20", "r2t5", "r2t10", "r3t5", "r3t10"] },
  { label: "Props", types: ["eagle", "low_score"] },
];

export const PROP_LABELS: Record<string, string> = {
  winning_score: "Winning Score",
  stroke_margin: "Margin of Victory",
  winner_region: "Winner Region",
  hole_in_one: "Holes-in-One",
  cut_line: "Cut Line",
};

export const BOOK_LABELS: Record<string, string> = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
  circa: "Circa",
  pinnacle: "Pinnacle",
  bet365: "bet365",
  betonline: "BetOnline",
  bovada: "Bovada",
  skybet: "SkyBet",
  williamhill: "William Hill",
  pointsbet: "PointsBet",
  unibet: "Unibet",
  betcris: "Betcris",
  betway: "Betway",
};

export function bookLabel(key: string): string {
  return BOOK_LABELS[key] || key;
}

export function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function fmtPctSigned(p: number | null | undefined, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function fmtAmerican(a: number | null | undefined): string {
  if (a == null) return "—";
  return a > 0 ? `+${a}` : `${a}`;
}

// Edge color helpers — must read well on BOTH light and dark backgrounds.
// Mid-range shades (600/500) for text in light mode, brighter (400/300) in dark.
// Backgrounds get higher opacity in light mode since /8 is invisible on white.
export function edgeTextClass(edge: number | null | undefined): string {
  if (edge == null) return "text-muted-foreground";
  const abs = Math.abs(edge);
  if (abs >= 0.05) return edge > 0 ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-rose-600 dark:text-rose-400 font-semibold";
  if (abs >= 0.02) return edge > 0 ? "text-emerald-700/90 dark:text-emerald-300" : "text-rose-700/90 dark:text-rose-300";
  if (abs >= 0.005) return edge > 0 ? "text-emerald-700/70 dark:text-emerald-200/70" : "text-rose-700/70 dark:text-rose-200/70";
  return "text-muted-foreground";
}

export function edgeBgClass(edge: number | null | undefined): string {
  if (edge == null) return "";
  const abs = Math.abs(edge);
  if (abs >= 0.05) return edge > 0 ? "bg-emerald-500/20 dark:bg-emerald-500/15" : "bg-rose-500/20 dark:bg-rose-500/15";
  if (abs >= 0.02) return edge > 0 ? "bg-emerald-500/10 dark:bg-emerald-500/8" : "bg-rose-500/10 dark:bg-rose-500/8";
  return "";
}
