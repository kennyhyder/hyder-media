import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { isAdminRequest } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import DistributeDraftsClient from "@/components/admin/DistributeDraftsClient";
import { fetchMovements } from "@/lib/movements-data";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ShareableMovement {
  kind: "movement";
  league: string;
  event_title: string;
  contestant: string;
  delta_pct: number;
  prob_now: number;
  url: string;
}

// Admin-only "social drafts" page. Generates pre-written copy for share-worthy
// market events (big moves, biggest edges) ready to copy-paste to X / Bluesky
// / Threads / Reddit. Manual approval gate — we never auto-post; user reviews
// and clicks copy before posting from their own accounts.

export default async function DistributePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/distribute");
  if (!(await isAdminRequest())) notFound();

  // Pull the last 24h of significant Kalshi moves across all leagues
  const moves = await fetchMovements({ sinceHours: 24, minDelta: 0.03, limit: 50 });
  const drafts: ShareableMovement[] = moves
    .filter((m) => m.event_title && m.contestant_label)
    .map((m) => ({
      kind: "movement",
      league: m.league,
      event_title: m.event_title || "",
      contestant: m.contestant_label || "",
      delta_pct: m.delta,
      prob_now: m.prob_now,
      url: `https://sportsbookish.com/sports/${m.league}/event/${m.event_id}`,
    }));

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground/80">← Admin</Link>
          <div className="text-sm font-semibold">Distribute</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold mb-2">Social distribution drafts</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Auto-drafted copy for X / Bluesky / Threads / Reddit based on the biggest Kalshi line moves (≥3% in 24h).
          Review, edit, click <strong>Copy</strong>, paste to your account. Manual approval only — we never auto-post.
        </p>

        {drafts.length === 0 ? (
          <div className="text-center text-muted-foreground py-16">
            No share-worthy moves in the last 24h. Try again later — moves &ge; 3% on Kalshi tend to cluster around tournament Sundays and major game days.
          </div>
        ) : (
          <DistributeDraftsClient drafts={drafts} />
        )}
      </main>
    </div>
  );
}
