import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, accountsEnabled } from "@/lib/auth";
import { getSavedSites, getLists, getAlerts } from "@/lib/account-data";
import SignOutButton from "@/components/account/SignOutButton";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

// Always render fresh — account state is per-user and never cacheable.
export const dynamic = "force-dynamic";

const TYPE_PATH: Record<string, string> = {
  site: "/datacenter-sites",
  substation: "/substations",
  brownfield: "/brownfield-sites",
  ixp: "/internet-exchanges",
  datacenter: "/datacenters",
  company: "/companies",
  county: "/datacenter-sites",
};

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>{title}</h2>
        <span className="text-xs" style={{ color: "var(--muted)" }}>{count}</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="surface-card rounded-xl p-5 text-sm" style={{ color: "var(--muted)" }}>
      {msg}
    </div>
  );
}

export default async function AccountPage() {
  // If accounts aren't configured at all, show a soft placeholder rather than crash.
  if (!accountsEnabled()) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Your account</h1>
        <div className="mt-6">
          <Empty msg="Accounts aren't enabled in this environment yet." />
        </div>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  // All three reads degrade to [] if the gc_ tables don't exist yet.
  const [saved, lists, alerts] = await Promise.all([
    getSavedSites(user.id),
    getLists(user.id),
    getAlerts(user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>
            {user.displayName || "Your account"}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {user.email}
            <span className="mx-2">·</span>
            <span className="rounded px-1.5 py-0.5 text-[11px] font-medium capitalize" style={{ background: "var(--surface-2)", color: "var(--text)" }}>
              {user.role}
            </span>
            {user.reputation > 0 && (
              <span className="ml-2 text-[11px]" style={{ color: "var(--accent)" }}>
                {user.reputation} rep
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {user.capabilities.canModerate && (
            <a href="/admin/moderation" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              Moderation
            </a>
          )}
          <SignOutButton />
        </div>
      </header>

      <Section title="Saved sites" count={saved.length}>
        {saved.length === 0 ? (
          <Empty msg="No saved sites yet. Hit Save on any site, substation, datacenter, or IXP to watch it here." />
        ) : (
          <ul className="surface-card divide-y rounded-xl" style={{ borderColor: "var(--border)" }}>
            {saved.map((s) => {
              const name = (s.meta?.name as string) || s.label || s.entity_id;
              const sub = [s.meta?.state, s.meta?.score != null ? `score ${s.meta.score}` : null].filter(Boolean).join(" · ");
              return (
                <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3" style={{ borderColor: "var(--border)" }}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{name}</p>
                    {sub && <p className="text-xs" style={{ color: "var(--muted)" }}>{sub}</p>}
                  </div>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] capitalize" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
                    {s.entity_type}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Lists" count={lists.length}>
        {lists.length === 0 ? (
          <Empty msg="No lists yet. Group sites into portfolios to compare and export them." />
        ) : (
          <ul className="surface-card divide-y rounded-xl" style={{ borderColor: "var(--border)" }}>
            {lists.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-4 px-4 py-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{l.name}</p>
                  {l.description && <p className="text-xs" style={{ color: "var(--muted)" }}>{l.description}</p>}
                </div>
                {l.is_public && <span className="text-[10px]" style={{ color: "var(--accent)" }}>public</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Alerts" count={alerts.length}>
        {alerts.length === 0 ? (
          <Empty msg="No alerts yet. Get notified when queue status changes, a new high-score site appears in a county, or a nodal price moves." />
        ) : (
          <ul className="surface-card divide-y rounded-xl" style={{ borderColor: "var(--border)" }}>
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="text-sm font-medium capitalize" style={{ color: "var(--text)" }}>
                    {a.alert_type.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    via {a.channel}
                    {a.last_fired_at ? ` · last fired ${new Date(a.last_fired_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <span className="text-[10px]" style={{ color: a.is_active ? "var(--accent)" : "var(--muted)" }}>
                  {a.is_active ? "active" : "paused"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="mt-10 text-xs" style={{ color: "var(--muted)" }}>
        Tip: use the API tokens panel (coming to Settings) to script lookups and
        watch changes programmatically.
      </p>
    </div>
  );
}
