// Social posting helpers. Plugin-style: postSocial(text, meta) attempts every
// configured platform (X via Make webhook, optionally Bluesky direct).
//
// Setup paths:
//
//   X / Twitter via Make.com (free tier)
//   ──────────────────────────────────────
//   1. Sign up at make.com (free tier = 1,000 ops/mo, way more than needed)
//   2. Create new scenario:
//        Trigger: Webhooks → "Custom webhook"
//        Action:  Twitter X → "Create a Post" (or "Tweet")
//   3. Connect your X account inside Make once (OAuth in browser)
//   4. Map the webhook body's `text` field → X post text
//   5. Activate the scenario, copy the webhook URL it generates
//   6. Set MAKE_X_WEBHOOK_URL env var on hyder-me-ecaw production
//
//   Bluesky direct (optional, free)
//   ───────────────────────────────
//   Set BLUESKY_HANDLE + BLUESKY_APP_PASSWORD (app password from
//   bsky.app/settings/app-passwords, NOT account password).
//
// If NEITHER is set, postSocial() returns { ok: false, skipped: true }
// so crons can run without crashing while you finish setup.

const BSKY_BASE = "https://bsky.social/xrpc";

// ---- Bluesky helper ----

async function bskySession() {
  const handle = process.env.BLUESKY_HANDLE;
  const appPassword = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !appPassword) return null;
  const r = await fetch(`${BSKY_BASE}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });
  if (!r.ok) throw new Error(`bsky session ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

function bskyFacets(text) {
  const facets = [];
  const urlRegex = /https?:\/\/[^\s)]+/g;
  let m;
  const encoder = new TextEncoder();
  while ((m = urlRegex.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const byteStart = encoder.encode(before).length;
    const byteEnd = byteStart + encoder.encode(m[0]).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }],
    });
  }
  return facets;
}

async function postBluesky(text) {
  if (!process.env.BLUESKY_HANDLE || !process.env.BLUESKY_APP_PASSWORD) {
    return { ok: false, skipped: true, reason: "BLUESKY creds not set" };
  }
  if (text.length > 300) text = text.slice(0, 297) + "…";
  try {
    const session = await bskySession();
    if (!session) return { ok: false, skipped: true };
    const r = await fetch(`${BSKY_BASE}/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), facets: bskyFacets(text), langs: ["en"] },
      }),
    });
    if (!r.ok) return { ok: false, error: `${r.status}: ${await r.text().catch(() => "")}` };
    const data = await r.json();
    return { ok: true, uri: data.uri, cid: data.cid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ---- X / Twitter via Make.com webhook ----

async function postX(text, meta = {}) {
  const url = process.env.MAKE_X_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: true, reason: "MAKE_X_WEBHOOK_URL not set" };
  try {
    // X hard limit is 280 chars (4000 for Premium, but assume free-tier
    // accounts). Truncate defensively.
    const tweetText = text.length > 280 ? text.slice(0, 277) + "…" : text;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: tweetText, ...meta }),
    });
    if (!r.ok) return { ok: false, error: `${r.status}: ${await r.text().catch(() => "")}` };
    // Make returns "Accepted" (200 text) when webhook fires successfully.
    // It doesn't echo the post URL — that lives in the Make scenario history.
    return { ok: true, webhook_status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ---- Public API: post to every configured platform ----

export async function postSocial(text, meta = {}) {
  // X is primary (paid attention), Bluesky is optional secondary
  const [xRes, bRes] = await Promise.all([postX(text, meta), postBluesky(text)]);
  return {
    x: xRes,
    bluesky: bRes,
    any_sent: xRes.ok || bRes.ok,
    any_configured: !xRes.skipped || !bRes.skipped,
  };
}

// ---- Formatters (X = 280 char limit, Bluesky = 300 — format for the tighter one) ----

export function formatDigestPost(buys, movers, siteUrl) {
  const lines = [`📊 Today's top sportsbook edges`];
  for (const a of buys.slice(0, 3)) {
    const pct = `${a.delta >= 0 ? "+" : ""}${(a.delta * 100).toFixed(1)}%`;
    const subtitle = a.subtitle.length > 28 ? a.subtitle.slice(0, 28) + "…" : a.subtitle;
    lines.push(`🟢 ${a.title}: ${pct} (${subtitle})`);
  }
  if (movers.length > 0) {
    const m = movers[0];
    const sign = m.delta >= 0 ? "↗" : "↘";
    lines.push(`${sign} Move: ${m.title} ${(m.delta * 100).toFixed(1)}%`);
  }
  lines.push(`${siteUrl}/sports`);
  let text = lines.join("\n");
  if (text.length > 275) {
    text = [...lines.slice(0, 4), `${siteUrl}/sports`].join("\n");
  }
  return text;
}

export function formatMoveAlert(alert, siteUrl) {
  const sign = alert.delta >= 0 ? "↗" : "↘";
  const pct = `${(alert.delta * 100).toFixed(1)}%`;
  const probNow = `${(alert.probability * 100).toFixed(0)}%`;
  const probWas = `${(alert.reference * 100).toFixed(0)}%`;
  return [
    `${sign} Kalshi line move`,
    `${alert.title} (${alert.subtitle})`,
    `Now ${probNow} (was ${probWas}, ${alert.delta >= 0 ? "+" : ""}${pct})`,
    `${siteUrl}${alert.link}`,
  ].join("\n").slice(0, 280);
}
