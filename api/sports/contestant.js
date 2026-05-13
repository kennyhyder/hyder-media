import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/sports/contestant?id=<uuid> — all events this team is in
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const supabase = getSupabase();
    const { data: contestant, error: cErr } = await supabase
      .from("sports_contestants")
      .select("id, league, name, abbreviation")
      .eq("id", id)
      .maybeSingle();
    if (cErr || !contestant) return res.status(404).json({ error: "not found" });

    const { data: markets } = await supabase
      .from("sports_markets")
      .select("id, event_id, contestant_label, market_type, kalshi_ticker, sports_events(id, title, event_type, start_time, status)")
      .eq("contestant_id", id);

    let marketsOut: unknown[] = markets || [];
    if (markets && markets.length > 0) {
      const ids = markets.map((m) => m.id);
      const { data: quotes } = await supabase
        .from("sports_v_latest_quotes")
        .select("market_id, yes_bid, yes_ask, last_price, implied_prob, fetched_at")
        .in("market_id", ids);
      const qByMarket = new Map((quotes || []).map((q) => [q.market_id, q]));
      marketsOut = markets.map((m) => ({
        market_id: m.id,
        event: m.sports_events,
        market_type: m.market_type,
        contestant_label: m.contestant_label,
        kalshi_ticker: m.kalshi_ticker,
        ...(qByMarket.get(m.id) || { implied_prob: null, yes_bid: null, yes_ask: null, last_price: null, fetched_at: null }),
      }));
    }

    return res.status(200).json({ contestant, markets: marketsOut });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
