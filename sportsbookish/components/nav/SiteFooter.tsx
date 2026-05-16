import Link from "next/link";
import { LineChart } from "lucide-react";

// Sitewide footer. Renders on every page via app/layout.tsx. Functions as:
//   - Discovery for our deep-linked utility pages (tools, glossary, dataset)
//   - E-E-A-T signal (every page exposes author + methodology link)
//   - Internal-link graph hub — every page links back to every key landing
//
// Keep sections short. Each link should be specific (not "Resources") so
// users (and crawlers) understand the destination before clicking.

const SECTIONS = [
  {
    heading: "Sports",
    links: [
      { label: "All sports", href: "/sports" },
      { label: "NFL odds", href: "/sports/nfl" },
      { label: "NBA odds", href: "/sports/nba" },
      { label: "MLB odds", href: "/sports/mlb" },
      { label: "NHL odds", href: "/sports/nhl" },
      { label: "Premier League", href: "/sports/epl" },
      { label: "MLS", href: "/sports/mls" },
      { label: "Champions League", href: "/sports/ucl" },
      { label: "Golf", href: "/golf" },
    ],
  },
  {
    heading: "Free tools",
    links: [
      { label: "No-vig calculator", href: "/tools/no-vig-calculator" },
      { label: "Kelly criterion", href: "/tools/kelly-calculator" },
      { label: "Odds converter", href: "/tools/odds-converter" },
      { label: "Parlay calculator", href: "/tools/parlay-calculator" },
      { label: "All tools", href: "/tools" },
    ],
  },
  {
    heading: "Learn",
    links: [
      { label: "Glossary", href: "/learn/glossary" },
      { label: "What are Kalshi odds?", href: "/learn/what-are-kalshi-odds" },
      { label: "No-vig explained", href: "/learn/no-vig-explained" },
      { label: "Kalshi edge betting", href: "/learn/kalshi-edge-betting" },
      { label: "All articles", href: "/learn" },
    ],
  },
  {
    heading: "Compare books",
    links: [
      { label: "Kalshi vs Polymarket", href: "/compare/kalshi-vs-polymarket" },
      { label: "Kalshi vs DraftKings", href: "/compare/kalshi-vs-draftkings" },
      { label: "Kalshi vs FanDuel", href: "/compare/kalshi-vs-fanduel" },
      { label: "Kalshi vs BetMGM", href: "/compare/kalshi-vs-betmgm" },
      { label: "Kalshi vs Caesars", href: "/compare/kalshi-vs-caesars" },
      { label: "Kalshi vs BetRivers", href: "/compare/kalshi-vs-betrivers" },
      { label: "Kalshi vs Fanatics", href: "/compare/kalshi-vs-fanatics" },
    ],
  },
  {
    heading: "Site",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "Public dataset", href: "/data" },
      { label: "Press kit", href: "/press" },
      { label: "Methodology", href: "/about/methodology" },
      { label: "About", href: "/about/kenny-hyder" },
      { label: "Contact", href: "/contact" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-border/40 bg-card/30 mt-16">
      <div className="container mx-auto max-w-[1800px] px-4 py-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">
          {SECTIONS.map((section) => (
            <div key={section.heading}>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{section.heading}</h3>
              <ul className="space-y-1.5 text-sm">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-foreground/80 hover:text-emerald-500 transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-border/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            <span className="font-semibold">SportsBookISH</span>
            <span>· Live Kalshi vs sportsbook odds</span>
          </div>
          <div className="text-[11px]">
            For entertainment + information. Not investment or legal advice. Bet responsibly.
          </div>
        </div>
      </div>
    </footer>
  );
}
