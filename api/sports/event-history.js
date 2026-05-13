import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/sports/event-history?id=<uuid>&hours=24
// Returns time-series implied probability for each market in the event.
// Lets the UI draw sparklines / line-movement charts.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id;
  const hours = Math.min(Number(req.query.hours) || 24, 24 * 14);
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const supabase = getSupabase();
    const { data: markets } = await supabase
      .from("sports_markets")
      .select("id, contestant_label")
      .eq("event_id", id);
    if (!markets?.length) return res.status(200).json({ markets: [] });

    const ids = markets.map((m) => m.id);
    const sinceISO = new Date(Date.now() - hours * 3600_000).toISOString();
    const { data: quotes } = await supabase
      .from("sports_quotes")
      .select("market_id, implied_prob, fetched_at")
      .in("market_id", ids)
      .gte("fetched_at", sinceISO)
      .order("fetched_at", { ascending: true })
      .range(0, 9999);

    const byMarket = new Map();
    for (const m of markets) byMarket.set(m.id, { market_id: m.id, contestant_label: m.contestant_label, points: [] });
    for (const q of quotes || []) {
      const ref = byMarket.get(q.market_id);
      if (ref && q.implied_prob != null) ref.points.push({ t: q.fetched_at, p: q.implied_prob });
    }

    return res.status(200).json({ markets: Array.from(byMarket.values()) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
