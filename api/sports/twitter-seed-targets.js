import { createClient } from "@supabase/supabase-js";
import { resolveHandle, hasReadCreds } from "./_twitter.js";

// One-time seed of sb_twitter_targets from a curated handle list. Resolves
// each handle → twitter_id via Twitter API (one /users/by/username read
// per handle, ~65 reads total — well under any rate limit).
//
// Idempotent: skips handles already present. Re-run safely after editing
// the list below.
//
// GET /api/sports/twitter-seed-targets
//   Authorization: Bearer <CRON_SECRET>
//   ?dry=1 to print what would happen without inserting

export const config = { maxDuration: 300 };

// Curated list. Categories:
//   friends — Kenny's IRL sharp friends (priority engagement)
//   kalshi — Kalshi / prediction-markets specialists
//   sharp_analytics — EV / no-vig / sharp-money brain trust
//   line_movement — line freezers + steam chasers
//   quant — public model / projection bettors
//   media — math-literate betting media
//   industry — prediction-market industry/regulatory beat
const TARGETS = [
  // friends
  { handle: "bobbyfi",         category: "friends" },
  { handle: "sheetspwns",      category: "friends" },

  // kalshi / prediction-markets
  { handle: "Kalshi",          category: "kalshi" },
  { handle: "PolymarketSport", category: "kalshi" },
  { handle: "Polymarket",      category: "kalshi" },
  { handle: "PolymarketFC",    category: "kalshi" },
  { handle: "mansourtarek_",   category: "kalshi" },
  { handle: "DustinGouker",    category: "kalshi" },
  { handle: "cobybets1",       category: "kalshi" },
  { handle: "Domahhhh",        category: "kalshi" },
  { handle: "debl00b",         category: "kalshi" },
  { handle: "aenews_KT",       category: "kalshi" },
  { handle: "robinhanson",     category: "kalshi" },

  // sharp_analytics
  { handle: "capjack2000",     category: "sharp_analytics" },
  { handle: "RufusPeabody",    category: "sharp_analytics" },
  { handle: "PlusEVAnalytics", category: "sharp_analytics" },
  { handle: "spanky",          category: "sharp_analytics" },
  { handle: "haralabob",       category: "sharp_analytics" },
  { handle: "RobPizzola",      category: "sharp_analytics" },
  { handle: "EdMillerPoker",   category: "sharp_analytics" },
  { handle: "UnabatedSports",  category: "sharp_analytics" },
  { handle: "OddsJam",         category: "sharp_analytics" },
  { handle: "bettheprocess",   category: "sharp_analytics" },
  { handle: "FezzikSports",    category: "sharp_analytics" },

  // line_movement
  { handle: "CircaSports",     category: "line_movement" },
  { handle: "actionnetworkhq", category: "line_movement" },
  { handle: "The_Oddsmaker",   category: "line_movement" },
  { handle: "VSiN",            category: "line_movement" },
  { handle: "PropBetGuy",      category: "line_movement" },
  { handle: "BillKrackman",    category: "line_movement" },

  // quant
  { handle: "DataGolf",        category: "quant" },
  { handle: "kenpomeroy",      category: "quant" },
  { handle: "EvanMiya",        category: "quant" },
  { handle: "barttorvik",      category: "quant" },
  { handle: "CFBNumbers",      category: "quant" },
  { handle: "thepowerrank",    category: "quant" },
  { handle: "FO_ASchatz",      category: "quant" },
  { handle: "SharpFootball",   category: "quant" },
  { handle: "SportsCheetah",   category: "quant" },
  { handle: "DeckPrismSports", category: "quant" },

  // media
  { handle: "TheHammerBet",    category: "media" },
  { handle: "jeffma",          category: "media" },
  { handle: "gamblingedge",    category: "media" },
  { handle: "inplayLIVE",      category: "media" },
  { handle: "LSReport",        category: "media" },
  { handle: "DarrenRovell",    category: "media" },

  // industry
  { handle: "WALLACHLEGAL",    category: "industry" },
  { handle: "GerlacherC",      category: "industry" },
  { handle: "LegalSportsRep",  category: "industry" },
  { handle: "frontofficeSPT",  category: "industry" },
  { handle: "SporticoLaw",     category: "industry" },
  { handle: "TheClosingLine",  category: "industry" },
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  if (!hasReadCreds()) return res.status(503).json({ error: "TWITTER_BEARER_TOKEN required to resolve handles" });
  const dry = req.query?.dry === "1";

  const supabase = getSupabase();
  // Already-resolved handles to skip
  const { data: existing } = await supabase
    .from("sb_twitter_targets")
    .select("handle");
  const seen = new Set((existing || []).map((r) => r.handle.toLowerCase()));

  const results = [];
  for (const t of TARGETS) {
    if (seen.has(t.handle.toLowerCase())) {
      results.push({ handle: t.handle, skipped: "already present" });
      continue;
    }
    try {
      const resolved = await resolveHandle(t.handle);
      if (dry) {
        results.push({ handle: t.handle, resolved, would_insert: { ...resolved, category: t.category } });
        continue;
      }
      const { error } = await supabase.from("sb_twitter_targets").upsert({
        twitter_id: resolved.twitter_id,
        handle: resolved.handle,
        category: t.category,
        follower_count: resolved.follower_count,
        active: true,
      }, { onConflict: "twitter_id" });
      results.push({
        handle: t.handle,
        twitter_id: resolved.twitter_id,
        followers: resolved.follower_count,
        category: t.category,
        inserted: !error,
        error: error?.message,
      });
    } catch (e) {
      results.push({ handle: t.handle, error: e.message });
    }
    // Stay polite with Twitter API rate limit (300 /15min for /users/by)
    await new Promise((r) => setTimeout(r, 300));
  }

  return res.status(200).json({
    dry_run: dry,
    total: TARGETS.length,
    resolved: results.filter((r) => r.inserted).length,
    skipped: results.filter((r) => r.skipped).length,
    errors: results.filter((r) => r.error).length,
    results,
  });
}
