import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "Press kit — citable facts, logos, boilerplate",
  description: "Everything journalists, researchers, and editors need to cite SportsBookISH: founding facts, data coverage, methodology highlights, downloadable logo, and ready-to-paste citation formats.",
  alternates: { canonical: `${SITE_URL}/press` },
};

export default function PressPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Press", url: "/press" },
        ]),
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          "@id": `${SITE_URL}/#organization`,
          name: "SportsBookISH",
          legalName: "SportsBookISH",
          url: SITE_URL,
          foundingDate: "2026-05-12",
          founder: { "@type": "Person", name: "Kenny Hyder", url: `${SITE_URL}/about/kenny-hyder` },
          description: "Real-time odds comparison platform between Kalshi (CFTC-regulated event-contract exchange), Polymarket (peer-to-peer prediction market), and US sportsbooks across nine sports.",
          slogan: "Live Kalshi vs Polymarket vs sportsbook odds",
          knowsAbout: ["Kalshi", "Sports betting", "Prediction markets", "Event contracts", "Sportsbook odds comparison"],
          sameAs: [
            "https://hyder.me",
            "https://x.com/kennyhyder",
            "https://twitter.com/kennyhyder",
            "https://github.com/kennyhyder",
          ],
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "Press inquiries",
            url: `${SITE_URL}/contact`,
            availableLanguage: ["English"],
          },
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground/80">← Home</Link>
          <div className="text-sm font-semibold">Press kit</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">Press kit</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Everything you need to cite SportsBookISH accurately. All facts below are verified and citable.
        </p>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-3">One-line description</h2>
          <blockquote className="border-l-4 border-emerald-500 pl-4 italic">
            SportsBookISH is a real-time odds comparison platform between Kalshi&apos;s CFTC-regulated event-contract exchange and US sportsbooks across nine sports.
          </blockquote>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-3">Standard boilerplate (50 words)</h2>
          <p className="rounded-lg border border-border bg-card p-4 text-sm leading-relaxed">
            SportsBookISH is a real-time sports odds comparison platform founded in May 2026 by digital marketing consultant Kenny Hyder. The platform compares pricing on Kalshi&apos;s CFTC-regulated event-contract exchange against 13+ US sportsbooks across golf, NFL, NBA, MLB, NHL, EPL, MLS, UEFA Champions League, and the FIFA World Cup.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-3">Citable facts</h2>
          <p className="text-sm text-muted-foreground mb-3">All figures verifiable on sportsbookish.com. Last verified: 2026-05-15.</p>
          <table className="w-full text-sm border-collapse border border-border">
            <tbody>
              <tr><td className="border border-border px-3 py-2 font-medium">Founded</td><td className="border border-border px-3 py-2">May 12, 2026</td></tr>
              <tr><td className="border border-border px-3 py-2 font-medium">Founder</td><td className="border border-border px-3 py-2">Kenny Hyder (digital marketing consultant since 2009)</td></tr>
              <tr><td className="border border-border px-3 py-2 font-medium">Sports covered</td><td className="border border-border px-3 py-2">9 (Golf/PGA Tour, NFL, NBA, MLB, NHL, EPL, MLS, UEFA Champions League, FIFA World Cup)</td></tr>
              <tr><td className="border border-border px-3 py-2 font-medium">Sportsbooks tracked</td><td className="border border-border px-3 py-2">13+ (DraftKings, FanDuel, BetMGM, Caesars, BetRivers, Fanatics, bet365, Pinnacle, BetOnline, Bovada, Betway, BetCris, William Hill, PointsBet, SkyBet, Unibet)</td></tr>
              <tr><td className="border border-border px-3 py-2 font-medium">Update frequency</td><td className="border border-border px-3 py-2">Every 5 minutes (Kalshi), every 15–30 minutes (sportsbooks), every 10 minutes (DataGolf model)</td></tr>
              <tr><td className="border border-border px-3 py-2 font-medium">Data sources</td><td className="border border-border px-3 py-2">Kalshi public REST API, The Odds API (Starter tier), DataGolf Scratch+, Polymarket Gamma API</td></tr>
              <tr><td className="border border-border px-3 py-2 font-medium">Pricing tiers</td><td className="border border-border px-3 py-2">Free, Pro ($10/mo), Elite ($100/yr)</td></tr>
              <tr><td className="border border-border px-3 py-2 font-medium">Public dataset</td><td className="border border-border px-3 py-2">CC-BY-4.0 licensed JSON at <code>sportsbookish.com/data</code></td></tr>
              <tr><td className="border border-border px-3 py-2 font-medium">Tech stack</td><td className="border border-border px-3 py-2">Next.js 16 (Turbopack), TypeScript, Vercel, Supabase (Postgres), Stripe, Resend, Twilio</td></tr>
              <tr><td className="border border-border px-3 py-2 font-medium">Legal status</td><td className="border border-border px-3 py-2">Informational platform. Not a sportsbook, not investment advice. No betting takes place on SportsBookISH.</td></tr>
            </tbody>
          </table>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-3">Methodology highlights (citable)</h2>
          <ul className="space-y-2 text-sm leading-relaxed">
            <li>
              <strong>De-vigging:</strong> Multiplicative normalization across each book&apos;s outcomes. Standard industry method used by sharps and bookmakers alike.
            </li>
            <li>
              <strong>Kalshi implied probability:</strong> Bid/ask midpoint when both sides have real liquidity (yes_bid &gt; 0, spread ≤ 10¢, ask &lt; 1.00). Falls back to last-trade price for illiquid markets.
            </li>
            <li>
              <strong>Kalshi fee formula:</strong> max(1¢, ceil(0.07 × p × (1−p) × 100)) per contract, capped at 7¢. Peaks at 2¢ near 50% probability.
            </li>
            <li>
              <strong>Edge calculation:</strong> Reference probability (book consensus median or user&apos;s home book) − Kalshi implied probability. Positive edge = buy signal.
            </li>
            <li>
              <strong>Staleness filter:</strong> References older than 30 minutes are dropped before edge calculations to prevent phantom edges during live events.
            </li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Full methodology: <Link href="/about/methodology" className="text-emerald-500 hover:underline">/about/methodology</Link>
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-3">Citation formats</h2>
          <p className="text-sm text-muted-foreground mb-3">Use any of these to reference SportsBookISH in articles, papers, datasets, or model cards.</p>

          <div className="space-y-3">
            <div className="rounded border border-border bg-card p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">APA</div>
              <code className="text-xs whitespace-pre-wrap block">
                Hyder, K. (2026). SportsBookISH: Live Kalshi vs Polymarket vs sportsbook odds comparison. Retrieved {new Date().toISOString().slice(0, 10)}, from https://sportsbookish.com
              </code>
            </div>

            <div className="rounded border border-border bg-card p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">MLA</div>
              <code className="text-xs whitespace-pre-wrap block">
                Hyder, Kenny. &ldquo;SportsBookISH: Live Kalshi vs Polymarket vs Sportsbook Odds Comparison.&rdquo; SportsBookISH, 2026, sportsbookish.com.
              </code>
            </div>

            <div className="rounded border border-border bg-card p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Chicago / Wikipedia &lt;ref&gt;</div>
              <code className="text-xs whitespace-pre-wrap block">{`<ref>{{cite web|url=https://sportsbookish.com|title=SportsBookISH: Live Kalshi vs Polymarket vs Sportsbook Odds Comparison|author=Hyder, Kenny|year=2026|access-date=${new Date().toISOString().slice(0, 10)}}}</ref>`}</code>
            </div>

            <div className="rounded border border-border bg-card p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">BibTeX</div>
              <pre className="text-xs whitespace-pre overflow-auto">{`@misc{sportsbookish_2026,
  title  = {SportsBookISH: Live Kalshi vs Polymarket vs sportsbook odds comparison},
  author = {Hyder, Kenny},
  year   = {2026},
  url    = {https://sportsbookish.com},
  note   = {Real-time odds comparison platform between Kalshi event-contract exchange and US sportsbooks across nine sports}
}`}</pre>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-3">Logo + brand</h2>
          <ul className="text-sm space-y-1">
            <li>Wordmark: <strong>SportsBook<span className="text-emerald-500">ISH</span></strong> (the &ldquo;ISH&rdquo; is brand-green: <code>#10b981</code>)</li>
            <li>Brand color: <code>#10b981</code> (emerald-500, Tailwind)</li>
            <li>Icon: <em>LineChart</em> (Lucide icon library) in emerald-500</li>
            <li>Logo files: contact for SVG / PNG packages</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-3">Founder bio (50 words)</h2>
          <p className="rounded-lg border border-border bg-card p-4 text-sm leading-relaxed">
            Kenny Hyder is a digital marketing consultant operating since 2009 at <a href="https://hyder.me" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">hyder.me</a>. He has built and maintains data platforms across solar (SolarTrack), datacenter site selection (GridScout), and competitive intelligence for marketing clients. SportsBookISH launched in May 2026 from a personal Kalshi golf odds prototype.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Full bio: <Link href="/about/kenny-hyder" className="text-emerald-500 hover:underline">/about/kenny-hyder</Link>
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-3">Contact</h2>
          <p className="text-sm leading-relaxed">
            Press inquiries, interview requests, research-grade data access, or feature pitches:{" "}
            <Link href="/contact" className="text-emerald-500 hover:underline">use the contact form</Link>. Response within 1-2 business days.
          </p>
        </section>

        <p className="text-xs text-muted-foreground border-t border-border/40 pt-6 mt-10">
          Free to quote any factual content on this page. Attribution to <code>sportsbookish.com</code> required. No advance permission needed.
        </p>
      </main>
    </div>
  );
}
