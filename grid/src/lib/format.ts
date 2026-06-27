// Display formatters shared across pSEO pages.

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Intl.NumberFormat("en-US").format(Math.round(n));
}

export function fmtScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

export function fmtMw(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M MW`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k MW`;
  return `${fmtInt(n)} MW`;
}

export function fmtMwExact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${fmtInt(n)} MW`;
}

export function fmtYears(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} yrs`;
}

export function fmtKv(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return `${Math.round(n)} kV`;
}

export function fmtCents(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}¢/kWh`;
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Intl.NumberFormat("en-US").format(Math.round(n))}`;
}

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "bg-gray-100 text-gray-500";
  if (score >= 70) return "bg-green-100 text-green-800";
  if (score >= 55) return "bg-lime-100 text-lime-800";
  if (score >= 40) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}
