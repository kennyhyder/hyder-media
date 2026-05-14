import { ImageResponse } from "next/og";

// 1200×630 social card for a sports event. Mounted at
//   /api/og/sports-event?id=<sports_event_id>
//
// Used by:
// - Open Graph (og:image) for /sports/[league]/event/[id]
// - Programmatic social posts when the dispatcher fires an alert
//
// Renders entirely server-side (Edge runtime), so the URL itself is
// cacheable and shareable.

export const runtime = "edge";

const SPORT_EMOJI: Record<string, string> = {
  pga: "⛳", golf: "⛳",
  nba: "🏀", mlb: "⚾", nhl: "🏒",
  epl: "⚽", mls: "⚽",
};

interface EventApiResponse {
  event: { id: string; league: string; title: string; start_time: string | null };
  markets: {
    contestant_label: string;
    implied_prob: number | null;
    books_median: number | null;
    edge_vs_books_median: number | null;
  }[];
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
  } catch {}

  if (!detail) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%", height: "100%",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, #0a0a0a 0%, #064e3b 100%)",
            color: "white", fontSize: 48, fontFamily: "sans-serif",
          }}
        >
          <div style={{ fontSize: 64, marginBottom: 16 }}>SportsBookISH</div>
          <div style={{ opacity: 0.6 }}>Live edges on Kalshi vs the books</div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  const ev = detail.event;
  const emoji = SPORT_EMOJI[ev.league] || "🎯";
  const m0 = detail.markets[0];
  const m1 = detail.markets[1];

  // Find the team with the biggest absolute edge (if any) to highlight
  let highlight: typeof detail.markets[number] | null = null;
  let bestAbs = 0;
  for (const m of detail.markets) {
    const e = m.edge_vs_books_median;
    if (e != null && Math.abs(e) > bestAbs) {
      bestAbs = Math.abs(e);
      highlight = m;
    }
  }
  const edge = highlight?.edge_vs_books_median ?? null;
  const isBuy = edge != null && edge > 0;
  const edgeColor = edge == null ? "#a3a3a3" : isBuy ? "#34d399" : "#fb7185";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%",
          display: "flex", flexDirection: "column",
          background: "linear-gradient(135deg, #0a0a0a 0%, #0f3a2a 100%)",
          color: "white", fontFamily: "sans-serif",
          padding: 56,
          position: "relative",
        }}
      >
        {/* Top brand bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 22, fontWeight: 700 }}>
            <span style={{ color: "#34d399" }}>▲</span>
            <span>SportsBook<span style={{ color: "#34d399" }}>ISH</span></span>
          </div>
          <div style={{ fontSize: 18, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 2 }}>
            {emoji} {ev.league}
          </div>
        </div>

        {/* Title */}
        <div style={{ marginTop: 36, fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>
          {ev.title}
        </div>

        {/* Lines comparison */}
        <div style={{ marginTop: 56, display: "flex", gap: 32, flex: 1 }}>
          {m0 && (
            <MarketCol
              label={m0.contestant_label}
              kalshi={m0.implied_prob}
              books={m0.books_median}
              edge={m0.edge_vs_books_median}
            />
          )}
          {m1 && (
            <MarketCol
              label={m1.contestant_label}
              kalshi={m1.implied_prob}
              books={m1.books_median}
              edge={m1.edge_vs_books_median}
            />
          )}
        </div>

        {/* Edge callout (if any) */}
        {highlight && edge != null && Math.abs(edge) >= 0.01 && (
          <div
            style={{
              position: "absolute",
              bottom: 56, left: 56, right: 56,
              padding: "16px 24px",
              background: `${edgeColor}22`,
              border: `2px solid ${edgeColor}80`,
              borderRadius: 12,
              display: "flex", alignItems: "center", gap: 16,
            }}
          >
            <div style={{ fontSize: 22 }}>{isBuy ? "🟢 BUY" : "🔴 SELL"}</div>
            <div style={{ fontSize: 22, flex: 1 }}>
              {highlight.contestant_label}: Kalshi {fmtPct(highlight.implied_prob)} vs books {fmtPct(highlight.books_median)}
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: edgeColor }}>
              {edge >= 0 ? "+" : ""}{(edge * 100).toFixed(1)}%
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ position: "absolute", bottom: 16, left: 56, fontSize: 16, color: "#6b7280" }}>
          sportsbookish.com — live odds, every 5 min
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "cache-control": "public, max-age=300, s-maxage=300" },
    }
  );
}

function MarketCol({ label, kalshi, books, edge }: { label: string; kalshi: number | null; books: number | null; edge: number | null }) {
  const edgeColor = edge == null ? "#9ca3af" : edge > 0 ? "#34d399" : "#fb7185";
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 32, fontWeight: 700 }}>{label}</div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#fcd34d", fontSize: 22 }}>
        <span>Kalshi</span><span style={{ fontWeight: 700 }}>{fmtPct(kalshi)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#9ca3af", fontSize: 22 }}>
        <span>Books med</span><span>{fmtPct(books)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 }}>
        <span style={{ color: "#9ca3af" }}>Edge</span>
        <span style={{ fontWeight: 700, color: edgeColor }}>{fmtPctSigned(edge)}</span>
      </div>
    </div>
  );
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
function fmtPctSigned(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}
