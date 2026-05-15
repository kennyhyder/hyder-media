import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { GLOSSARY, GLOSSARY_BY_SLUG } from "@/lib/glossary";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export function generateStaticParams() {
  return GLOSSARY.map((e) => ({ term: e.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ term: string }> }): Promise<Metadata> {
  const { term } = await params;
  const entry = GLOSSARY_BY_SLUG[term];
  if (!entry) return { title: "Term not found" };
  const canonical = `${SITE_URL}/learn/glossary/${term}`;
  const title = `${entry.title} — sports betting glossary`;
  return {
    title,
    description: entry.short,
    alternates: { canonical },
    openGraph: { title, description: entry.short, url: canonical, type: "article", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description: entry.short },
  };
}

export default async function GlossaryTermPage({ params }: { params: Promise<{ term: string }> }) {
  const { term } = await params;
  const entry = GLOSSARY_BY_SLUG[term];
  if (!entry) notFound();

  const ldData: object[] = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Learn", url: "/learn" },
      { name: "Glossary", url: "/learn/glossary" },
      { name: entry.title, url: `/learn/glossary/${term}` },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "DefinedTerm",
      name: entry.title,
      description: entry.short,
      inDefinedTermSet: { "@type": "DefinedTermSet", name: "SportsBookISH Glossary", url: `${SITE_URL}/learn/glossary` },
      url: `${SITE_URL}/learn/glossary/${term}`,
      ...(entry.also_known_as && entry.also_known_as.length > 0 ? { alternateName: entry.also_known_as } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: `${entry.title} — sports betting glossary`,
      description: entry.short,
      author: { "@type": "Person", name: "Kenny Hyder", url: "https://hyder.me" },
      datePublished: "2026-05-15",
      dateModified: "2026-05-15",
      mainEntityOfPage: `${SITE_URL}/learn/glossary/${term}`,
    },
  ];

  const related = (entry.related || [])
    .map((s) => GLOSSARY_BY_SLUG[s])
    .filter(Boolean);

  return (
    <div className="min-h-screen">
      <JsonLd data={ldData} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[900px] items-center justify-between px-4">
          <Link href="/learn/glossary" className="text-sm text-muted-foreground hover:text-foreground/80">← Glossary</Link>
          <div className="text-sm font-semibold truncate max-w-[60%]">{entry.title}</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[900px] px-4 py-10">
        <article>
          <h1 className="text-4xl font-bold mb-2">{entry.title}</h1>
          {entry.also_known_as && entry.also_known_as.length > 0 && (
            <p className="text-xs text-muted-foreground mb-3">
              Also known as: {entry.also_known_as.join(", ")}
            </p>
          )}
          <p className="text-lg text-foreground/80 mb-6 leading-relaxed">{entry.short}</p>

          <div className="prose prose-invert prose-sm max-w-none">
            {entry.body.split("\n\n").map((para, i) => (
              <p key={i} className="mb-4 text-foreground/90 leading-relaxed">{para}</p>
            ))}
          </div>

          {entry.example && (
            <div className="mt-8 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
              <div className="text-xs uppercase tracking-wider text-emerald-400 mb-2">Worked example</div>
              <p className="text-sm leading-relaxed">{entry.example}</p>
            </div>
          )}

          {related.length > 0 && (
            <div className="mt-8 border-t border-border/40 pt-6">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Related terms</h2>
              <div className="flex flex-wrap gap-2">
                {related.map((r) => (
                  <Link key={r.slug} href={`/learn/glossary/${r.slug}`} className="rounded border border-border bg-card/50 px-3 py-1.5 text-sm hover:border-emerald-500/40 hover:bg-card transition-colors">
                    {r.title}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-10 text-xs text-muted-foreground border-t border-border/40 pt-4">
            <p>
              By <Link href="/about/kenny-hyder" className="text-emerald-500 hover:underline">Kenny Hyder</Link> · SportsBookISH glossary
            </p>
            <p className="mt-1">
              Browse the full <Link href="/learn/glossary" className="text-emerald-500 hover:underline">sports betting glossary</Link>
              {" "}or explore <Link href="/learn" className="text-emerald-500 hover:underline">all learn articles</Link>.
            </p>
          </div>
        </article>
      </main>
    </div>
  );
}
