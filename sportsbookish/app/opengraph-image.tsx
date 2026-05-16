import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "SportsBookISH — Live Kalshi + Polymarket vs sportsbook odds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #020617 0%, #0f172a 50%, #064e3b 100%)",
          padding: "64px 80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M3 3v18h18"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M7 14l4-4 4 4 5-5"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -0.5, display: "flex" }}>
            <span>SportsBook</span>
            <span style={{ color: "#10b981" }}>ISH</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 980 }}>
            Live Kalshi + Polymarket vs sportsbook odds.
          </div>
          <div style={{ fontSize: 30, color: "#cbd5e1", lineHeight: 1.3, maxWidth: 980 }}>
            Real-time edges across NFL, NBA, MLB, NHL, EPL, MLS, UCL, World Cup and PGA Tour. The only place comparing all three.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 12, fontSize: 22, color: "#94a3b8" }}>
            <span style={{ padding: "8px 16px", borderRadius: 8, background: "rgba(16, 185, 129, 0.15)", color: "#6ee7b7", border: "1px solid rgba(16, 185, 129, 0.4)" }}>
              13+ books
            </span>
            <span style={{ padding: "8px 16px", borderRadius: 8, background: "rgba(16, 185, 129, 0.15)", color: "#6ee7b7", border: "1px solid rgba(16, 185, 129, 0.4)" }}>
              9 sports
            </span>
            <span style={{ padding: "8px 16px", borderRadius: 8, background: "rgba(16, 185, 129, 0.15)", color: "#6ee7b7", border: "1px solid rgba(16, 185, 129, 0.4)" }}>
              Updates every 5 min
            </span>
          </div>
          <div style={{ fontSize: 26, color: "#94a3b8", fontWeight: 600 }}>
            sportsbookish.com
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
