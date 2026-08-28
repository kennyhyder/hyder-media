import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, accountsEnabled, gcRead } from "@/lib/auth";
import BillingPortalButton from "@/components/account/BillingPortalButton";
import UpgradeButton from "@/components/account/UpgradeButton";
import WatchRowActions from "@/components/account/WatchRowActions";

export const metadata: Metadata = {
  title: "Watchtower",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface WatchRow {
  id: string;
  kind: string;
  dc_site_id: string | null;
  label: string;
  target_mw: number | null;
  last_scanned_at: string | null;
  created_at: string;
}
interface EventRow {
  id: string;
  watch_id: string;
  severity: string;
  summary: string;
  created_at: string;
}

const SEV_DOT: Record<string, string> = {
  high: "#b0392c",
  notable: "#a86a12",
  info: "#8b93a1",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "not yet";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default async function WatchtowerPage() {
  if (!accountsEnabled()) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/watchtower");

  const isPro = user.role === "owner" || user.role === "enterprise" || user.role === "moderator" || user.role === "staff";
  const limit = isPro ? (user.role === "owner" ? 25 : Infinity) : 1;

  const watches = await gcRead<WatchRow>("gc_watches", {
    user_id: `eq.${user.id}`,
    is_active: "eq.true",
    select: "id,kind,dc_site_id,label,target_mw,last_scanned_at,created_at",
    order: "created_at.desc",
    limit: "100",
  });

  const events =
    watches.length > 0
      ? await gcRead<EventRow>("gc_watch_events", {
          watch_id: `in.(${watches.map((w) => w.id).join(",")})`,
          select: "id,watch_id,severity,summary,created_at",
          order: "created_at.desc",
          limit: "60",
        })
      : [];
  const eventsByWatch = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!eventsByWatch.has(e.watch_id)) eventsByWatch.set(e.watch_id, []);
    if (eventsByWatch.get(e.watch_id)!.length < 5) eventsByWatch.get(e.watch_id)!.push(e);
  }

  return (
    <div className="mx-auto max-w-3xl py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Watchtower</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {isPro
              ? "Pro — nightly scans, daily digests, and immediate high-severity alerts."
              : "Free — 1 watched location, weekly scan & Monday digest."}{" "}
            {watches.length}/{Number.isFinite(limit) ? limit : "∞"} watches used.
          </p>
        </div>
        {user.role === "owner" ? (
          <BillingPortalButton />
        ) : !isPro ? (
          <UpgradeButton className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700" />
        ) : null}
      </div>

      {watches.length === 0 ? (
        <div className="surface-card mt-8 rounded-xl p-6 text-sm" style={{ color: "var(--muted)" }}>
          No watches yet. Open any{" "}
          <a href="/datacenter-sites" className="underline" style={{ color: "var(--accent-ink)" }}>
            site profile
          </a>{" "}
          or{" "}
          <a href="/vet" className="underline" style={{ color: "var(--accent-ink)" }}>
            vet a location
          </a>{" "}
          and hit <strong>Watch</strong> — GridCensus will re-scan its siting signals
          (score, regulatory posture, grid constraints, nearby projects, local news) and email you when
          something changes.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {watches.map((w) => (
            <div key={w.id} className="surface-card rounded-xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold" style={{ color: "var(--text)" }}>
                    {w.label}
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                    {w.kind === "site" ? "Scored site" : "Pinned location"}
                    {w.target_mw ? ` · target ${w.target_mw} MW` : ""} · last scan: {fmtWhen(w.last_scanned_at)}
                  </div>
                </div>
                <WatchRowActions id={w.id} />
              </div>
              {(eventsByWatch.get(w.id) ?? []).length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {(eventsByWatch.get(w.id) ?? []).map((e) => (
                    <li key={e.id} className="flex items-baseline gap-2 text-sm" style={{ color: "var(--text)" }}>
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: SEV_DOT[e.severity] ?? SEV_DOT.info }}
                      />
                      <span className="min-w-0">{e.summary}</span>
                      <span className="ml-auto shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                        {fmtWhen(e.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {!isPro && watches.length > 0 && (
        <div className="mt-8 rounded-xl border border-purple-200 bg-purple-50 p-5 text-sm text-gray-800">
          <strong>Watching more than one deal?</strong> Pro watches up to 25 locations with nightly scans,
          daily digests, and immediate alerts on high-severity changes.
          <div className="mt-3 max-w-xs">
            <UpgradeButton className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700" />
          </div>
        </div>
      )}
    </div>
  );
}
