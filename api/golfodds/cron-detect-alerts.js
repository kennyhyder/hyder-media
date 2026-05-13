import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

const MARKET_LABELS = {
  win: "Win", t5: "Top 5", t10: "Top 10", t20: "Top 20", t40: "Top 40", mc: "Make Cut",
  r1lead: "R1 Leader", r2lead: "R2 Leader", r3lead: "R3 Leader",
};

// Thresholds. Positive edge = Kalshi is CHEAPER than book median → buy on Kalshi.
const BUY_EDGE_THRESHOLD = 0.03;   // +3% buy edge
const SELL_EDGE_THRESHOLD = -0.05; // -5% (Kalshi overpriced) sell edge
const MIN_BOOK_COUNT = 3;          // require ≥3 books quoting for reliability
const DEDUP_WINDOW_MIN = 30;       // don't refire same alert within 30 min

function median(values) {
  const xs = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

async function chunked(ids, chunkSize, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunkSize) out.push(...(await fn(ids.slice(i, i + chunkSize))));
  return out;
}

async function detectForTournament(supabase, tournament) {
  // Pull all per-golfer markets in this tournament
  const { data: markets, error: mErr } = await supabase
    .from("golfodds_markets")
    .select("id, player_id, market_type, golfodds_players(name)")
    .eq("tournament_id", tournament.id)
    .range(0, 9999);
  if (mErr) throw new Error(mErr.message);
  if (!markets?.length) return { newAlerts: [] };

  const marketIds = markets.map((m) => m.id);

  // Pull latest quotes
  const kalshiRows = await chunked(marketIds, 100, async (chunk) => {
    const { data } = await supabase.from("golfodds_v_latest_kalshi").select("market_id, implied_prob, fetched_at").in("market_id", chunk).range(0, 9999);
    return data || [];
  });
  const bookRows = await chunked(marketIds, 100, async (chunk) => {
    const { data } = await supabase.from("golfodds_v_latest_books").select("market_id, novig_prob, book").in("market_id", chunk).range(0, 9999);
    return data || [];
  });

  const kalshiByMarket = new Map(kalshiRows.map((r) => [r.market_id, r]));
  const booksByMarket = new Map();
  for (const r of bookRows) {
    if (!booksByMarket.has(r.market_id)) booksByMarket.set(r.market_id, []);
    booksByMarket.get(r.market_id).push(r);
  }

  // Find recent alerts to dedupe
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MIN * 60_000).toISOString();
  const { data: recentAlerts } = await supabase
    .from("golfodds_alerts")
    .select("player_id, market_type, direction")
    .eq("tournament_id", tournament.id)
    .gte("fired_at", cutoff);
  const recentKey = new Set((recentAlerts || []).map((a) => `${a.player_id}|${a.market_type}|${a.direction}`));

  // Scan each market for threshold crossings
  const newAlerts = [];
  for (const m of markets) {
    const kalshi = kalshiByMarket.get(m.id);
    const kProb = kalshi?.implied_prob;
    if (kProb == null) continue;
    const books = booksByMarket.get(m.id) || [];
    if (books.length < MIN_BOOK_COUNT) continue;
    const novigVals = books.map((b) => b.novig_prob).filter((v) => v != null);
    if (novigVals.length < MIN_BOOK_COUNT) continue;
    const booksMed = median(novigVals);
    if (booksMed == null) continue;
    const edge = booksMed - kProb;

    let direction = null;
    if (edge >= BUY_EDGE_THRESHOLD) direction = "buy";
    else if (edge <= SELL_EDGE_THRESHOLD) direction = "sell";
    if (!direction) continue;

    const key = `${m.player_id}|${m.market_type}|${direction}`;
    if (recentKey.has(key)) continue;
    recentKey.add(key);

    newAlerts.push({
      tournament_id: tournament.id,
      player_id: m.player_id,
      market_id: m.id,
      market_type: m.market_type,
      alert_type: "edge",
      direction,
      edge_value: Number(edge.toFixed(4)),
      kalshi_prob: Number(kProb.toFixed(4)),
      reference_prob: Number(booksMed.toFixed(4)),
      reference_source: "books_median",
      threshold: direction === "buy" ? BUY_EDGE_THRESHOLD : SELL_EDGE_THRESHOLD,
      book_count: novigVals.length,
      _player_name: m.golfodds_players?.name,
      _tournament_name: tournament.name,
    });
  }
  return { newAlerts };
}

