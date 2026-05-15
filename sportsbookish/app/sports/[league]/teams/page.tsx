import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchTeams, fetchLeagues } from "@/lib/sports-data";
import { teamUrl, playerUrl } from "@/lib/slug";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

export const dynamic = "force-dynamic";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: { params: Promise<{ league: string }> }): Promise<Metadata> {
  const { league } = await params;
  const meta = (await fetchLeagues()).find((l) => l.key === league);
  if (!meta) return { title: "Teams" };
  const title = `${meta.display_name} teams — Kalshi odds for every team`;
  const description = `Browse all ${meta.display_name} teams with live Kalshi odds across every market — game lines, championship futures, division winners, win totals.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/sports/${league}/teams` },
  };
}

export default async function TeamIndexPage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  const [leagues, teams] = await Promise.all([fetchLeagues(), fetchTeams(league, "team")]);
  const meta = leagues.find((l) => l.key === league);
  if (!meta) notFound();

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: "/" },
        { name: "Sports", url: "/sports" },
        { name: meta.display_name, url: `/sports/${league}` },
        { name: "Teams", url: `/sports/${league}/teams` },
      ])} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4">
          <Link href={`/sports/${league}`} className="text-sm text-muted-foreground hover:text-foreground/80">← {meta.display_name}</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span className="text-base">{meta.icon}</span>
            <span>{meta.display_name} teams</span>
          </div>
          <Link href={`/sports/${league}/players`} className="text-xs text-emerald-500 hover:underline">Players →</Link>
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[1400px] px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">{meta.display_name} teams</h1>
          <p className="text-sm text-muted-foreground">
            Every {meta.display_name} team with live Kalshi vs sportsbook odds. {teams.length} {teams.length === 1 ? "team" : "teams"} indexed.
          </p>
        </div>

        {teams.length === 0 ? (
          <div className="text-center text-muted-foreground py-16">No {meta.display_name} teams found.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {teams.map((t) => (
              <Link key={t.id} href={teamUrl(t.league, t.slug)} className="rounded border border-border bg-card/50 px-3 py-2 text-sm hover:border-emerald-500/40 hover:bg-card transition-colors">
                <div className="font-medium">{t.name}</div>
                {t.abbreviation && <div className="text-[10px] text-muted-foreground">{t.abbreviation}</div>}
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
