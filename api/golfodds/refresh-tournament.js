// Tournament-scoped refresh entrypoint. Re-runs the existing Kalshi + DataGolf
// crons so a user can see fresh prices on-demand. The crons are idempotent and
// always pull the currently-active tournament (PGA Tour has one active event
// at a time), so the tournament_id parameter is informational — it gets
// returned in the response for client UI confirmation but doesn't filter the
// upstream work.
//
// Auth: Bearer CRON_SECRET (Elite refresh proxy on sportsbookish.com holds it).
//
// GET /api/golfodds/refresh-tournament?tournament_id=<uuid>
//
// Trigger cost: 1 Kalshi REST burst (free) + 6 DataGolf calls (flat-rate
// subscription, no per-call cost). Latency 3-10 seconds.

import kalshiCronHandler from "./cron-ingest-kalshi.js";
import dataGolfCronHandler from "./cron-ingest-datagolf.js";

export const config = { maxDuration: 60 };

function checkAuth(req) {
  const provided = req.query?.secret || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET) return true;
  return provided === process.env.CRON_SECRET;
}

// Lightweight res shim — captures the cron handler's res.status().json() call
// so we can extract its summary without holding open the outer request stream.
function makeResShim() {
  let status = 200;
  let body = null;
  return {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
    get result() { return { status, body }; },
  };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const tournamentId = req.query.tournament_id;
  const t0 = Date.now();

  // Pass through Authorization header so the inner cron handler's auth check passes
  const innerReq = {
    query: {},
    headers: { authorization: `Bearer ${process.env.CRON_SECRET || ""}` },
  };

  const [kRes, dRes] = await Promise.allSettled([
    (async () => { const r = makeResShim(); await kalshiCronHandler(innerReq, r); return r.result; })(),
    (async () => { const r = makeResShim(); await dataGolfCronHandler(innerReq, r); return r.result; })(),
  ]);

  const kalshi = kRes.status === "fulfilled"
    ? { ok: kRes.value.status === 200, ...(kRes.value.body || {}) }
    : { ok: false, error: kRes.reason?.message || "kalshi cron failed" };

  const datagolf = dRes.status === "fulfilled"
    ? { ok: dRes.value.status === 200, ...(dRes.value.body || {}) }
    : { ok: false, error: dRes.reason?.message || "datagolf cron failed" };

  return res.status(200).json({
    ok: kalshi.ok || datagolf.ok,
    tournament_id: tournamentId || null,
    kalshi,
    datagolf,
    elapsed_ms: Date.now() - t0,
  });
}
