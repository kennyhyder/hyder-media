// Read path for SEO page overrides (gc_page_overrides).
//
// The autonomous SEO loop writes overlay title/description/JSON-LD keyed by URL
// path. Entity page templates call getPageOverride(path) inside generateMetadata
// and merge the result on top of the canonical metadata.
//
// Fail-soft: missing table / unconfigured / any error → null (canonical wins).
// Cached (revalidate) so it runs inside ISR/static entity pages without forcing
// them dynamic.

import "server-only";

import { gcRead } from "@/lib/auth";

export interface PageOverride {
  page: string;
  title: string | null;
  description: string | null;
  extra_jsonld: unknown | null;
  source: string | null;
}

/** Normalize a path: strip origin, querystring/hash, trailing slash (except root). */
export function normalizePath(input: string): string {
  let path = input;
  try {
    path = new URL(input).pathname;
  } catch {
    // already a path — drop any query/hash
    path = input.split("?")[0].split("#")[0];
  }
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  return path || "/";
}

/**
 * Fetch the active override for a URL path, or null. Cached (revalidate window
 * matches entity-page revalidate by default) and graceful on any failure.
 */
export async function getPageOverride(
  path: string,
  revalidate = 3600,
): Promise<PageOverride | null> {
  const page = normalizePath(path);
  const rows = await gcRead<PageOverride>(
    "gc_page_overrides",
    {
      page: `eq.${page}`,
      select: "page,title,description,extra_jsonld,source",
      limit: "1",
    },
    revalidate,
  );
  return rows[0] ?? null;
}

/**
 * Merge an override onto base metadata fields. Only non-empty override values
 * win; everything else falls through to the canonical value.
 */
export function applyOverride<
  T extends { title?: string | null; description?: string | null },
>(base: T, override: PageOverride | null): T {
  if (!override) return base;
  return {
    ...base,
    ...(override.title ? { title: override.title } : {}),
    ...(override.description ? { description: override.description } : {}),
  };
}
