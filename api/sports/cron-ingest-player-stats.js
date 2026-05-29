import { createClient } from "@supabase/supabase-js";

// Player game-log ingest from ESPN's free public API. Pulls yesterday's
// games per supported sport + extracts per-player stat lines into
// sb_player_game_log.
//
// Sports supported (this version): NBA. NFL/MLB/NHL follow the same
// pattern — see TODO sections for the per-sport scoreboard + boxscore
// endpoint shapes and stat mappings.
//
// Schedule: 08:00 UTC daily (after previous-day games finalize).
//
// GET /api/sports/cron-ingest-player-stats
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 300 };

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

// ---- NBA ingest ----
async function ingestNBA(supabase, dateStr) {
  const url = `${ESPN_BASE}/basketball/nba/scoreboard?dates=${dateStr.replace(/-/g, "")}`;
  const r = await fetch(url);
  if (!r.ok) return { sport: "nba", error: `scoreboard ${r.status}` };
  const data = await r.json();
  const events = data?.events || [];
  let rows = 0;
  for (const ev of events) {
    const eventId = ev?.id;
    if (!eventId) continue;
    if (ev?.status?.type?.completed !== true) continue;
    const summaryUrl = `${ESPN_BASE}/basketball/nba/summary?event=${eventId}`;
    const sr = await fetch(summaryUrl);
    if (!sr.ok) continue;
    const summary = await sr.json();
    const boxscore = summary?.boxscore;
    const teams = boxscore?.players || [];
    for (const team of teams) {
      const statsGroups = team?.statistics || [];
      for (const grp of statsGroups) {
        const labels = grp?.labels || [];
        const athletes = grp?.athletes || [];
        const labelIdx = (key) => labels.findIndex((l) => l?.toLowerCase() === key);
        const PTS = labelIdx("pts");
        const REB = labelIdx("reb");
        const AST = labelIdx("ast");
        const STL = labelIdx("stl");
        const BLK = labelIdx("blk");
        const FG3M = labels.findIndex((l) => /3pt/i.test(l));
        for (const a of athletes) {
          const stats = a?.stats || [];
          const slug = a?.athlete?.id ? `nba-${a.athlete.id}` : null;
          const name = a?.athlete?.displayName || a?.athlete?.fullName;
          if (!slug || !name) continue;
          const points = PTS >= 0 ? Number(stats[PTS]) || null : null;
          const rebounds = REB >= 0 ? Number(stats[REB]) || null : null;
          const assists = AST >= 0 ? Number(stats[AST]) || null : null;
          const steals = STL >= 0 ? Number(stats[STL]) || null : null;
          const blocks = BLK >= 0 ? Number(stats[BLK]) || null : null;
          // 3PT field is typically "5-12" — pull the first integer
          let threes = null;
          if (FG3M >= 0 && stats[FG3M]) {
            const m = String(stats[FG3M]).match(/^(\d+)/);
            if (m) threes = Number(m[1]);
          }
          const { error } = await supabase.from("sb_player_game_log").upsert({
            player_id: slug,
            player_name: name,
            sport: "nba",
            game_date: dateStr,
            points, rebounds, assists, steals, blocks, threes,
            source: "espn",
          }, { onConflict: "player_id,sport,game_date" });
          if (!error) rows++;
        }
      }
    }
  }
  return { sport: "nba", events: events.length, rows };
}

// TODO: NFL ingest — `${ESPN_BASE}/football/nfl/scoreboard` + boxscore
// has different stat group structure (passing/rushing/receiving). Same
// pattern, different label maps.
//
// TODO: MLB ingest — `${ESPN_BASE}/baseball/mlb/scoreboard` + boxscore
// has batting + pitching groups separately. Map AB/H/HR/RBI/SB/SO.
//
// TODO: NHL ingest — `${ESPN_BASE}/hockey/nhl/scoreboard` + boxscore.
// Map G/A/SOG/SV.

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  // Yesterday in UTC (ESPN data finalizes ~6h after games end)
  const d = new Date(Date.now() - 18 * 3600 * 1000);
  const dateStr = d.toISOString().slice(0, 10);
  const results = [];
  for (const ingest of [ingestNBA /* , ingestNFL, ingestMLB, ingestNHL */]) {
    try { results.push(await ingest(supabase, dateStr)); }
    catch (e) { results.push({ error: e.message }); }
  }
  return res.status(200).json({ date: dateStr, results });
}
