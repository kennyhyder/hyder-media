import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const TITLE = "Embed live Kalshi vs sportsbook odds | SportsBookISH";
const DESC = "Embed live event-contract vs sportsbook odds widgets on your blog, newsletter, or affiliate site. Free, branded, and refreshes automatically every page load. Sports betting affiliates welcome.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/embed` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/embed`, siteName: "SportsBookISH", type: "website" },
};

export default function EmbedHub() {
  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Embed widgets", url: `${SITE_URL}/embed` },
      ])} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
          <div className="font-semibold text-sm">Embed widgets</div>
          <div />
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-10 space-y-10">
        <section>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">Free embeddable widgets</h1>
          <p className="text-muted-foreground mt-3 max-w-3xl">
            Drop live Kalshi-vs-sportsbook odds into any page. Free, branded, no API key
            required. Refreshes on every page load. Great for sports-betting newsletters,
            affiliate sites, fantasy blogs, and team-specific fan pages.
          </p>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>1. Today&apos;s Biggest Edges</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Top 10 positive-EV opportunities across every active league, ranked by edge.
                Refreshes every page load. ~600 × 500 px works in most blog layouts.
              </p>
              <div className="rounded border border-border/60 overflow-hidden bg-black/40">
                <iframe
                  src="/embed/biggest-edges"
                  width="100%"
                  height="500"
                  frameBorder="0"
                  title="Today's biggest sports betting edges"
                  loading="lazy"
                  style={{ display: "block", border: 0 }}
                />
              </div>
              <details>
                <summary className="text-sm cursor-pointer text-emerald-400 hover:underline">Embed code →</summary>
                <pre className="mt-2 p-3 rounded bg-muted/40 text-xs overflow-x-auto"><code>{`<iframe
  src="https://sportsbookish.com/embed/biggest-edges"
  width="600"
  height="500"
  frameborder="0"
  title="Today's biggest sports betting edges"
  loading="lazy"
></iframe>`}</code></pre>
              </details>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>2. Single-Event Live Odds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Live odds comparison for a specific event. Use the event ID from a SportsBookISH
                event page URL. Useful for matchup previews and game-specific affiliate content.
              </p>
              <pre className="p-3 rounded bg-muted/40 text-xs overflow-x-auto"><code>{`<iframe
  src="https://sportsbookish.com/embed/event/<EVENT_ID>"
  width="600"
  height="500"
  frameborder="0"
  title="Live Kalshi vs sportsbook odds"
  loading="lazy"
></iframe>`}</code></pre>
              <p className="text-xs text-muted-foreground">
                Find event IDs at <a href="/sports" className="text-emerald-400 hover:underline">sportsbookish.com/sports</a> — click into any event and grab the ID from the URL.
              </p>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>License + attribution</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <p>
                Embeds are free and unlimited. The widget header links back to sportsbookish.com
                so the brand attribution is automatic. No tracking pixels, no popups, no scripts
                touch your page — the iframe is fully self-contained.
              </p>
              <p>
                The underlying data is licensed CC-BY 4.0 — see <Link href="/data" className="text-emerald-400 hover:underline">/data</Link> for the open Hugging Face dataset and exports.
              </p>
              <p className="text-muted-foreground">
                Affiliate programs covered: DraftKings, FanDuel, BetMGM, Caesars, BetRivers,
                Fanatics, Circa. Offshore brands are aggregated as &quot;Other&quot; in the
                widget (regulated-affiliate compliance).
              </p>
              <p className="text-muted-foreground">
                Questions or large-scale embed needs (newsletter integration, custom theming,
                white-label)? Email <a href="mailto:kenny@hyder.me" className="text-emerald-400 hover:underline">kenny@hyder.me</a>.
              </p>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
