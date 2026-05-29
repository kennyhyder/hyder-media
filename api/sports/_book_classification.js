// Single source of truth for which sportsbook keys are legally
// promotable in the US. Used by every public API endpoint that returns
// per-book breakdowns AND mirrored in sportsbookish/lib/books.ts for the
// UI.
//
// Why: Vault Network (and most regulated affiliate programs) forbid
// promoting US-regulated brands alongside offshore brands. To stay
// eligible for DraftKings/FanDuel/BetMGM/Caesars affiliate commission
// AND keep showing a useful consensus signal, we collapse offshore +
// unknown books into a single unnamed "Other" entry that aggregates
// their median price across all offshore quotes.
//
// Adjust REGULATED_US_BOOKS below to add new licensed brands.

export const REGULATED_US_BOOKS = new Set([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "betrivers",
  "fanatics",
  "pointsbet",     // PointsBet US (acquired by Fanatics; legacy quotes may still appear)
  "circa",         // Nevada-only US licensed
]);

// Books we know are offshore. Anything in this list is bucketed as
// "other" and never named in any user-facing surface. Anything NOT in
// REGULATED_US_BOOKS AND NOT in this list is also routed to "other" by
// default (safer to assume unfamiliar = unregulated).
export const KNOWN_OFFSHORE_BOOKS = new Set([
  "bovada",
  "betonline",
  "betonlineag",
  "mybookie",
  "mybookieag",
  "lowvig",
  "betus",
  "bookmaker",
  "5dimes",
  "heritage",
  "pinnacle",     // Pinnacle is offshore (Curaçao); sharp but cannot be named
  "betcris",
]);

export function isRegulatedUS(key) {
  if (!key) return false;
  return REGULATED_US_BOOKS.has(String(key).toLowerCase());
}

// True if we know this book is offshore (so we can keep its data for
// median computation but never display its name).
export function isKnownOffshore(key) {
  if (!key) return false;
  return KNOWN_OFFSHORE_BOOKS.has(String(key).toLowerCase());
}

// Returns the key to USE for display. Regulated → original key.
// Anything else → "other".
export function displayBookKey(key) {
  return isRegulatedUS(key) ? key : "other";
}

// Bucket an array of per-book quote entries. Inputs of any shape are OK
// as long as each entry has a `book` field. All non-regulated entries
// are collapsed into a single { book: "other", ...aggregated } entry
// using median (novig probability) + count.
//
// Other fields on the aggregated entry: american (average), point
// (preserved if all offshore had the same), count (# of offshore books).
//
// If there are zero offshore entries, returns the input unchanged.
export function bucketBookEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return entries;
  const regulated = [];
  const offshore = [];
  for (const e of entries) {
    if (e && isRegulatedUS(e.book)) regulated.push(e);
    else if (e) offshore.push(e);
  }
  if (offshore.length === 0) return regulated;

  // Median novig / implied prob
  const probField = offshore[0].novig !== undefined ? "novig" : (offshore[0].implied_prob_novig !== undefined ? "implied_prob_novig" : "implied_prob");
  const probs = offshore
    .map((e) => e[probField])
    .filter((x) => typeof x === "number" && Number.isFinite(x))
    .sort((a, b) => a - b);
  const median = probs.length === 0
    ? null
    : probs.length % 2 === 0
      ? Number(((probs[probs.length / 2 - 1] + probs[probs.length / 2]) / 2).toFixed(5))
      : Number(probs[(probs.length - 1) / 2].toFixed(5));

  // American odds — round to nearest integer
  const americans = offshore.map((e) => e.american).filter((x) => typeof x === "number" && Number.isFinite(x));
  const avgAmerican = americans.length
    ? Math.round(americans.reduce((a, b) => a + b, 0) / americans.length)
    : null;

  // Point line (spreads / totals) — keep if every offshore had same point
  const points = offshore.map((e) => e.point).filter((p) => p != null);
  const uniquePoints = Array.from(new Set(points.map(String)));
  const point = uniquePoints.length === 1 ? Number(uniquePoints[0]) : null;

  const aggregated = {
    book: "other",
    book_count: offshore.length,
    american: avgAmerican,
    point,
  };
  aggregated[probField] = median;
  // Also write the alternative names so consumers don't have to know which field
  if (probField !== "novig") aggregated.novig = median;
  if (probField !== "implied_prob_novig") aggregated.implied_prob_novig = median;

  return [...regulated, aggregated];
}

// Bucket a `book_prices` map (object keyed by book name, values are
// price objects). Same logic as bucketBookEntries but for the map shape
// some endpoints emit.
export function bucketBookPriceMap(bookPrices) {
  if (!bookPrices || typeof bookPrices !== "object") return bookPrices;
  const regulated = {};
  const offshoreEntries = [];
  for (const [k, v] of Object.entries(bookPrices)) {
    if (isRegulatedUS(k)) regulated[k] = v;
    else if (v) offshoreEntries.push({ book: k, ...v });
  }
  if (offshoreEntries.length === 0) return regulated;
  const aggList = bucketBookEntries([...offshoreEntries]);
  const otherEntry = aggList.find((e) => e.book === "other");
  if (otherEntry) {
    const { book, ...rest } = otherEntry;
    regulated.other = rest;
  }
  return regulated;
}
