import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JsonLd, breadcrumbLd } from "@/lib/seo";
import { LastUpdated } from "@/components/LastUpdated";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const TITLE = "Research — How Kalshi & Sportsbook Markets Actually Move | SportsBookISH";
const DESC = "Structural analysis of event-contract pricing, sportsbook line movement, settlement risk premium, and ladder-rung volume distribution. From the SportsBookISH dataset — 100M+ quotes across 14 books since May 2026.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/research` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/research`, siteName: "SportsBookISH", type: "website" },
};

interface Piece {
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  read_time: string;
  published: string;
}

const PIECES: Piece[] = [
  {
    slug: "why-mid-game-kalshi-lines-lag",
    title: "Why mid-game Kalshi lines lag sportsbook consensus",
    subtitle: "Settlement risk premium, leverage exit, and the structural reasons exchange prices drift behind books once a game is in progress.",
    category: "Market microstructure",
    read_time: "8 min",
    published: "2026-06-01",
  },
  {
    slug: "how-sportsbooks-reprice-without-news",
    title: "How sportsbooks reprice without news — a taxonomy of line moves",
    subtitle: "Sharp action, book exposure rebalancing, public sentiment lean, and originator-vs-follower lag. Every line move is one of six things.",
    category: "Market microstructure",
    read_time: "10 min",
    published: "2026-06-01",
  },
  {
    slug: "volume-concentration-event-contract-ladders",
    title: "Volume concentration in event-contract ladders",
    subtitle: "Why the 80+ wins rung trades 1,000× more than the 75+ rung — and why pricing the adjacent thresholds off the same volume is statistically noise.",
    category: "Market microstructure",
    read_time: "7 min",
    published: "2026-06-01",
  },
];

export default function ResearchHub() {
  const renderTime = new Date().toISOString();
  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Research", url: `${SITE_URL}/research` },
      ])} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
          <div className="font-semibold text-sm">Research</div>
          <LastUpdated iso={renderTime} variant="header" />
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-10 space-y-10">
        <section>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">Research</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl">
            Long-form analysis of how Kalshi event-contract markets actually move, and how that
            compares to traditional sportsbook pricing. Drawn from the SportsBookISH dataset —
            every quote on every market across 14 regulated US books and Kalshi/Polymarket
            since May 2026.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {PIECES.map((p) => (
            <Link key={p.slug} href={`/research/${p.slug}`} className="block">
              <Card className="hover:border-emerald-500/40 transition-colors h-full">
                <CardHeader>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <Badge variant="outline">{p.category}</Badge>
                    <span>·</span>
                    <span>{p.read_time}</span>
                    <span>·</span>
                    <span>{p.published}</span>
                  </div>
                  <CardTitle className="text-xl leading-tight">{p.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{p.subtitle}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>

        <section className="border-t border-border/40 pt-8">
          <h2 className="text-xl font-bold mb-3">Open data</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Every analysis here is derived from the public SportsBookISH dataset on Hugging Face.
            CC-BY 4.0 — cite us, reuse freely.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <a href="https://huggingface.co/datasets/kennyhyder/sportsbookish-daily-odds" target="_blank" rel="noopener" className="text-emerald-400 hover:underline">
              Hugging Face dataset →
            </a>
            <Link href="/data" className="text-emerald-400 hover:underline">Data exports →</Link>
            <Link href="/api/docs" className="text-emerald-400 hover:underline">Public REST API →</Link>
          </div>
        </section>

        <section className="border-t border-border/40 pt-8">
          <h2 className="text-xl font-bold mb-3">Methodology</h2>
          <p className="text-sm text-muted-foreground">
            Devigging is per-book (multiplicative). Kalshi prices use the bid/ask midpoint when
            both sides have non-zero liquidity, falling back to last-trade when the spread is wider
            than 4¢. Quote freshness window is 30 minutes — quotes older than that are excluded
            from medians. Detailed methodology, including the exact lens taxonomy used in the
            tweet composer, lives in the operations notes for each piece.
          </p>
        </section>
      </main>
    </div>
  );
}
