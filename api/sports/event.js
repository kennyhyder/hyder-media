import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/sports/event?id=<uuid> — event + latest contestant odds
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const supabase = getSupabase();
    const { data: event } = await supabase
      .from("sports_events")
      .select("id, league, event_type, title, short_title, start_time, status, kalshi_event_ticker")
      .eq("id", id)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: "not found" });

    const { data: markets } = await supabase
      .from("sports_markets")
      .select("id, contestant_label, market_type, kalshi_ticker")
      .eq("event_id", id);

    let marketsWithQuotes = markets || [];
    if (marketsWithQuotes.length > 0) {
      const ids = marketsWithQuotes.map((m) => m.id);
      const { data: quotes } = await supabase
        .from("sports_v_latest_quotes")
        .select("market_id, yes_bid, yes_ask, last_price, implied_prob, fetched_at")
        .in("market_id", ids);
      const qByMarket = new Map((quotes || []).map((q) => [q.market_id, q]));
      marketsWithQuotes = marketsWithQuotes.map((m) => {
        const q = qByMarket.get(m.id);
        return {
          id: m.id,
          contestant_label: m.contestant_label,
          market_type: m.market_type,
          kalshi_ticker: m.kalshi_ticker,
          implied_prob: q?.implied_prob ?? null,
          yes_bid: q?.yes_bid ?? null,
          yes_ask: q?.yes_ask ?? null,
          last_price: q?.last_price ?? null,
          fetched_at: q?.fetched_at ?? null,
        };
      });
      marketsWithQuotes.sort((a, b) => (b.implied_prob ?? 0) - (a.implied_prob ?? 0));
    }

    return res.status(200).json({ event, markets: marketsWithQuotes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
