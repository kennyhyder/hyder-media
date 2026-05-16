import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchTournaments } from "@/lib/golf-data";
import { JsonLd, breadcrumbLd, itemListLd } from "@/lib/seo";
import { Card, CardContent } from "@/components/ui/card";
import { tournamentUrl } from "@/lib/slug";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  const title = `PGA Tour ${year} archive — Kalshi vs Polymarket vs sportsbook odds`;
  const description = `Every PGA Tour tournament from ${year} with Kalshi outright winner odds, Polymarket comparison, and US sportsbook consensus. Browse all majors and regular events.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/golf/${year}` },
    openGraph: { title, description, url: `${SITE_URL}/golf/${year}`, type: "website", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function GolfYearIndexPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearStr } = await params;
  const year = parseInt(yearStr, 10);
  if (!Number.isFinite(year) || year < 2024 || year > 2099) notFound();

  const all = await fetchTournaments();
  const tournaments = all.filter((t) => {
    if (t.season_year != null) return t.season_year === year;
    if (t.start_date) return new Date(t.start_date).getUTCFullYear() === year;
    return false;
  });

  const majors = tournaments.filter((t) => t.is_major);
  const regular = tournaments.filter((t) => !t.is_major);

  const itemList = tournaments
    .filter((t) => t.slug)
    .map((t) => ({ name: t.name, url: tournamentUrl(year, t.slug!) }));

  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Golf", url: "/golf" },
          { name: String(year), url: `/golf/${year}` },
        ]),
        itemListLd(`PGA Tour ${year} tournaments`, itemList),
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/golf" className="text-sm text-muted-foreground hover:text-foreground">← Golf</Link>
          <div className="font-semibold text-sm">PGA Tour · {year}</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">PGA Tour {year} archive</h1>
        <p className="text-muted-foreground mb-8 max-w-3xl">
          {tournaments.length} {tournaments.length === 1 ? "tournament" : "tournaments"} in {year} · {majors.length} {majors.length === 1 ? "major" : "majors"}.
        </p>

        {tournaments.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No tournaments recorded for {year} yet.</p>
              <Link href="/golf" className="mt-4 inline-block text-sm text-emerald-400 hover:underline">
                ← See current tournaments
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {majors.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-3">Majors ({majors.length})</h2>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {majors.map((t) => (
                    <TournamentRow key={t.id} t={t} year={year} highlight />
                  ))}
                </ul>
              </section>
            )}
            {regular.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-3">Other events ({regular.length})</h2>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {regular
                    .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""))
                    .map((t) => (
                      <TournamentRow key={t.id} t={t} year={year} />
                    ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function TournamentRow({ t, year, highlight }: { t: { id: string; name: string; slug: string | null; start_date: string | null; status: string }; year: number; highlight?: boolean }) {
  const href = t.slug ? tournamentUrl(year, t.slug) : `/golfodds/?tournament=${t.id}`;
  const dateStr = t.start_date ? new Date(t.start_date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  return (
    <li>
      <Link
        href={href}
        className={`block rounded border px-3 py-2 transition-colors ${highlight ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60" : "border-border/60 bg-card/40 hover:border-emerald-500/40"}`}
      >
        <div className="font-medium text-sm">{t.name}</div>
        {dateStr && <div className="text-xs text-muted-foreground mt-0.5">{dateStr} · {t.status}</div>}
      </Link>
    </li>
  );
}
