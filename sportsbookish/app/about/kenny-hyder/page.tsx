import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "Kenny Hyder — founder of SportsBookISH",
  description: "Kenny Hyder is a digital marketing consultant (since 2009) and founder of SportsBookISH. Background, methodology, and contact.",
  alternates: { canonical: `${SITE_URL}/about/kenny-hyder` },
};

export default function AuthorPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "About", url: "/about/kenny-hyder" },
        ]),
        {
          "@context": "https://schema.org",
          "@type": "Person",
          name: "Kenny Hyder",
          url: `${SITE_URL}/about/kenny-hyder`,
          image: "https://hyder.me/assets/imgs/kenny-hyder.jpg",
          jobTitle: "Founder, SportsBookISH",
          worksFor: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
          sameAs: ["https://hyder.me", "https://twitter.com/kennyhyder", "https://x.com/kennyhyder"],
          description: "Digital marketing consultant (since 2009) and founder of SportsBookISH, a Kalshi vs Polymarket vs sportsbook odds comparison platform.",
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground/80">← Home</Link>
          <div className="text-sm font-semibold">About</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">Kenny Hyder</h1>
        <p className="text-lg text-muted-foreground mb-6">Founder, SportsBookISH · Digital marketing consultant since 2009</p>

        <div className="prose prose-invert max-w-none">
          <h2 className="text-2xl font-bold mt-4">Background</h2>
          <p>
            I&apos;ve worked in digital marketing since 2009. My consulting practice <a href="https://hyder.me" className="text-emerald-500 hover:underline" target="_blank" rel="noopener noreferrer">hyder.me</a> covers PPC strategy, attribution, conversion optimization, and analytics for clients in finance, ecommerce, B2B SaaS, fitness, automotive, and education.
          </p>
          <p>
            Outside client work I build data tools — solar installation databases (<a href="https://hyder.me/solar" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">SolarTrack</a>), datacenter site-selection scoring (<a href="https://hyder.me/grid" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">GridScout</a>), and competitive-intel platforms for ad clients. SportsBookISH started as a personal project comparing Kalshi golf odds to sportsbooks in early 2026 and grew into a full multi-sport platform.
          </p>

          <h2 className="text-2xl font-bold mt-6">What SportsBookISH is</h2>
          <p>
            SportsBookISH is a real-time odds comparison platform that surfaces pricing edges between{" "}
            <a href="https://kalshi.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">Kalshi</a> (the CFTC-regulated event-contract exchange) and US sportsbooks — DraftKings, FanDuel, BetMGM, Caesars, BetRivers, Fanatics, and 8+ others — across golf, NFL, NBA, MLB, NHL, EPL, MLS, UCL, and the World Cup.
          </p>
          <p>
            The platform ingests Kalshi via their public REST API every 5 minutes, sportsbook lines via <a href="https://the-odds-api.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">The Odds API</a> every 15-30 minutes, golf modeling from{" "}
            <a href="https://datagolf.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">DataGolf Scratch+</a>, and Polymarket comparison via their Gamma API. All data is de-vigged before edge calculations.
          </p>

          <h2 className="text-2xl font-bold mt-6">Methodology</h2>
          <p>
            For full math + sources, see the <Link href="/about/methodology" className="text-emerald-500 hover:underline">methodology page</Link>. Short version:
          </p>
          <ul>
            <li>Kalshi implied probability comes from bid/ask midpoint when both sides have real liquidity; otherwise last-trade price.</li>
            <li>Sportsbook prices are de-vigged via multiplicative normalization (the industry standard).</li>
            <li>Edges are reference probability minus Kalshi implied probability. Positive = Kalshi cheaper than reference (buy signal).</li>
            <li>For Elite subscribers, edges are reported net of Kalshi&apos;s per-contract trading fee.</li>
            <li>Stale references (&gt;30 minutes) are filtered out so the live tables never compare against expired numbers.</li>
          </ul>

          <h2 className="text-2xl font-bold mt-6">Contact</h2>
          <p>
            Use the <Link href="/contact" className="text-emerald-500 hover:underline">contact form</Link> to send a message.<br />
            Twitter/X: <a href="https://x.com/kennyhyder" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">@kennyhyder</a><br />
            Personal site: <a href="https://hyder.me" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">hyder.me</a>
          </p>

          <p className="text-xs text-muted-foreground border-t border-border/40 pt-4 mt-8">
            SportsBookISH is an informational platform. Nothing here is investment advice or legal advice. All betting carries risk of loss. Please bet responsibly.
          </p>
        </div>
      </main>
    </div>
  );
}
