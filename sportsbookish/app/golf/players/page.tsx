import Link from "next/link";
import type { Metadata } from "next";
import { fetchGolfers } from "@/lib/golf-data";
import { golfPlayerUrl } from "@/lib/slug";
import { JsonLd, breadcrumbLd } from "@/lib/seo";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "PGA Tour golfers — Kalshi odds for every player",
  description: "Browse every PGA Tour golfer with live Kalshi odds — win, top 5/10/20, make cut, head-to-head matchups. Sorted by OWGR world ranking.",
  alternates: { canonical: `${SITE_URL}/golf/players` },
};

export default async function GolferIndexPage() {
  const players = await fetchGolfers();

  // Split: top-100 OWGR get prominent grid, rest in alphabetical list
  const top = players.filter((p) => p.owgr_rank != null && p.owgr_rank <= 100);
  const rest = players.filter((p) => p.owgr_rank == null || p.owgr_rank > 100);

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: "/" },
        { name: "Golf", url: "/golf" },
        { name: "Players", url: "/golf/players" },
      ])} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4">
          <Link href="/golf" className="text-sm text-muted-foreground hover:text-foreground/80">← Golf</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span>⛳</span>
            <span>PGA Tour players</span>
          </div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[1400px] px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">PGA Tour golfers</h1>
          <p className="text-sm text-muted-foreground">
            Every golfer with active Kalshi markets. {players.length} {players.length === 1 ? "player" : "players"} indexed, sorted by OWGR world ranking.
          </p>
        </div>

        {top.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Top 100 OWGR ({top.length})</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {top.map((p) => (
                <Link key={p.id} href={golfPlayerUrl(p.slug)} className="rounded border border-border bg-card/50 px-3 py-2 text-sm hover:border-emerald-500/40 hover:bg-card transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{p.name}</span>
                    {p.owgr_rank && <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[9px] shrink-0">#{p.owgr_rank}</Badge>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {rest.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Other tour pros ({rest.length})</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {rest.map((p) => (
                <Link key={p.id} href={golfPlayerUrl(p.slug)} className="rounded border border-border bg-card/50 px-3 py-2 text-sm hover:border-emerald-500/40 hover:bg-card transition-colors">
                  <div className="font-medium truncate">{p.name}</div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
