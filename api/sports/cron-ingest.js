import {
  getSupabase, checkAuth, normalizeName, slugify, toUnit, toBigInt, computeImplied,
  listEventsForSeries, fetchMarketsForEvent, mapLimit, LEAGUES,
} from "./_lib.js";

// Generic Kalshi ingester for team sports. Walks LEAGUES config:
//   for each league:
//     for each series (championship, game, series winner, mvp, etc.):
//       list open events → fetch nested markets → bulk upsert events,
//       contestants, markets, then bulk insert quotes
//
// Bulk batching keeps the whole thing under the 300s function timeout even
// when MLB has 41 games × 2 markets and EPL has 21 games × 3 markets each.

async function ingestLeague(supabase, league) {
  const summary = { league: league.key, quotes: 0, events: 0, errors: 0 };

  for (const series of league.series) {
    let events;
    try {
      events = await listEventsForSeries(series.ticker);
    } catch (e) {
      summary.errors++;
      summary[series.ticker] = `events: ${e.message}`;
      continue;
    }
    if (!events.length) continue;

    // Fetch markets per event (bounded concurrency to respect Kalshi rate limit)
    const eventsWithMarkets = await mapLimit(events, 8, async (e) => ({
      event: e,
      markets: await fetchMarketsForEvent(e.event_ticker).catch(() => []),
    }));

    // 1) Bulk upsert sports_events. Includes slug + season_year so the new
    // /sports/{league}/{year}/{slug} routes can resolve.
    const eventRows = events.map((e) => {
      const title = e.title || e.sub_title || e.event_ticker;
      const startTime = e.expected_expiration_time ? new Date(e.expected_expiration_time) : null;
      const year = startTime ? startTime.getUTCFullYear() : new Date().getUTCFullYear();
      return {
        league: league.key,
        event_type: series.event_type,
        title,
        short_title: e.sub_title || null,
        kalshi_event_ticker: e.event_ticker,
        start_time: startTime ? startTime.toISOString() : null,
        season_year: year,
        slug: slugify(title),
        status: "open",
      };
    });
    const { data: eventsResult, error: evErr } = await supabase
      .from("sports_events")
      .upsert(eventRows, { onConflict: "kalshi_event_ticker" })
      .select("id, kalshi_event_ticker");
    if (evErr) { summary.errors++; summary[series.ticker] = `upsert events: ${evErr.message}`; continue; }
    const eventByTicker = new Map(eventsResult.map((r) => [r.kalshi_event_ticker, r.id]));
    summary.events += eventsResult.length;

    // 2) Collect contestants
    const contestantMap = new Map(); // normalized -> { name, normalized_name, league, abbreviation? }
    for (const { markets } of eventsWithMarkets) {
      for (const m of markets) {
        const name = (m.yes_sub_title || m.subtitle || m.title || "").trim();
        if (!name || name.length > 60) continue;
        const norm = normalizeName(name);
        if (!contestantMap.has(norm)) {
          // kind: 'team' if this series ingests game-type events, else 'player'.
          // Backfill SQL set this for existing rows; new inserts get the right
          // kind from the start. Note: contestants that appear in BOTH game
          // and non-game series will keep their first-seen kind because we
          // never overwrite on conflict — that's the desired behavior since
          // appearing in even one game event indicates this IS a team.
          const kind = series.event_type === "game" ? "team" : "player";
          contestantMap.set(norm, { league: league.key, name, normalized_name: norm, slug: slugify(name), kind });
        }
      }
    }
    const contIdByNorm = new Map();
    if (contestantMap.size > 0) {
      const rows = Array.from(contestantMap.values());
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await supabase
          .from("sports_contestants")
          .upsert(rows.slice(i, i + 500), { onConflict: "league,normalized_name" })
          .select("id, normalized_name");
        if (error) { summary.errors++; summary[series.ticker] = `contestants: ${error.message}`; continue; }
        for (const c of data) contIdByNorm.set(c.normalized_name, c.id);
      }
    }

    // 3) Bulk upsert markets
    const marketRows = [];
    const seenKeys = new Set();
    for (const { event, markets } of eventsWithMarkets) {
      const eventId = eventByTicker.get(event.event_ticker);
      if (!eventId) continue;
      for (const m of markets) {
        const name = (m.yes_sub_title || m.subtitle || m.title || "").trim();
        if (!name) continue;
        const norm = normalizeName(name);
        const contestantId = contIdByNorm.get(norm);
        if (!contestantId) continue;
        const key = `${eventId}|${contestantId}|winner`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        marketRows.push({
          event_id: eventId,
          contestant_id: contestantId,
          contestant_label: name,
          market_type: "winner",
          kalshi_ticker: m.ticker,
        });
      }
    }
    const marketIdByKey = new Map();
    for (let i = 0; i < marketRows.length; i += 500) {
      const { data, error } = await supabase
        .from("sports_markets")
        .upsert(marketRows.slice(i, i + 500), { onConflict: "event_id,contestant_id,market_type" })
        .select("id, event_id, contestant_id, market_type, kalshi_ticker");
      if (error) { summary.errors++; summary[series.ticker] = `markets: ${error.message}`; continue; }
      for (const mm of data) marketIdByKey.set(mm.kalshi_ticker, mm.id);
    }

    // 4) Bulk insert quotes
    const quoteRows = [];
    for (const { markets } of eventsWithMarkets) {
      for (const m of markets) {
        const marketId = marketIdByKey.get(m.ticker);
        if (!marketId) continue;
        const yesBid = toUnit(m.yes_bid_dollars ?? m.yes_bid);
        const yesAsk = toUnit(m.yes_ask_dollars ?? m.yes_ask);
        const last = toUnit(m.last_price_dollars ?? m.last_price);
        quoteRows.push({
          market_id: marketId,
          yes_bid: yesBid,
          yes_ask: yesAsk,
          last_price: last,
          implied_prob: computeImplied(yesBid, yesAsk, last),
          volume: toBigInt(m.volume ?? m.volume_24h),
          open_interest: toBigInt(m.open_interest_fp ?? m.open_interest),
          status: m.status || null,
        });
      }
    }
    for (let i = 0; i < quoteRows.length; i += 1000) {
      const { error } = await supabase.from("sports_quotes").insert(quoteRows.slice(i, i + 1000));
      if (error) { summary.errors++; summary[series.ticker] = `quotes: ${error.message}`; }
      else summary.quotes += Math.min(1000, quoteRows.length - i);
    }
  }
  return summary;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();

  const { data: runRow } = await supabase
    .from("golfodds_cron_runs")
    .insert({ job_name: "cron-ingest-sports", started_at: startedAt })
    .select("id").single();

  const results = [];
  for (const league of LEAGUES) {
    try {
      results.push(await ingestLeague(supabase, league));
    } catch (e) {
      results.push({ league: league.key, error: e.message, quotes: 0, events: 0, errors: 1 });
    }
  }

  const totalQuotes = results.reduce((s, r) => s + (r.quotes || 0), 0);
  const totalErrors = results.reduce((s, r) => s + (r.errors || 0), 0);

  if (runRow?.id) {
    await supabase.from("golfodds_cron_runs").update({
      finished_at: new Date().toISOString(),
      rows_inserted: totalQuotes,
      errors: totalErrors,
      notes: JSON.stringify(results),
    }).eq("id", runRow.id);
  }

  return res.status(200).json({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_quotes: totalQuotes,
    errors: totalErrors,
    by_league: results,
  });
}
