// Shared name-normalization helpers. Used to key player/team/contestant
// rows across pipelines so different data sources (Kalshi, DataGolf,
// Polymarket, Odds API) match the same entity.
//
// Two variants:
//   normalizeName       — fast, ASCII-only (the historical default
//                         baked into our database keys). Use this when
//                         keying records that already live in our DB.
//   normalizeNameUnicode — same logic + NFD-stripped accents. Use this
//                         when matching strings from new external sources
//                         where accent drift is possible ("François"
//                         vs "Francois"). Returns the same value as
//                         normalizeName for pure-ASCII input.
//
// Note: switching existing pipelines from normalizeName to
// normalizeNameUnicode is a behavior change — the DB has historical
// rows keyed under the ASCII form, so any caller that adopts the
// stricter version must reconcile existing data first.

export const normalizeName = (s) =>
  (s || "").trim().toLowerCase().replace(/\s+/g, " ");

export const normalizeNameUnicode = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
