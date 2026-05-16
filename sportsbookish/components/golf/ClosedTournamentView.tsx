import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import type { TournamentSlugRow, TournamentArchiveResult } from "@/lib/golf-data";

interface Props {
  tournament: TournamentSlugRow;
  year: number;
  archive: TournamentArchiveResult["archive"];
  canonicalPath: string;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export default function ClosedTournamentView({ tournament, year, archive, canonicalPath }: Props) {
  const snap = archive?.final_snapshot;
  // Filter to "win" market rows for the headline leaderboard
  const winRows = (snap?.rows || [])
    .filter((r) => r.market_type === "win" && r.kalshi?.implied_prob != null)
    .sort((a, b) => (b.kalshi!.implied_prob! - a.kalshi!.implied_prob!));
  const top10 = winRows.slice(0, 10);
  const winner = top10[0] || null;
  const closedDate = archive?.closed_at ? new Date(archive.closed_at) : null;

  const faqItems = [
    {
      question: `What were Kalshi's closing odds for the ${tournament.name} ${year}?`,
      answer: winner?.player?.name
        ? `Kalshi closed with ${winner.player.name} as the favorite at ${fmtPct(winner.kalshi?.implied_prob)} (closing implied probability for outright winner).`
        : "No closing snapshot was captured for this tournament.",
    },
    {
      question: `How did Kalshi compare to DataGolf and the sportsbook consensus?`,
      answer: winner
        ? `For ${winner.player?.name}: Kalshi closed at ${fmtPct(winner.kalshi?.implied_prob)}, DataGolf model at ${fmtPct(winner.datagolf?.dg_prob)}, books median at ${fmtPct(winner.books?.median)} across ${winner.books?.count ?? 0} sportsbooks.`
        : "Comparison data was not available for this archived tournament.",
    },
    {
      question: `Where can I find live golf odds for upcoming tournaments?`,
      answer: `Browse current PGA Tour tournaments at /golf, or see other archived ${year} tournaments at /golf/${year}.`,
    },
  ];

  const ldData = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Golf", url: "/golf" },
      { name: String(year), url: `/golf/${year}` },
      { name: tournament.name, url: canonicalPath },
    ]),
    faqLd(faqItems),
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: winner
        ? `${tournament.name} ${year} — Kalshi closed ${winner.player?.name} at ${fmtPct(winner.kalshi?.implied_prob)}`
        : `${tournament.name} ${year} final Kalshi odds`,
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
          <Link href={`/golf/${year}`} className="text-sm text-muted-foreground hover:text-foreground">← PGA Tour {year}</Link>
          <div className="font-semibold text-sm">{tournament.name}</div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-muted-foreground/40 text-muted-foreground">
            Final
          </Badge>
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-5xl px-4 py-10">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
          <span>PGA Tour</span>
          {tournament.is_major && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-400">Major</span>
            </>
          )}
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
          {tournament.name} <span className="text-muted-foreground font-normal">— {year} final odds</span>
        </h1>

        <p className="text-lg text-muted-foreground mb-8 max-w-3xl">
          {winner?.player?.name ? (
            <>
              Kalshi closed with <strong className="text-foreground">{winner.player.name}</strong> as the outright winner favorite at{" "}
              <strong className="text-emerald-500">{fmtPct(winner.kalshi?.implied_prob)}</strong>.
              {" "}DataGolf model: {fmtPct(winner.datagolf?.dg_prob)}. Books median: {fmtPct(winner.books?.median)} across {winner.books?.count ?? 0} sportsbooks.
            </>
          ) : (
            <>This tournament is settled. The final closing snapshot from Kalshi, DataGolf, and US sportsbooks is shown below.</>
          )}
        </p>

        {top10.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-card/40 p-6">
            <p className="text-sm text-muted-foreground">No closing snapshot was captured for this tournament. <Link href="/golf" className="text-emerald-400 hover:underline">Browse live PGA Tour odds →</Link></p>
          </div>
        ) : (
          <section aria-labelledby="closing-leaderboard-heading" className="mb-10">
            <h2 id="closing-leaderboard-heading" className="text-xl font-semibold mb-3">Closing outright winner odds (top {top10.length})</h2>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm" aria-describedby="closing-leaderboard-heading">
                <thead className="bg-card/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th scope="col" className="text-left px-3 py-2">Rank</th>
                    <th scope="col" className="text-left px-3 py-2">Player</th>
                    <th scope="col" className="text-right px-3 py-2">Kalshi</th>
                    <th scope="col" className="text-right px-3 py-2">DataGolf</th>
                    <th scope="col" className="text-right px-3 py-2">Books median</th>
                    <th scope="col" className="text-right px-3 py-2">Books</th>
                  </tr>
                </thead>
                <tbody>
                  {top10.map((r, i) => (
                    <tr key={r.market_id} className="border-t border-border/40">
                      <td className="px-3 py-2 text-muted-foreground font-mono">{i + 1}</td>
                      <th scope="row" className="text-left px-3 py-2 font-medium">{r.player?.name ?? "Unknown"}</th>
                      <td className="text-right px-3 py-2 font-mono">{fmtPct(r.kalshi?.implied_prob)}</td>
                      <td className="text-right px-3 py-2 font-mono">{fmtPct(r.datagolf?.dg_prob)}</td>
                      <td className="text-right px-3 py-2 font-mono">{fmtPct(r.books?.median)}</td>
                      <td className="text-right px-3 py-2 font-mono text-muted-foreground">{r.books?.count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section aria-labelledby="related-heading" className="mb-10">
          <h2 id="related-heading" className="text-xl font-semibold mb-3">Related</h2>
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
            <li>
              <Link href={`/golf/${year}`} className="block rounded border border-border/60 bg-card/40 hover:border-emerald-500/40 px-3 py-2">
                ← All PGA Tour {year} tournaments
              </Link>
            </li>
            <li>
              <Link href="/golf" className="block rounded border border-border/60 bg-card/40 hover:border-emerald-500/40 px-3 py-2">
                Live PGA Tour odds
              </Link>
            </li>
            <li>
              <Link href="/golf/players" className="block rounded border border-border/60 bg-card/40 hover:border-emerald-500/40 px-3 py-2">
                Player index
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
          Archived snapshot of the closing Kalshi, DataGolf, and sportsbook prices captured when the tournament settled. For methodology see <Link href="/about/methodology" className="text-emerald-400 hover:underline">/about/methodology</Link>.
        </p>
      </main>
    </div>
  );
}
