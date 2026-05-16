import {
  getSupabase, checkAuth, normalizeName, slugify, toUnit, toBigInt, computeImplied,
  listEventsForSeries, fetchMarketsForEvent, mapLimit, LEAGUES,
} from "./_lib.js";

const MONTHS = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };

// Returns a Date from Kalshi's expected_expiration_time, falling back to
// parsing the encoded YYMMMDDHHMM date out of the event ticker.
function parseEventStartTime(e) {
  if (e.expected_expiration_time) {
    const d = new Date(e.expected_expiration_time);
    if (!isNaN(d.getTime())) return d;
  }
  const ticker = e.event_ticker || "";
  const m = ticker.match(/(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})(?:[A-Z]|$)/);
  if (!m) return null;
  const [, yy, mon, dd, hh, mi] = m;
  const month = MONTHS[mon];
  if (month == null) return null;
  return new Date(Date.UTC(2000 + Number(yy), month, Number(dd), Number(hh), Number(mi)));
}

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
      // Prefer Kalshi's expected_expiration_time when present; otherwise parse
      // the encoded date out of the ticker (e.g. KXMLBGAME-26MAY161810CINCLE
      // → 2026-05-16 18:10 UTC). Without a start_time, the archive cron skips
      // the event and stale 99/1¢ settled-market values keep leaking into the
      // UI as phantom +57% edges.
      const startTime = parseEventStartTime(e);
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
          // kind is NOT written here — a DB trigger on sports_markets
          // (trg_sports_contestant_kind) maintains the invariant: any
          // contestant with a game-type market is forever a 'team', else
          // 'player'. Writing kind from cron creates a race condition
          // because non-game series ingest after game series and would
          // overwrite 'team' back to 'player'.
          contestantMap.set(norm, { league: league.key, name, normalized_name: norm, slug: slugify(name) });
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

  // Ping IndexNow (Bing/Yandex/Naver/Seznam) about any events newly inserted
  // in the last 15 minutes. Google ignores IndexNow but sees them via the
  // hourly sitemap re-crawl + Search Console. Best-effort; never fail the cron.
  let indexnowSummary = null;
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: fresh } = await supabase
      .from("sports_events")
      .select("league, slug, season_year, created_at")
      .gte("created_at", cutoff)
      .not("slug", "is", null);
    const urls = (fresh || [])
      .filter((e) => e.slug && e.season_year)
      .map((e) => `https://sportsbookish.com/sports/${e.league}/${e.season_year}/${e.slug}`);
    if (urls.length) {
      const r = await fetch("https://api.indexnow.org/IndexNow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          host: "sportsbookish.com",
          key: "620c7d50b41090ac7f0493e654f3219c",
          keyLocation: "https://sportsbookish.com/620c7d50b41090ac7f0493e654f3219c.txt",
          urlList: urls.slice(0, 10000),
        }),
      });
      indexnowSummary = { submitted: Math.min(urls.length, 10000), status: r.status };
    } else {
      indexnowSummary = { submitted: 0, reason: "no new events" };
    }
  } catch (e) {
    indexnowSummary = { error: e.message };
  }

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
    indexnow: indexnowSummary,
  });
}
