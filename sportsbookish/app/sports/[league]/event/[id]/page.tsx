import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";
import { fetchEventDetail, fetchLeagues } from "@/lib/sports-data";
import { fetchEventHistory, fetchMovements } from "@/lib/movements-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel, edgeTextClass, edgeBgClass } from "@/lib/format";
import PriceSpark from "@/components/PriceSpark";
import UpsellBanner from "@/components/UpsellBanner";
import SpreadsTable from "@/components/sports/SpreadsTable";
import TotalsTable from "@/components/sports/TotalsTable";
import WatchlistButton from "@/components/WatchlistButton";
import { createClient } from "@/lib/supabase/server";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: { params: Promise<{ league: string; id: string }> }): Promise<Metadata> {
  const { league, id } = await params;
  const detail = await fetchEventDetail(id);
  if (!detail) return { title: "Event — SportsBookISH" };
  const title = `${detail.event.title} — Kalshi vs Books | SportsBookISH`;
  const ogImage = `${SITE_URL}/api/og/sports-event?id=${id}`;
  const url = `${SITE_URL}/sports/${league}/event/${id}`;

  // Build a snappy description: top edge + Kalshi vs books per side
  const m0 = detail.markets[0];
  const m1 = detail.markets[1];
  const lines = [m0, m1].filter(Boolean).map((m) =>
    `${m.contestant_label}: Kalshi ${m.implied_prob != null ? `${(m.implied_prob * 100).toFixed(1)}%` : "—"} vs books ${m.books_median != null ? `${(m.books_median * 100).toFixed(1)}%` : "—"}`
  ).join(" · ");
  const description = lines || "Live Kalshi vs sportsbook odds comparison.";

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: [ogImage], siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ league: string; id: string }> }) {
  const { league, id } = await params;
  const { tier, userId } = await getCurrentTier();

  const [leagues, detail, history, allMovements] = await Promise.all([
    fetchLeagues(),
    fetchEventDetail(id),
    fetchEventHistory(id, 24),
    fetchMovements({ sinceHours: 24, league, minDelta: 0.015, limit: 50 }),
  ]);
  const meta = leagues.find((l) => l.key === league);
  if (!detail || !meta) notFound();

  // movements for this specific event
  const eventMoves = allMovements.filter((m) => m.event_id === id);
  const historyByMarket = new Map(history.map((h) => [h.market_id, h]));
  const isAnonymous = !userId;
  const isPaidTier = !isAnonymous && tier !== "free";
  const anyBooks = detail.markets.some((m) => (m.books_count ?? 0) > 0);

  // Watchlist state — load all bookmarks for this user keyed by contestant label
  const supabaseAuth = await createClient();
  const { data: watchlistRows } = userId
    ? await supabaseAuth.from("sb_watchlist").select("id, ref_id").eq("user_id", userId).eq("league", league)
    : { data: [] as { id: number; ref_id: string }[] };
  const bookmarkByRef = new Map((watchlistRows || []).map((w) => [w.ref_id, w.id]));

  return (
    <div className="min-h-screen">
      {isAnonymous && <UpsellBanner variant="anonymous" next={`/sports/${league}/event/${id}`} />}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href={`/sports/${league}`} className="text-sm text-muted-foreground hover:text-foreground/80">← {meta.display_name}</Link>
          <div className="text-sm font-semibold capitalize">{detail.event.event_type}</div>
          {isAnonymous ? (
            <Link href={`/signup?next=/sports/${league}/event/${id}`} className="text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 font-semibold">Sign up free</Link>
          ) : (
            <div className="w-12" />
          )}
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-3xl">{meta.icon}</span>
            <h1 className="text-3xl font-bold">{detail.event.title}</h1>
          </div>
          <div className="text-sm text-muted-foreground">
            {detail.event.start_time && new Date(detail.event.start_time).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 font-mono">{detail.event.kalshi_event_ticker}</div>
        </div>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Lines</span>
              <span className="text-xs font-normal text-muted-foreground">
                {anyBooks ? (
                  <><span className="text-amber-500">Kalshi</span> vs book consensus{isPaidTier ? "" : " (free shows 5 of N books)"}</>
                ) : (
                  <span className="text-muted-foreground/70">Books haven&apos;t posted lines for this game yet — typically 1-2 days before tipoff</span>
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/40">
            {detail.markets.map((m) => {
              const p = m.implied_prob;
              const width = Math.max(0, Math.min(100, (p ?? 0) * 100));
              const hist = historyByMarket.get(m.id);
              const edgeMed = m.edge_vs_books_median;
              const edgeBest = m.edge_vs_best_book;
              const books = m.book_prices || [];
              const visibleBooks = isPaidTier ? books : books.slice(0, 5);
              const bookmarkId = bookmarkByRef.get(m.contestant_label);
              return (
                <div key={m.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2 gap-3">
                    <div className="font-semibold flex-1 min-w-0 truncate flex items-center gap-2">
                      <WatchlistButton
                        signedIn={!isAnonymous}
                        initialActive={!!bookmarkId}
                        initialId={bookmarkId}
                        kind="team"
                        refId={m.contestant_label}
                        label={m.contestant_label}
                        league={league}
                        size="sm"
                      />
                      <span className="truncate">{m.contestant_label}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {hist && hist.points.length >= 2 && <PriceSpark points={hist.points} width={100} height={28} />}
                      <div className="text-2xl font-bold tabular-nums text-amber-500">{p != null ? `${(p * 100).toFixed(1)}%` : "—"}</div>
                    </div>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500/60 rounded-full" style={{ width: `${width}%` }} />
                  </div>
                  {(m.yes_bid != null || m.yes_ask != null) && (
                    <div className="text-xs text-muted-foreground mt-2 tabular-nums">
                      Bid {m.yes_bid != null ? `${(m.yes_bid * 100).toFixed(1)}¢` : "—"} ·
                      Ask {m.yes_ask != null ? `${(m.yes_ask * 100).toFixed(1)}¢` : "—"} ·
                      Last {m.last_price != null ? `${(m.last_price * 100).toFixed(1)}¢` : "—"}
                    </div>
                  )}

                  {/* Book overlay */}
                  {(m.books_count ?? 0) > 0 && (
                    <div className="mt-3 rounded-md border border-border/60 bg-card/50 p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                        <span className="text-muted-foreground">
                          Books median <span className="text-foreground tabular-nums">{fmtPct(m.books_median)}</span>{" "}
                          <span className="text-muted-foreground/70">({m.books_count} books, {fmtPct(m.books_min)}–{fmtPct(m.books_max)})</span>
                        </span>
                        {m.best_book && (
                          <span className="text-muted-foreground">
                            Best book <span className="text-foreground">{bookLabel(m.best_book.book)}</span>{" "}
                            <span className="tabular-nums">{fmtAmerican(m.best_book.american)}</span>{" "}
                            <span className="text-muted-foreground/70">({fmtPct(m.best_book.implied_prob_novig)})</span>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
                        <span>
                          Buy edge vs median{" "}
                          <span className={`tabular-nums font-semibold px-1 rounded ${edgeTextClass(edgeMed)} ${edgeBgClass(edgeMed)}`}>{fmtPctSigned(edgeMed)}</span>
                        </span>
                        <span>
                          vs best book{" "}
                          <span className={`tabular-nums font-semibold ${edgeTextClass(edgeBest)}`}>{fmtPctSigned(edgeBest)}</span>
                        </span>
                      </div>
                      {books.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1 text-[11px]">
                          {books.map((b, idx) => {
                            const locked = !isPaidTier && idx >= 5;
                            const href = isAnonymous ? `/signup?next=/sports/${league}/event/${id}` : "/pricing";
                            if (locked) {
                              return (
                                <Link key={b.book} href={href} className="flex items-center justify-between bg-muted/40 rounded px-2 py-1 relative overflow-hidden hover:bg-muted">
                                  <span className="text-muted-foreground/60 truncate text-[10px]">{bookLabel(b.book)} 🔒</span>
                                  <span className="tabular-nums blur-sm pointer-events-none">{fmtAmerican(b.american)}</span>
                                </Link>
                              );
                            }
                            return (
                              <div key={b.book} className="flex items-center justify-between bg-muted/40 rounded px-2 py-1">
                                <span className="text-muted-foreground truncate" title={bookLabel(b.book)}>{bookLabel(b.book)}</span>
                                <span className="tabular-nums">{fmtAmerican(b.american)}</span>
                              </div>
                            );
                          })}
                          {!isPaidTier && books.length > 5 && (
                            <Link href={isAnonymous ? `/signup?next=/sports/${league}/event/${id}` : "/pricing"} className="flex items-center justify-center bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 rounded px-2 py-1 col-span-full sm:col-span-1 text-[10px] font-semibold">
                              {isAnonymous ? "Sign up free →" : `Pro: +${books.length - 5}`}
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {detail.markets.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">No quotes ingested yet. Check back in a minute.</div>
            )}
          </CardContent>
        </Card>

        {detail.spreads && detail.spreads.length > 0 && (
          <div className="mb-4">
            <SpreadsTable rows={detail.spreads} isPaidTier={isPaidTier && !isAnonymous} signupHref={isAnonymous ? `/signup?next=/sports/${league}/event/${id}` : undefined} />
          </div>
        )}

        {detail.totals && detail.totals.length > 0 && (
          <div className="mb-4">
            <TotalsTable rows={detail.totals} isPaidTier={isPaidTier && !isAnonymous} signupHref={isAnonymous ? `/signup?next=/sports/${league}/event/${id}` : undefined} />
          </div>
        )}

        {eventMoves.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Recent moves on this event (24h, ≥1.5%)</CardTitle></CardHeader>
            <CardContent className="p-0 divide-y divide-border/40">
              {eventMoves.map((m) => (
                <div key={m.id} className="px-5 py-3 flex items-center justify-between text-sm">
                  <span>{m.contestant_label}</span>
                  <span className={`tabular-nums font-semibold ${m.direction === "up" ? "text-emerald-400" : "text-rose-400"}`}>{fmtPctSigned(m.delta)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {(isAnonymous || tier !== "elite") && (
          <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            {isAnonymous ? (
              <>
                <strong>Don&apos;t miss the next edge.</strong> <Link href={`/signup?next=/sports/${league}/event/${id}`} className="text-emerald-400 hover:underline">Sign up free</Link> to save preferences and get the daily top edges by email.{" "}
                <Link href="/pricing" className="text-emerald-400 hover:underline">Elite ($39)</Link> sends email + SMS the moment Kalshi moves ≥3% in 15 min on any market.
              </>
            ) : (
              <>
                <strong>Elite</strong> ($39/mo) gets live email + SMS the moment Kalshi moves ≥3% in 15 min on any market.{" "}
                <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade →</Link>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
