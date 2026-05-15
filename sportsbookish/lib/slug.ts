// URL-safe slug helper. Mirrors the sb_slugify() Postgres function + the
// slugify() helper in api/sports/_lib.js so backfill, cron writes, and
// client-side URL generation all produce identical slugs.

export function slugify(s: string | null | undefined): string | null {
  if (!s) return null;
  const out = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return out || null;
}

// Derive a canonical event URL from its parts.
export function eventUrl(league: string, year: number, slug: string): string {
  return `/sports/${league}/${year}/${slug}`;
}

export function tournamentUrl(year: number, slug: string): string {
  return `/golf/${year}/${slug}`;
}

export function teamUrl(league: string, slug: string): string {
  return `/sports/${league}/teams/${slug}`;
}

export function playerUrl(league: string, slug: string): string {
  return `/sports/${league}/players/${slug}`;
}

export function golfPlayerUrl(slug: string): string {
  return `/golf/players/${slug}`;
}
