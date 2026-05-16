import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import type { EventArchiveResult } from "@/lib/sports-data";

interface Props {
  event: { id: string; title: string; event_type: string };
  league: string;
  year: number;
  archive: EventArchiveResult["archive"];
  canonicalPath: string;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtPctSign(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

export default function ClosedEventView({ event, league, year, archive, canonicalPath }: Props) {
  const sides = archive?.final_snapshot?.markets || [];
  // Rank by closing Kalshi probability — top is the "winner" by Kalshi.
  const sorted = [...sides]
    .filter((s) => s.kalshi?.implied_prob != null)
    .sort((a, b) => (b.kalshi!.implied_prob! - a.kalshi!.implied_prob!));
  const winner = sorted[0] || null;
  const loser = sorted[1] || null;
  const closedDate = archive?.closed_at ? new Date(archive.closed_at) : null;

  const faqItems = [
    {
      question: `Did Kalshi correctly price ${event.title}?`,
      answer: winner
        ? `At settlement, Kalshi had ${winner.contestant_label} priced at ${fmtPct(winner.kalshi?.implied_prob)} (closing implied probability). Compare against the de-vigged book median of ${fmtPct(winner.books?.median)} from ${winner.books?.count ?? 0} US sportsbooks.`
        : "No closing snapshot was captured for this event.",
    },
    {
      question: `What was the final book consensus for ${event.title}?`,
      answer: sorted.length
        ? sorted.map((s) => `${s.contestant_label}: ${fmtPct(s.books?.median)} median de-vigged across ${s.books?.count ?? 0} books`).join(" · ")
        : "Book consensus data was not available for this archived event.",
    },
    {
      question: `Where can I find live ${event.title.split(" vs ")[0] ?? event.title} odds?`,
      answer: `For current ${league.toUpperCase()} matchups, see the live ${league.toUpperCase()} hub at /sports/${league}, or browse the full ${year} archive at /sports/${league}/${year}.`,
    },
  ];

  const ldData = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Sports", url: "/sports" },
      { name: league.toUpperCase(), url: `/sports/${league}` },
      { name: String(year), url: `/sports/${league}/${year}` },
      { name: event.title, url: canonicalPath },
    ]),
    faqLd(faqItems),
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: winner
        ? `${event.title} (${year}) — Kalshi closed ${winner.contestant_label} at ${fmtPct(winner.kalshi?.implied_prob)}`
        : `${event.title} (${year}) final Kalshi odds`,
      datePublished: archive?.closed_at,
      dateModified: archive?.closed_at,
      mainEntityOfPage: `${SITE_URL}${canonicalPath}`,
      author: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
      publisher: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
    },
  ];

  return (
    <div className="min-h-screen">
      <JsonLd data={ldData} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href={`/sports/${league}/${year}`} className="text-sm text-muted-foreground hover:text-foreground">← {league.toUpperCase()} {year}</Link>
          <div className="font-semibold text-sm">{event.title}</div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-muted-foreground/40 text-muted-foreground">
            Final
          </Badge>
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-5xl px-4 py-10">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
          <span>{league}</span>
          <span aria-hidden="true">·</span>
          <span>{event.event_type}</span>
          <span aria-hidden="true">·</span>
          <span>Settled</span>
          {closedDate && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={archive!.closed_at}>{closedDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</time>
            </>
          )}
        </div>

        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
          {event.title} <span className="text-muted-foreground font-normal">— {year} final odds</span>
        </h1>

        <p className="text-lg text-muted-foreground mb-8 max-w-3xl">
          {winner ? (
            <>
              Kalshi closed with <strong className="text-foreground">{winner.contestant_label}</strong> at{" "}
              <strong className="text-emerald-500">{fmtPct(winner.kalshi?.implied_prob)}</strong>
              {loser && <> versus <strong className="text-foreground">{loser.contestant_label}</strong> at <strong className="text-foreground">{fmtPct(loser.kalshi?.implied_prob)}</strong></>}.
              {" "}Final book consensus: {sorted.map((s) => `${s.contestant_label} ${fmtPct(s.books?.median)}`).join(" / ")}.
            </>
          ) : (
            <>This event is settled. The final closing snapshot from Kalshi and {sorted[0]?.books?.count ?? 0}+ US sportsbooks is shown below.</>
          )}
        </p>

        {sides.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-card/40 p-6">
            <p className="text-sm text-muted-foreground">No closing snapshot was captured for this event. <Link href={`/sports/${league}`} className="text-emerald-400 hover:underline">Browse live {league.toUpperCase()} odds →</Link></p>
          </div>
        ) : (
          <section aria-labelledby="closing-prices-heading" className="mb-10">
            <h2 id="closing-prices-heading" className="text-xl font-semibold mb-3">Closing prices</h2>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm" aria-describedby="closing-prices-heading">
                <thead className="bg-card/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th scope="col" className="text-left px-3 py-2">Side</th>
                    <th scope="col" className="text-right px-3 py-2">Kalshi closing</th>
                    <th scope="col" className="text-right px-3 py-2">Books median</th>
                    <th scope="col" className="text-right px-3 py-2">Books count</th>
                    <th scope="col" className="text-right px-3 py-2">Edge (books − Kalshi)</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s) => {
                    const kalshi = s.kalshi?.implied_prob ?? null;
                    const median = s.books?.median ?? null;
                    const edge = kalshi != null && median != null ? median - kalshi : null;
                    return (
                      <tr key={s.market_id} className="border-t border-border/40">
                        <th scope="row" className="text-left px-3 py-2 font-medium">{s.contestant_label}</th>
                        <td className="text-right px-3 py-2 font-mono">{fmtPct(kalshi)}</td>
                        <td className="text-right px-3 py-2 font-mono">{fmtPct(median)}</td>
                        <td className="text-right px-3 py-2 font-mono text-muted-foreground">{s.books?.count ?? 0}</td>
                        <td className={`text-right px-3 py-2 font-mono ${edge != null && edge > 0.02 ? "text-emerald-400" : edge != null && edge < -0.02 ? "text-red-400" : ""}`}>
                          {fmtPctSign(edge)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section aria-labelledby="related-heading" className="mb-10">
          <h2 id="related-heading" className="text-xl font-semibold mb-3">Related</h2>
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
            <li>
              <Link href={`/sports/${league}/${year}`} className="block rounded border border-border/60 bg-card/40 hover:border-emerald-500/40 px-3 py-2">
                ← All {league.toUpperCase()} {year} events
              </Link>
            </li>
            <li>
              <Link href={`/sports/${league}`} className="block rounded border border-border/60 bg-card/40 hover:border-emerald-500/40 px-3 py-2">
                Live {league.toUpperCase()} odds
              </Link>
            </li>
            <li>
              <Link href={`/sports/movers?league=${league}`} className="block rounded border border-border/60 bg-card/40 hover:border-emerald-500/40 px-3 py-2">
                Recent line moves
              </Link>
            </li>
          </ul>
        </section>

        <section aria-labelledby="faq-heading" className="mb-10">
          <h2 id="faq-heading" className="text-xl font-semibold mb-3">FAQ</h2>
          <dl className="space-y-3">
            {faqItems.map((f) => (
              <div key={f.question} className="rounded border border-border/60 bg-card/40 px-4 py-3">
                <dt className="font-medium text-sm">{f.question}</dt>
                <dd className="text-sm text-muted-foreground mt-1">{f.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="text-xs text-muted-foreground border-t border-border/40 pt-4 mt-8">
          This archive shows the final Kalshi and sportsbook prices captured when the event settled. For methodology see <Link href="/about/methodology" className="text-emerald-400 hover:underline">/about/methodology</Link>.
        </p>
      </main>
    </div>
  );
}
