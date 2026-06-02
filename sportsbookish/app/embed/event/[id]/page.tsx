import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchEventDetail } from "@/lib/sports-data";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel } from "@/lib/format";
import { relativeTime } from "@/components/LastUpdated";

export const dynamic = "force-dynamic";

// Iframe-friendly per-event widget. Third-party sites embed:
//   <iframe src="https://sportsbookish.com/embed/event/<event_id>"
//           width="600" height="500" frameborder="0"></iframe>
//
// Stripped-down chrome, optimized for cross-origin iframe display.
// X-Frame-Options is overridden in next.config so embeds work.
// Content-Security-Policy frame-ancestors set to * for this route only.

interface PageProps { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Live Kalshi vs Sportsbook odds — SportsBookISH embed`,
    description: "Live event-contract vs sportsbook odds comparison embed widget.",
    alternates: { canonical: `/embed/event/${id}` },
    robots: { index: false, follow: false },
  };
}

export default async function EmbedEvent({ params }: PageProps) {
  const { id } = await params;
  const detail = await fetchEventDetail(id);
  if (!detail) notFound();

  const renderTime = new Date().toISOString();
  const anyBooks = detail.markets.some((m) => (m.books_count ?? 0) > 0);

  return (
        <div style={{ padding: "16px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <a href={`https://sportsbookish.com/sports/${detail.event.league}/event/${id}`} target="_blank" rel="noopener" style={{ color: "#10b981", fontWeight: 600, textDecoration: "none", fontSize: 13 }}>
              SportsBookISH ↗
            </a>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              Updated {relativeTime(detail.freshest_at || renderTime)}
            </span>
          </div>

          <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600 }}>{detail.event.title}</h2>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 16, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {detail.event.league} · {detail.event.event_type}
          </div>

          {detail.markets.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              No live markets right now.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1f1f1f", textAlign: "left" }}>
                  <th style={{ padding: "8px 4px", color: "#9ca3af", fontWeight: 500, fontSize: 11, textTransform: "uppercase" }}>Side</th>
                  <th style={{ padding: "8px 4px", color: "#f59e0b", fontWeight: 500, fontSize: 11, textTransform: "uppercase", textAlign: "right" }}>Kalshi</th>
                  <th style={{ padding: "8px 4px", color: "#a855f7", fontWeight: 500, fontSize: 11, textTransform: "uppercase", textAlign: "right" }}>Polymkt</th>
                  <th style={{ padding: "8px 4px", color: "#10b981", fontWeight: 500, fontSize: 11, textTransform: "uppercase", textAlign: "right" }}>Books</th>
                  <th style={{ padding: "8px 4px", color: "#9ca3af", fontWeight: 500, fontSize: 11, textTransform: "uppercase", textAlign: "right" }}>Edge</th>
                  <th style={{ padding: "8px 4px", color: "#9ca3af", fontWeight: 500, fontSize: 11, textTransform: "uppercase", textAlign: "left" }}>Best</th>
                </tr>
              </thead>
              <tbody>
                {detail.markets.slice(0, 8).map((m) => {
                  const edge = m.edge_vs_books_median;
                  const edgeColor = edge == null ? "#6b7280" : edge > 0 ? "#10b981" : "#dc2626";
                  return (
                    <tr key={m.id} style={{ borderBottom: "1px solid #1f1f1f" }}>
                      <td style={{ padding: "10px 4px", fontWeight: 500 }}>{m.contestant_label}</td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#f59e0b", fontVariantNumeric: "tabular-nums" }}>{fmtPct(m.implied_prob)}</td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: m.polymarket_prob != null ? "#a855f7" : "#404040", fontVariantNumeric: "tabular-nums" }}>
                        {m.polymarket_prob != null ? fmtPct(m.polymarket_prob) : "—"}
                      </td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#10b981", fontVariantNumeric: "tabular-nums" }}>{fmtPct(m.books_median ?? null)}</td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: edgeColor, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtPctSigned(edge ?? null)}</td>
                      <td style={{ padding: "10px 4px", fontSize: 11, color: "#9ca3af" }}>
                        {m.best_book ? `${bookLabel(m.best_book.book)} ${fmtAmerican(m.best_book.american)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #1f1f1f", fontSize: 10, color: "#6b7280", textAlign: "center" }}>
            Live from <a href="https://sportsbookish.com" target="_blank" rel="noopener" style={{ color: "#10b981" }}>SportsBookISH</a> · Edge = books_median − Kalshi · {anyBooks ? "Devigged book consensus" : "Books not yet posting"}
          </div>
        </div>
  );
}
