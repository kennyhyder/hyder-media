import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

/**
 * GET /api/golfodds/props?tournament_id=<uuid>
 *
 * Returns multi-outcome prop markets for a tournament: each prop is one
 * question (winning score, stroke margin, etc.) with N possible outcomes,
 * each with a Kalshi price.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const tournamentId = req.query.tournament_id;
  if (!tournamentId) return res.status(400).json({ error: "tournament_id required" });

  try {
    const supabase = getSupabase();
    const { data: props, error: pErr } = await supabase
      .from("golfodds_props")
      .select("id, prop_type, question, outcome_kind, kalshi_event_ticker")
      .eq("tournament_id", tournamentId)
      .range(0, 999);
    if (pErr) return res.status(500).json({ error: pErr.message });
    if (!props?.length) return res.status(200).json({ props: [] });

    const propIds = props.map((p) => p.id);
    const { data: outcomes, error: oErr } = await supabase
      .from("golfodds_prop_outcomes")
      .select("id, prop_id, outcome_label, outcome_key, display_order, kalshi_ticker")
      .in("prop_id", propIds)
      .order("display_order", { ascending: true })
      .range(0, 9999);
    if (oErr) return res.status(500).json({ error: oErr.message });
    const outcomeIds = (outcomes || []).map((o) => o.id);

    let quotesByOutcome = new Map();
    if (outcomeIds.length) {
      // Chunk outcome IDs to avoid URL length issues
      const allQuotes = [];
      for (let i = 0; i < outcomeIds.length; i += 100) {
        const chunk = outcomeIds.slice(i, i + 100);
        const { data, error } = await supabase
          .from("golfodds_prop_latest")
          .select("outcome_id, yes_bid, yes_ask, last_price, implied_prob, volume, open_interest, status, fetched_at")
          .in("outcome_id", chunk);
        if (error) return res.status(500).json({ error: error.message });
        allQuotes.push(...(data || []));
      }
      quotesByOutcome = new Map(allQuotes.map((q) => [q.outcome_id, q]));
    }

    const outcomesByProp = new Map();
    for (const o of outcomes || []) {
      if (!outcomesByProp.has(o.prop_id)) outcomesByProp.set(o.prop_id, []);
      outcomesByProp.get(o.prop_id).push({
        id: o.id,
        label: o.outcome_label,
        key: o.outcome_key,
        display_order: o.display_order,
        kalshi_ticker: o.kalshi_ticker,
        kalshi: quotesByOutcome.get(o.id) || null,
      });
    }

    const out = props.map((p) => {
      const outs = outcomesByProp.get(p.id) || [];
      // Sum of all outcome probabilities (helps assess Kalshi overround vs 100%)
      const sumP = outs.reduce((s, o) => s + (o.kalshi?.implied_prob || 0), 0);
      return {
        id: p.id,
        prop_type: p.prop_type,
        question: p.question,
        outcome_kind: p.outcome_kind,
        kalshi_event_ticker: p.kalshi_event_ticker,
        outcomes: outs,
        sum_implied: Number(sumP.toFixed(4)),
      };
    });

    return res.status(200).json({ tournament_id: tournamentId, props: out });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
