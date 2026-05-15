import { redirect, notFound } from "next/navigation";
import TournamentView from "@/components/golf/TournamentView";
import { fetchTournamentSlugById } from "@/lib/golf-data";
import { tournamentUrl } from "@/lib/slug";

// Legacy route — preserved so old links (/golf/tournament?id=X) keep working,
// but 308-redirects to the canonical SEO-friendly /golf/{year}/{slug} URL.
// If a slug isn't yet backfilled for this tournament we fall back to inline
// render so the page never 404s on a missing slug.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function LegacyTournamentPage({ searchParams }: { searchParams: Promise<{ id?: string; mt?: string }> }) {
  const { id, mt = "win" } = await searchParams;
  if (!id) redirect("/golf");

  const slugRow = await fetchTournamentSlugById(id);
  if (slugRow) {
    const target = tournamentUrl(slugRow.season_year, slugRow.slug);
    const query = mt !== "win" ? `?mt=${encodeURIComponent(mt)}` : "";
    redirect(`${target}${query}`);
  }

  // Slug not yet backfilled — render in place. (Should be rare since the
  // backfill SQL slugged everything in golfodds_tournaments at deploy time.)
  if (!id) notFound();
  return (
    <TournamentView
      tournamentId={id}
      marketType={mt}
      canonicalPath={`/golf/tournament?id=${id}`}
    />
  );
}
