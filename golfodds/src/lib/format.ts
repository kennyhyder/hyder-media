export const MARKET_LABELS: Record<string, string> = {
  win: "Win",
  t5: "Top 5",
  t10: "Top 10",
  t20: "Top 20",
  mc: "Make Cut",
  frl: "First Rd Leader",
};

export const MARKET_ORDER = ["win", "t5", "t10", "t20", "mc", "frl"];

export function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function fmtPctSigned(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export function fmtAmerican(a: number | null | undefined): string {
  if (a == null) return "—";
  return a > 0 ? `+${a}` : `${a}`;
}

// Edge magnitude → tailwind text color class
export function edgeColor(edge: number | null | undefined): string {
  if (edge == null) return "text-neutral-500";
  const abs = Math.abs(edge);
  if (abs >= 0.05) return edge > 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold";
  if (abs >= 0.02) return edge > 0 ? "text-emerald-300" : "text-rose-300";
  if (abs >= 0.005) return edge > 0 ? "text-emerald-200/70" : "text-rose-200/70";
  return "text-neutral-400";
}

// Background tint for edge cells
export function edgeBg(edge: number | null | undefined): string {
  if (edge == null) return "";
  const abs = Math.abs(edge);
  if (abs >= 0.05) return edge > 0 ? "bg-emerald-500/15" : "bg-rose-500/15";
  if (abs >= 0.02) return edge > 0 ? "bg-emerald-500/8" : "bg-rose-500/8";
  return "";
}

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
