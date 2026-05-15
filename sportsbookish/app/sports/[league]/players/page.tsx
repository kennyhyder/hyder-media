import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchTeams, fetchLeagues } from "@/lib/sports-data";
import { playerUrl } from "@/lib/slug";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

export const dynamic = "force-dynamic";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: { params: Promise<{ league: string }> }): Promise<Metadata> {
  const { league } = await params;
  const meta = (await fetchLeagues()).find((l) => l.key === league);
  if (!meta) return { title: "Players" };
  const title = `${meta.display_name} players — Kalshi MVP & award odds`;
  const description = `Browse all ${meta.display_name} players with live Kalshi odds — MVP, awards, season win totals, championship futures. Compared against DraftKings, FanDuel, BetMGM and 8+ sportsbooks.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/sports/${league}/players` },
  };
}

export default async function PlayerIndexPage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  const [leagues, players] = await Promise.all([fetchLeagues(), fetchTeams(league, "player")]);
  const meta = leagues.find((l) => l.key === league);
  if (!meta) notFound();

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: "/" },
        { name: "Sports", url: "/sports" },
        { name: meta.display_name, url: `/sports/${league}` },
        { name: "Players", url: `/sports/${league}/players` },
      ])} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4">
          <Link href={`/sports/${league}`} className="text-sm text-muted-foreground hover:text-foreground/80">← {meta.display_name}</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span className="text-base">{meta.icon}</span>
            <span>{meta.display_name} players</span>
          </div>
          <Link href={`/sports/${league}/teams`} className="text-xs text-emerald-500 hover:underline">Teams →</Link>
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[1400px] px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">{meta.display_name} players</h1>
          <p className="text-sm text-muted-foreground">
            Every {meta.display_name} player with active Kalshi futures, MVP, or award markets. {players.length} {players.length === 1 ? "player" : "players"} indexed.
          </p>
        </div>

        {players.length === 0 ? (
          <div className="text-center text-muted-foreground py-16">No {meta.display_name} players with active markets right now.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {players.map((p) => (
              <Link key={p.id} href={playerUrl(p.league, p.slug)} className="rounded border border-border bg-card/50 px-3 py-2 text-sm hover:border-emerald-500/40 hover:bg-card transition-colors">
                <div className="font-medium">{p.name}</div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
