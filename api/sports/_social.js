// Bluesky AT Protocol posting helper.
//
// Auth: BLUESKY_HANDLE (e.g. "sportsbookish.bsky.social") + BLUESKY_APP_PASSWORD
// (NOT your account password — generate one at https://bsky.app/settings/app-passwords).
// If either env var is missing, postBluesky() returns { ok: false, skipped: true }
// so the cron logs without failing.
//
// Returns: { ok, skipped?, error?, uri?, cid? } — uri/cid are the AT-URI and
// content hash you can use to delete or quote the post later.

const BSKY_BASE = "https://bsky.social/xrpc";

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
  return r.json();  // { accessJwt, did, ... }
}

// Parse a text string for URLs + return facets (Bluesky's way of rendering
// hyperlinks). Without facets, links render as plain text.
function buildFacets(text) {
  const facets = [];
  const urlRegex = /https?:\/\/[^\s)]+/g;
  let m;
  // Bluesky needs byte indexes (UTF-8) not JS char indexes.
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

export async function postBluesky(text) {
  if (!process.env.BLUESKY_HANDLE || !process.env.BLUESKY_APP_PASSWORD) {
    return { ok: false, skipped: true, reason: "BLUESKY_HANDLE or BLUESKY_APP_PASSWORD not set" };
  }
  // Bluesky's hard limit is 300 graphemes. Truncate defensively.
  if (text.length > 300) text = text.slice(0, 297) + "…";

  try {
    const session = await bskySession();
    if (!session) return { ok: false, skipped: true, reason: "no session" };
    const record = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: new Date().toISOString(),
      facets: buildFacets(text),
      langs: ["en"],
    };
    const r = await fetch(`${BSKY_BASE}/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record,
      }),
    });
    if (!r.ok) return { ok: false, error: `${r.status}: ${await r.text().catch(() => "")}` };
    const data = await r.json();
    return { ok: true, uri: data.uri, cid: data.cid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// Format a top-edges summary into a ≤300-char Bluesky post.
//   alerts: [{ title, subtitle, delta, source }] (same shape as the email digest)
export function formatDigestPost(buys, movers, siteUrl) {
  const lines = [`📊 Today's top sportsbook edges`];
  for (const a of buys.slice(0, 3)) {
    const pct = `${a.delta >= 0 ? "+" : ""}${(a.delta * 100).toFixed(1)}%`;
    const subtitle = a.subtitle.length > 35 ? a.subtitle.slice(0, 35) + "…" : a.subtitle;
    lines.push(`🟢 ${a.title}: ${pct} (${subtitle})`);
  }
  if (movers.length > 0) {
    const m = movers[0];
    const sign = m.delta >= 0 ? "↗" : "↘";
    lines.push(`${sign} Biggest move: ${m.title} ${(m.delta * 100).toFixed(1)}%`);
  }
  lines.push(`${siteUrl}/sports`);
  let text = lines.join("\n");
  if (text.length > 300) {
    // drop the move line if too long
    text = [...lines.slice(0, 4), siteUrl + "/sports"].join("\n");
  }
  return text;
}

// Format a single-event move into a short Bluesky post.
//   { title, subtitle, delta, probability, reference, source, league, link }
export function formatMoveAlert(alert, siteUrl) {
  const sign = alert.delta >= 0 ? "↗" : "↘";
  const pct = `${(alert.delta * 100).toFixed(1)}%`;
  const probNow = `${(alert.probability * 100).toFixed(0)}%`;
  const probWas = `${(alert.reference * 100).toFixed(0)}%`;
  const lines = [
    `${sign} Kalshi line move alert`,
    `${alert.title} (${alert.subtitle})`,
    `Now ${probNow} (was ${probWas}, ${alert.delta >= 0 ? "+" : ""}${pct})`,
    `${siteUrl}${alert.link}`,
  ];
  return lines.join("\n").slice(0, 300);
}