async function sendSMSAlerts(supabase, alerts) {
  // Find Elite users with sms_phone set + sms channel enabled, send each a digest
  const { data: eliteUsers } = await supabase
    .from("sb_subscriptions")
    .select("user_id, tier, sb_user_preferences(sms_phone, notification_channels)")
    .eq("tier", "elite")
    .eq("status", "active");
  if (!eliteUsers?.length) return { sent: 0 };

  const SID = process.env.AG2020_TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.AG2020_TWILIO_AUTH_TOKEN;
  const FROM = process.env.AG2020_TWILIO_FROM_NUMBER;
  if (!SID || !TOKEN || !FROM) return { sent: 0, reason: "twilio not configured" };

  let sent = 0;
  for (const user of eliteUsers) {
    const prefs = user.sb_user_preferences;
    if (!prefs?.sms_phone) continue;
    if (!prefs?.notification_channels?.includes("sms")) continue;
    const top = alerts.slice(0, 3);
    const body = `SportsBookish: ${alerts.length} new edge${alerts.length === 1 ? "" : "s"}.\n` +
      top.map((a) => `${a._player_name} ${a.market_type} ${a.direction === "buy" ? "+" : ""}${(a.edge_value * 100).toFixed(1)}%`).join("\n") +
      (alerts.length > 3 ? `\n+${alerts.length - 3} more at hyder.me/golfodds/alerts` : "");
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
      const auth = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
      const params = new URLSearchParams({ To: prefs.sms_phone, From: FROM, Body: body.slice(0, 320) });
      const r = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (r.ok) sent++;
    } catch {}
  }
  return { sent };
}

