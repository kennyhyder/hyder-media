// Shared tournament-name resolver for the DataGolf-driven ingest crons.
// DataGolf uses sponsor-laden tournament names ("the Memorial Tournament
// presented by Workday") while Kalshi typically uses the canonical short
// form ("The Memorial Tournament"). Without normalization, ingests create
// orphan tournament rows + dump all DG data into them, leaving the
// canonical (user-facing) row empty.
//
// Strategy: try multiple lookups in order. First exact match, then
// alias-table match, then fuzzy substring match against open + upcoming
// rows. Falls back to creating a new row only when nothing matches —
// that's the safety valve so a genuinely new tournament still gets a row.

// Patterns to strip before matching. Order matters — apply most-specific first.
const SPONSOR_PATTERNS = [
  /\s+presented\s+by\s+.+$/i,           // "...presented by Workday"
  /\s+sponsored\s+by\s+.+$/i,
  /\s+pres\.\s+by\s+.+$/i,
  /\s+by\s+.+$/i,                       // "...by Cognizant"
  /^\bthe\s+/i,                         // leading "the " (case-insensitive)
  /\s+championship$/i,                  // sometimes added/dropped
  /\s+open$/i,
  /\s+invitational$/i,
  /\s+classic$/i,
];

function normalize(name) {
  if (!name) return "";
  let n = String(name).trim();
  for (const p of SPONSOR_PATTERNS) n = n.replace(p, "");
  return n.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

// Hardcoded aliases for cases the normalizer can't catch. Keep tight —
// every entry here is a manually-verified mapping.
const EXPLICIT_ALIASES = {
  "the memorial tournament presented by workday": "The Memorial Tournament",
  "the cj cup byron nelson": "THE CJ CUP Byron Nelson",
  "us open final qualifying dallas playoff": "U.S. Open Final Qualifying Dallas Playoff",
  "the rsm classic": "The RSM Classic",
};

// Resolve a DG event name to a canonical tournament_id. Returns
// { id, name, created: bool } or { id: null } if we couldn't match AND
// the caller asked us not to auto-create (allowCreate=false).
export async function resolveTournament(supabase, dgEventName, { allowCreate = true, tour = "pga" } = {}) {
  if (!dgEventName) return { id: null, reason: "empty event name" };

  // 1) Try explicit alias first
  const aliasKey = dgEventName.toLowerCase().trim();
  const aliasedName = EXPLICIT_ALIASES[aliasKey];
  if (aliasedName) {
    const { data } = await supabase
      .from("golfodds_tournaments")
      .select("id, name, status")
      .eq("name", aliasedName)
      .maybeSingle();
    if (data?.id) return { id: data.id, name: data.name, matched: "alias" };
  }

  // 2) Exact match
  const { data: exact } = await supabase
    .from("golfodds_tournaments")
    .select("id, name, status")
    .eq("name", dgEventName)
    .in("status", ["open", "upcoming", "closed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (exact?.id) return { id: exact.id, name: exact.name, matched: "exact" };

  // 3) Normalized match against open + upcoming rows (we don't want to
  //    accidentally write live data into a closed row's matched-by-norm).
  const normTarget = normalize(dgEventName);
  if (normTarget) {
    const { data: candidates } = await supabase
      .from("golfodds_tournaments")
      .select("id, name, status, end_date")
      .in("status", ["open", "upcoming"])
      .order("end_date", { ascending: true });
    for (const c of candidates || []) {
      if (normalize(c.name) === normTarget) {
        return { id: c.id, name: c.name, matched: "normalized" };
      }
    }
  }

  // 4) Last resort: create new row (only if allowed)
  if (!allowCreate) return { id: null, reason: `no match for '${dgEventName}'` };
  const { data: created, error } = await supabase
    .from("golfodds_tournaments")
    .insert({ tour, name: dgEventName, status: "upcoming" })
    .select("id, name")
    .single();
  if (error) return { id: null, reason: `create failed: ${error.message}` };
  return { id: created.id, name: created.name, matched: "created", created: true };
}
