// UI-side mirror of api/sports/_book_classification.js.
// Keep the two in sync — same set of regulated US books.
//
// Rule: we only NAME books on the REGULATED_US whitelist. Everything
// else is bucketed into a single unnamed "other" entry (median across
// all offshore quotes). This keeps us eligible for regulated-brand
// affiliate programs that forbid co-promotion with offshore.

export const REGULATED_US_BOOKS: Set<string> = new Set([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "betrivers",
  "fanatics",
  "pointsbet",
  "circa",
]);

export function isRegulatedUS(key: string | null | undefined): boolean {
  if (!key) return false;
  return REGULATED_US_BOOKS.has(key.toLowerCase());
}

export function displayBookKey(key: string): string {
  return isRegulatedUS(key) ? key : "other";
}

// Display label for a book key. Returns "Other" for anything non-regulated.
export function displayBookLabel(key: string, namedLabels: Record<string, string>): string {
  if (!isRegulatedUS(key)) return "Other";
  return namedLabels[key.toLowerCase()] || key;
}

type BookEntry = {
  book: string;
  novig?: number | null;
  american?: number | null;
  point?: number | null;
  // Some surfaces add more fields (count, line, etc) — preserved on regulated entries, recomputed on "other"
  [k: string]: unknown;
};

// Aggregate non-regulated entries into a single "other" entry with median
// novig and average american. Returns regulated entries unchanged plus
// (optionally) the aggregated "other" entry at the end.
export function bucketBookEntries<T extends BookEntry>(entries: T[]): T[] {
  if (!entries || entries.length === 0) return entries;
  const regulated: T[] = [];
  const offshore: T[] = [];
  for (const e of entries) {
    if (isRegulatedUS(e.book)) regulated.push(e);
    else offshore.push(e);
  }
  if (offshore.length === 0) return regulated;

  const probs = offshore
    .map((e) => (typeof e.novig === "number" ? e.novig : null))
    .filter((x): x is number => x != null && Number.isFinite(x))
    .sort((a, b) => a - b);
  const median = probs.length === 0
    ? null
    : probs.length % 2 === 0
      ? (probs[probs.length / 2 - 1] + probs[probs.length / 2]) / 2
      : probs[(probs.length - 1) / 2];
  const americans = offshore
    .map((e) => (typeof e.american === "number" ? e.american : null))
    .filter((x): x is number => x != null && Number.isFinite(x));
  const avgAmerican = americans.length
    ? Math.round(americans.reduce((a, b) => a + b, 0) / americans.length)
    : null;

  // Point: keep only if every offshore has the same point
  const points = offshore.map((e) => e.point).filter((p): p is number => p != null);
  const uniqPoints = Array.from(new Set(points.map(String)));
  const point = uniqPoints.length === 1 ? Number(uniqPoints[0]) : null;

  const aggregated = {
    book: "other",
    book_count: offshore.length,
    novig: median,
    american: avgAmerican,
    point,
  } as unknown as T;

  return [...regulated, aggregated];
}

// Bucket a per-book map: { draftkings: {novig, american}, bovada: {...} } →
// { draftkings: {...}, other: {aggregated} }
export function bucketBookPriceMap<V extends { novig?: number | null; american?: number | null }>(
  bookPrices: Record<string, V> | null | undefined,
): Record<string, V & { book_count?: number }> {
  if (!bookPrices) return {} as Record<string, V & { book_count?: number }>;
  const regulated: Record<string, V & { book_count?: number }> = {};
  const offshoreList: Array<{ book: string } & V> = [];
  for (const [k, v] of Object.entries(bookPrices)) {
    if (isRegulatedUS(k)) regulated[k] = v;
    else if (v) offshoreList.push({ book: k, ...v });
  }
  if (offshoreList.length === 0) return regulated;
  const probs = offshoreList
    .map((e) => (typeof e.novig === "number" ? e.novig : null))
    .filter((x): x is number => x != null && Number.isFinite(x))
    .sort((a, b) => a - b);
  const median = probs.length === 0
    ? null
    : probs.length % 2 === 0
      ? (probs[probs.length / 2 - 1] + probs[probs.length / 2]) / 2
      : probs[(probs.length - 1) / 2];
  const americans = offshoreList
    .map((e) => (typeof e.american === "number" ? e.american : null))
    .filter((x): x is number => x != null && Number.isFinite(x));
  const avgAmerican = americans.length
    ? Math.round(americans.reduce((a, b) => a + b, 0) / americans.length)
    : null;
  regulated.other = {
    novig: median,
    american: avgAmerican,
    book_count: offshoreList.length,
  } as unknown as V & { book_count?: number };
  return regulated;
}