async function sendEmail(alerts) {
  if (!process.env.RESEND_API_KEY) return { sent: false, reason: "no RESEND_API_KEY" };
  if (!process.env.ALERT_EMAIL_TO) return { sent: false, reason: "no ALERT_EMAIL_TO" };
  const subject = alerts.length === 1
    ? `🟢 GolfOdds: ${alerts[0]._player_name} ${MARKET_LABELS[alerts[0].market_type] || alerts[0].market_type} edge ${alerts[0].direction === "buy" ? "+" : ""}${(alerts[0].edge_value * 100).toFixed(2)}%`
    : `🟢 GolfOdds: ${alerts.length} new edge opportunities`;

  const rows = alerts.map((a) => {
    const pct = (n) => `${(n * 100).toFixed(2)}%`;
    const edgeStr = a.direction === "buy" ? `+${(a.edge_value * 100).toFixed(2)}%` : `${(a.edge_value * 100).toFixed(2)}%`;
    const url = `https://hyder.me/golfodds/player/?id=${a.player_id}&tournament_id=${a.tournament_id}`;
    const color = a.direction === "buy" ? "#22c55e" : "#f87171";
    return `<tr style="border-bottom:1px solid #262626">
      <td style="padding:8px"><a href="${url}" style="color:#f3f4f6;text-decoration:none">${a._player_name}</a></td>
      <td style="padding:8px;color:#a3a3a3">${MARKET_LABELS[a.market_type] || a.market_type}</td>
      <td style="padding:8px;text-align:right;color:${color};font-weight:600">${edgeStr}</td>
      <td style="padding:8px;text-align:right;color:#fbbf24">${pct(a.kalshi_prob)}</td>
      <td style="padding:8px;text-align:right;color:#d4d4d4">${pct(a.reference_prob)}</td>
      <td style="padding:8px;text-align:right;color:#737373;font-size:12px">${a.book_count} books</td>
    </tr>`;
  }).join("");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#ededed;padding:20px">
    <h2 style="color:#22c55e;margin:0 0 8px">⛳ GolfOdds — ${alerts.length} new edge${alerts.length === 1 ? "" : "s"}</h2>
    <p style="color:#a3a3a3;margin:0 0 16px;font-size:14px">${alerts[0]._tournament_name}</p>
    <table style="width:100%;border-collapse:collapse;background:#171717;border-radius:6px;overflow:hidden">
      <thead><tr style="background:#262626;color:#9ca3af;font-size:11px;text-transform:uppercase">
        <th style="padding:8px;text-align:left">Player</th>
        <th style="padding:8px;text-align:left">Market</th>
        <th style="padding:8px;text-align:right">Buy edge</th>
        <th style="padding:8px;text-align:right">Kalshi</th>
        <th style="padding:8px;text-align:right">Books med</th>
        <th style="padding:8px;text-align:right">Books</th>
      </tr></thead><tbody>${rows}</tbody></table>
    <p style="color:#737373;font-size:12px;margin-top:16px">
      Positive edge = Kalshi cheaper than book consensus → consider buying YES on Kalshi.
      Negative edge = Kalshi overpriced → sell on Kalshi (or bet at the books).
      <br>Sent by GolfOdds cron · <a href="https://hyder.me/golfodds/alerts/" style="color:#22c55e">all alerts</a>
    </p>
  </div>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.ALERT_EMAIL_FROM || "GolfOdds <golfodds@hyder.me>",
      to: [process.env.ALERT_EMAIL_TO],
      subject,
      html,
    }),
  });
  if (!r.ok) return { sent: false, reason: `Resend ${r.status}: ${await r.text().catch(() => "")}` };
  const data = await r.json();
  return { sent: true, id: data.id };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const supabase = getSupabase();
  const startedAt = new Date().toISOString();
  const { data: runRow } = await supabase
    .from("golfodds_cron_runs")
    .insert({ job_name: "cron-detect-alerts", started_at: startedAt })
    .select("id")
    .single();

  // Active tournaments (not settled)
  const { data: tournaments } = await supabase
    .from("golfodds_tournaments")
    .select("id, name")
    .neq("status", "settled")
    .range(0, 99);

  const allNewAlerts = [];
  for (const t of tournaments || []) {
    try {
      const { newAlerts } = await detectForTournament(supabase, t);
      allNewAlerts.push(...newAlerts);
    } catch (e) {
      console.error(`detect ${t.id}: ${e.message}`);
    }
  }

  let inserted = 0;
  if (allNewAlerts.length) {
    // Strip the _underscore display fields before insert
    const rows = allNewAlerts.map(({ _player_name, _tournament_name, ...rest }) => rest);
    const { error } = await supabase.from("golfodds_alerts").insert(rows);
    if (error) console.error(`insert alerts: ${error.message}`);
    else inserted = rows.length;
  }

  // Email batch (admin/owner)
  let emailResult = { sent: false, reason: "no new alerts" };
  let smsResult = { sent: 0 };
  if (allNewAlerts.length > 0) {
    emailResult = await sendEmail(allNewAlerts);
    smsResult = await sendSMSAlerts(supabase, allNewAlerts);
    if (emailResult.sent) {
      await supabase
        .from("golfodds_alerts")
        .update({ notified_at: new Date().toISOString(), notification_channel: smsResult.sent > 0 ? "email+sms" : "email" })
        .gte("fired_at", startedAt);
    }
  }

  if (runRow?.id) {
    await supabase
      .from("golfodds_cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        rows_inserted: inserted,
        errors: 0,
        notes: JSON.stringify({ new_alerts: inserted, email: emailResult }),
      })
      .eq("id", runRow.id);
  }

  return res.status(200).json({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    new_alerts: inserted,
    email: emailResult,
    sms: smsResult,
  });
}
