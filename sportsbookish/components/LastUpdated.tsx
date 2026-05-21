// Shared "Last updated" stamp + companion JSON-LD dateModified helper.
//
// SEO note: Google's "quality deserves freshness" principle (publicly stated
// since ~2011 and reinforced through every helpful-content update) rewards
// pages that signal recent updates *visibly* and via structured data. We
// hit both:
//   1) A visible <time> element with absolute + relative date for users
//      and crawlers reading rendered HTML
//   2) A separate JsonLdDateModified() helper that emits dateModified into
//      whichever Article/Dataset schema the page already uses
//
// The visible component is also wrapped in a <time datetime="…"> tag so
// search engines + screen readers see the canonical ISO timestamp.

import { JsonLd } from "@/lib/seo";

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now"; // future-dated clock skew
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)} days ago`;
  return new Date(iso).toLocaleDateString();
}

interface LastUpdatedProps {
  iso: string | null | undefined;
  variant?: "inline" | "header" | "footer";
  label?: string;  // default "Updated"
  className?: string;
}

/**
 * Visible freshness stamp. Use `header` variant in sticky page headers
 * (compact, right-aligned), `inline` for in-body usage (badge-shaped),
 * `footer` for end-of-page footer summary.
 */
export function LastUpdated({ iso, variant = "inline", label = "Updated", className = "" }: LastUpdatedProps) {
  if (!iso) {
    return (
      <span className={`text-xs text-muted-foreground/60 italic ${className}`}>
        {label}: pending first ingest
      </span>
    );
  }
  const absolute = new Date(iso).toUTCString();
  const rel = relativeTime(iso);

  if (variant === "header") {
    return (
      <time
        dateTime={iso}
        title={absolute}
        className={`text-xs text-muted-foreground tabular-nums ${className}`}
      >
        {label} {rel}
      </time>
    );
  }
  if (variant === "footer") {
    return (
      <p className={`text-xs text-muted-foreground ${className}`}>
        {label}{" "}
        <time dateTime={iso} title={absolute} className="tabular-nums">
          {rel}
        </time>{" "}
        <span className="text-muted-foreground/60">({new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })})</span>
      </p>
    );
  }
  // inline
  return (
    <time
      dateTime={iso}
      title={absolute}
      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-muted/40 border border-border/40 tabular-nums ${className}`}
    >
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground">{rel}</span>
    </time>
  );
}

/**
 * Emits a Dataset schema chunk with dateModified for any page that has
 * live-updated odds data. Drop into the JsonLd data array.
 *
 * `siteUrl` and `pageUrl` must be absolute to match the entity graph.
 */
export function datasetFreshnessLd(opts: {
  name: string;
  description: string;
  pageUrl: string;          // absolute URL
  dateModified: string;     // ISO
  variableMeasured?: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: opts.name,
    description: opts.description,
    url: opts.pageUrl,
    creator: { "@type": "Organization", name: "SportsBookISH" },
    dateModified: opts.dateModified,
    isAccessibleForFree: true,
    license: "https://creativecommons.org/licenses/by/4.0/",
    ...(opts.variableMeasured ? { variableMeasured: opts.variableMeasured } : {}),
  };
}

/**
 * Convenience wrapper that emits a hidden JSON-LD block with just the
 * Dataset + dateModified schema. Use on pages that don't already build a
 * full ldData array (e.g., quick patches to existing pages).
 */
export function DateModifiedLd(opts: {
  name: string;
  description: string;
  pageUrl: string;
  dateModified: string;
  variableMeasured?: string[];
}) {
  return <JsonLd data={datasetFreshnessLd(opts)} />;
}
