import { createClient } from "@supabase/supabase-js";

// List all golfers with slugs. Used by the sitemap generator + future indexes.
// Sorted by OWGR rank when available (NULLs last), then alphabetical.
//
// GET /api/golfodds/players → { players: [{ id, name, slug, dg_id, owgr_rank }, …] }

export const config = { maxDuration: 10 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("golfodds_players")
    .select("id, name, slug, dg_id, owgr_rank")
    .not("slug", "is", null)
    .order("owgr_rank", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ players: data || [] });
}
