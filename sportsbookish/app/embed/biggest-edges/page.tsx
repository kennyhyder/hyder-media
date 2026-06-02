import type { Metadata } from "next";
import { fetchLeagues, fetchLeagueData, type InlineMarket, type SportsEvent } from "@/lib/sports-data";
import { fmtPct, fmtPctSigned, bookLabel } from "@/lib/format";
import { relativeTime } from "@/components/LastUpdated";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Today's biggest sports betting edges — SportsBookISH embed",
  robots: { index: false, follow: false },
};

const HARD_MIN = 0.04;
const HARD_MAX = 0.96;
const MIN_EDGE = 0.02;

export default async function EmbedBiggestEdges() {
  const renderTime = new Date().toISOString();
  const leagues = await fetchLeagues();
  const leagueData = await Promise.all(
    leagues.map((l) => fetchLeagueData(l.key).then((d) => ({ league: l.key, ...d })))
  );

  // Build top edges list (same logic as /sports/positive-ev)
  interface Row { league: string; event: SportsEvent; market: InlineMarket; edge: number; }
  const rows: Row[] = [];
  for (const ld of leagueData) {
    for (const ev of ld.events) {
      for (const m of (ev.markets || [])) {
        const k = m.implied_prob;
        const med = m.books_median;
        if (k == null || med == null) continue;
        if (k < HARD_MIN || k > HARD_MAX) continue;
        const edge = med - k;
        if (edge < MIN_EDGE) continue;
        if ((m.books_count ?? 0) < 2) continue;
        rows.push({ league: ld.league, event: ev, market: m, edge });
      }
    }
  }
  rows.sort((a, b) => b.edge - a.edge);
  const top = rows.slice(0, 10);

  return (
    <div style={{ padding: "16px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <a href="https://sportsbookish.com/sports/positive-ev" target="_blank" rel="noopener" style={{ color: "#10b981", fontWeight: 600, textDecoration: "none", fontSize: 13 }}>
          SportsBookISH · +EV Today ↗
        </a>
        <span style={{ fontSize: 11, color: "#6b7280" }}>Updated {relativeTime(renderTime)}</span>
      </div>

      <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>Today&apos;s biggest sports betting edges</h2>

      {top.length === 0 ? (
        <div style={{ padding: "32px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
          No qualifying +EV opportunities right now.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1f1f1f", textAlign: "left" }}>
              <th style={{ padding: "6px 4px", color: "#9ca3af", fontWeight: 500, fontSize: 10, textTransform: "uppercase" }}>Market</th>
              <th style={{ padding: "6px 4px", color: "#9ca3af", fontWeight: 500, fontSize: 10, textTransform: "uppercase", textAlign: "right" }}>Edge</th>
              <th style={{ padding: "6px 4px", color: "#9ca3af", fontWeight: 500, fontSize: 10, textTransform: "uppercase", textAlign: "left" }}>Best book</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={`${r.event.id}|${r.market.id}`} style={{ borderBottom: "1px solid #1f1f1f" }}>
                <td style={{ padding: "8px 4px" }}>
                  <div style={{ fontWeight: 500 }}>{r.market.contestant_label}</div>
                  <div style={{ fontSize: 10, color: "#6b7280", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.event.title}</div>
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right", color: "#10b981", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {fmtPctSigned(r.edge)}
                </td>
                <td style={{ padding: "8px 4px", fontSize: 11, color: "#9ca3af" }}>
                  {r.market.best_book ? bookLabel(r.market.best_book.book) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #1f1f1f", fontSize: 10, color: "#6b7280", textAlign: "center" }}>
        Live edges from <a href="https://sportsbookish.com" target="_blank" rel="noopener" style={{ color: "#10b981" }}>SportsBookISH</a> · Kalshi vs 14-book median
      </div>
    </div>
  );
}
