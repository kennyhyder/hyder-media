import Link from "next/link";
import type { Metadata } from "next";
import { GLOSSARY } from "@/lib/glossary";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "Sports betting glossary — Kalshi, no-vig, edge, CLV explained",
  description: "Plain-English definitions for every sports-betting and prediction-market term: vig, no-vig, edge, expected value, Kelly criterion, CLV, sharp vs square, and 15+ more.",
  alternates: { canonical: `${SITE_URL}/learn/glossary` },
};

export default function GlossaryIndex() {
  // Group entries A-Z
  const byLetter = new Map<string, typeof GLOSSARY>();
  for (const e of GLOSSARY) {
    const L = e.title[0].toUpperCase();
    if (!byLetter.has(L)) byLetter.set(L, []);
    byLetter.get(L)!.push(e);
  }
  const letters = Array.from(byLetter.keys()).sort();

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: "/" },
        { name: "Learn", url: "/learn" },
        { name: "Glossary", url: "/learn/glossary" },
      ])} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4">
          <Link href="/learn" className="text-sm text-muted-foreground hover:text-foreground/80">← Learn</Link>
          <div className="text-sm font-semibold">Glossary</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[1200px] px-4 py-10">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Sports betting glossary</h1>
          <p className="text-muted-foreground">
            Plain-English definitions for every term that shows up across SportsBookISH — Kalshi pricing, no-vig math,
            expected value, closing line value, and more. {GLOSSARY.length} entries.
          </p>
        </div>

        {/* A-Z jump nav */}
        <div className="flex flex-wrap gap-1 mb-8 border-b border-border/40 pb-4">
          {letters.map((L) => (
            <a key={L} href={`#${L}`} className="rounded border border-border/60 bg-card/40 px-2 py-1 text-xs font-mono hover:border-emerald-500/40">{L}</a>
          ))}
        </div>

        <div className="space-y-8">
          {letters.map((L) => (
            <section key={L} id={L}>
              <h2 className="text-2xl font-bold mb-3 border-b border-border/40 pb-2">{L}</h2>
              <ul className="space-y-3">
                {byLetter.get(L)!.map((e) => (
                  <li key={e.slug}>
                    <Link href={`/learn/glossary/${e.slug}`} className="text-emerald-500 hover:underline font-semibold">
                      {e.title}
                    </Link>
                    {e.also_known_as && e.also_known_as.length > 0 && (
                      <span className="text-xs text-muted-foreground ml-2">(also: {e.also_known_as.join(", ")})</span>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">{e.short}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
