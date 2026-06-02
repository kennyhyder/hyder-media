import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentTier } from "@/lib/tier-guard";
import { relativeTime } from "@/components/LastUpdated";
import EngageRowActions from "./EngageRowActions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sharp Engage — daily peer-engagement queue | Admin",
  robots: { index: false, follow: false },
};

interface EngageRow {
  tweet_id: string;
  author_handle: string;
  author_category: string;
  text: string;
  created_at: string;
  reply_text: string | null;
  reply_confidence: number | null;
  reply_reasoning: string | null;
  reply_status: string | null;
}

const ADMIN_EMAILS = new Set(["kenny@hyder.me"]);

async function fetchQueue(): Promise<EngageRow[]> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - 36 * 3600000).toISOString();
  // Pull recent tweets from our sharp targets where:
  //  - we've generated a reply draft (Claude evaluated)
  //  - the reply hasn't been posted (kept manual by design)
  //  - target has high category weight (friends + sharp_analytics + kalshi)
  const { data: rows } = await supabase
    .from("sb_twitter_seen")
    .select(`
      tweet_id, author_handle, text, created_at, reply_text, reply_confidence,
      reply_reasoning, reply_status,
      target:sb_twitter_targets!inner(category)
    `)
    .gte("created_at", since)
    .in("target.category", ["friends", "sharp_analytics", "kalshi", "quant"])
    .not("reply_text", "is", null)
    .order("reply_confidence", { ascending: false, nullsFirst: false })
    .limit(40);
  if (!rows) return [];
  return rows.map((r: Record<string, unknown>) => ({
    tweet_id: r.tweet_id as string,
    author_handle: r.author_handle as string,
    author_category: (r.target as { category: string })?.category || "—",
    text: r.text as string,
    created_at: r.created_at as string,
    reply_text: r.reply_text as string | null,
    reply_confidence: r.reply_confidence as number | null,
    reply_reasoning: r.reply_reasoning as string | null,
    reply_status: r.reply_status as string | null,
  }));
}

export default async function SharpEngagePage() {
  const { userId, email } = await getCurrentTier();
  if (!userId) redirect("/login?next=/admin/sharp-engage");
  if (!email || !ADMIN_EMAILS.has(email)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center">
          <CardContent className="p-6">
            <p className="text-muted-foreground">Admin only.</p>
            <Link href="/" className="text-emerald-400 hover:underline text-sm mt-3 inline-block">← Home</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const queue = await fetchQueue();
  const renderTime = new Date().toISOString();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">← Admin</Link>
          <div className="font-semibold text-sm">Sharp Engage — Daily Peer Queue</div>
          <span className="text-xs text-muted-foreground">{queue.length} drafts</span>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
        <section>
          <h1 className="text-3xl font-bold leading-tight">Sharp peer engagement</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
            Manually review + send the Claude-drafted replies to sharp accounts. Bypasses the
            automated reply budget — these are <em>your</em> account engaging in your voice.
            Distribution moat: 3 sharp accounts engaging with you = worth more than 6 months of paid acquisition.
            Top of the queue is highest-confidence + most-recent from friends, kalshi traders,
            sharp analytics, and quant peers.
          </p>
        </section>

        {queue.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p>No drafts in queue right now. Check back after the next watch cron tick (every 15 min).</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {queue.map((q) => (
              <Card key={q.tweet_id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-emerald-400">@{q.author_handle}</span>
                      <Badge variant="outline" className="text-xs">{q.author_category}</Badge>
                      <span className="text-xs text-muted-foreground/80">· {relativeTime(q.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Confidence:</span>
                      <span className={`font-semibold ${(q.reply_confidence ?? 0) >= 0.7 ? "text-emerald-400" : "text-amber-400"}`}>
                        {q.reply_confidence != null ? `${(q.reply_confidence * 100).toFixed(0)}%` : "—"}
                      </span>
                      {q.reply_status?.startsWith("posted") && <Badge className="bg-emerald-500/15 text-emerald-300 text-xs">Posted</Badge>}
                      {q.reply_status?.startsWith("skipped") && <Badge variant="outline" className="text-xs">Skipped</Badge>}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Their tweet */}
                  <div className="text-sm rounded border border-border/40 p-3 bg-muted/20">
                    <div className="text-[10px] text-muted-foreground/80 uppercase tracking-wide mb-1">Their tweet</div>
                    <div className="whitespace-pre-wrap">{q.text}</div>
                  </div>
                  {/* Our draft */}
                  <div className="text-sm rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <div className="text-[10px] text-emerald-400 uppercase tracking-wide mb-1">Draft reply</div>
                    <div className="whitespace-pre-wrap text-foreground">{q.reply_text}</div>
                    {q.reply_reasoning && (
                      <div className="text-[10px] text-muted-foreground/70 italic mt-2">{q.reply_reasoning}</div>
                    )}
                  </div>
                  <EngageRowActions
                    tweetId={q.tweet_id}
                    authorHandle={q.author_handle}
                    draftReply={q.reply_text || ""}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t border-border/40 pt-4">
          Updated {relativeTime(renderTime)} · refresh page to refetch · drafts auto-evaluated every 15 min by reply cron
        </div>
      </main>
    </div>
  );
}
