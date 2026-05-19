import { ImageResponse } from "next/og";

// 1200×630 social card for a sports event. Mounted at
//   /api/og/sports-event?id=<sports_event_id>
//
// Renders entirely server-side (Edge runtime), cacheable. Supports every
// event_type (game, championship, conference, MVP, win_total, player_prop_*)
// by ranking markets by Kalshi implied probability and showing the top 3.

export const runtime = "edge";

const SPORT_EMOJI: Record<string, string> = {
  pga: "⛳", golf: "⛳",
  nba: "🏀", mlb: "⚾", nhl: "🏒",
  nfl: "🏈",
  epl: "⚽", mls: "⚽", ucl: "⚽", wc: "⚽",
};

interface EventApiResponse {
  event: { id: string; league: string; title: string; event_type: string; start_time: string | null };
  markets: {
    contestant_label: string;
    implied_prob: number | null;
    books_median?: number | null;
    edge_vs_books_median?: number | null;
  }[];
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fallbackCard() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #020617 0%, #0f172a 50%, #064e3b 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 800, display: "flex" }}>
          <span>SportsBook</span>
          <span style={{ color: "#10b981" }}>ISH</span>
        </div>
        <div style={{ fontSize: 26, color: "#9ca3af", marginTop: 16 }}>
          Live Kalshi + Polymarket vs sportsbook odds
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return new Response("id required", { status: 400 });

  const dataHost = process.env.GOLFODDS_API_HOST || "https://hyder.me";
  let detail: EventApiResponse | null = null;
  try {
    const r = await fetch(`${dataHost}/api/sports/event?id=${id}`, { cache: "no-store" });
    if (r.ok) detail = await r.json();
  } catch {
    // fall through to fallback
  }

  if (!detail || !detail.event) return fallbackCard();

  const ev = detail.event;
  const emoji = SPORT_EMOJI[ev.league] || "🎯";
  const markets = (detail.markets || []).slice();

  // Sort by Kalshi implied prob desc; NULLs sink. Take top 3 for the card.
  markets.sort((a, b) => (b.implied_prob ?? -1) - (a.implied_prob ?? -1));
  const top = markets.slice(0, 3);

  // Pick the highest |edge| for the headline strip (only if a real edge is present)
  let bestEdge: { label: string; edge: number; kalshi: number | null; books: number | null } | null = null;
  for (const m of markets) {
    const e = m.edge_vs_books_median;
    if (e == null) continue;
    if (!bestEdge || Math.abs(e) > Math.abs(bestEdge.edge)) {
      bestEdge = { label: m.contestant_label, edge: e, kalshi: m.implied_prob ?? null, books: m.books_median ?? null };
    }
  }

  try {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: "linear-gradient(135deg, #020617 0%, #0f172a 60%, #064e3b 100%)",
            color: "white",
            fontFamily: "sans-serif",
            padding: "56px 64px",
          }}
        >
          {/* Brand row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: 28, fontWeight: 800 }}>
              <span>SportsBook</span>
              <span style={{ color: "#10b981" }}>ISH</span>
            </div>
            <div style={{ display: "flex", fontSize: 22, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 3 }}>
              {emoji} {ev.league}
            </div>
          </div>

          {/* Title */}
          <div style={{ display: "flex", marginTop: 36, fontSize: 60, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>
            {ev.title.length > 60 ? ev.title.slice(0, 58) + "…" : ev.title}
          </div>

          {/* Top contestants */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 40 }}>
            {top.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 20px",
                  background: "rgba(16, 185, 129, 0.10)",
                  border: "1px solid rgba(16, 185, 129, 0.30)",
                  borderRadius: 10,
                  fontSize: 26,
                }}
              >
                <div style={{ display: "flex", fontWeight: 700, color: "#f1f5f9" }}>
                  {m.contestant_label.length > 40 ? m.contestant_label.slice(0, 38) + "…" : m.contestant_label}
                </div>
                <div style={{ display: "flex", color: "#10b981", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                  {fmtPct(m.implied_prob)}
                </div>
              </div>
            ))}
          </div>

          {/* Edge callout — flex (no absolute positioning) */}
          {bestEdge && Math.abs(bestEdge.edge) >= 0.02 ? (
            <div
              style={{
                display: "flex",
                marginTop: "auto",
                marginBottom: 20,
                padding: "16px 24px",
                background: bestEdge.edge > 0 ? "rgba(52, 211, 153, 0.15)" : "rgba(251, 113, 133, 0.15)",
                border: `2px solid ${bestEdge.edge > 0 ? "#34d399" : "#fb7185"}`,
                borderRadius: 12,
                alignItems: "center",
                gap: 18,
                fontSize: 22,
                color: "white",
              }}
            >
              <div style={{ display: "flex", fontWeight: 800 }}>
                {bestEdge.edge > 0 ? "🟢 BUY" : "🔴 SELL"}
              </div>
              <div style={{ display: "flex", flex: 1 }}>
                {bestEdge.label}: Kalshi {fmtPct(bestEdge.kalshi)} vs books {fmtPct(bestEdge.books)}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 36,
                  fontWeight: 900,
                  color: bestEdge.edge > 0 ? "#34d399" : "#fb7185",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {bestEdge.edge >= 0 ? "+" : ""}{(bestEdge.edge * 100).toFixed(1)}%
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", marginTop: "auto" }} />
          )}

          {/* Footer */}
          <div style={{ display: "flex", fontSize: 18, color: "#6b7280" }}>
            sportsbookish.com · Updated every 5 min
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: { "cache-control": "public, max-age=300, s-maxage=300" },
      }
    );
  } catch {
    // ImageResponse threw mid-render — serve the brand fallback instead of
    // returning HTTP 200 with empty body (Vercel's behavior otherwise).
    return fallbackCard();
  }
}
