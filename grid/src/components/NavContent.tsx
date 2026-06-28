"use client";

// Shared nav body for both the desktop sidebar and the mobile drawer.
//
// SEO NOTE: this is a "use client" component ONLY so it can read the current
// pathname to mark the active link (aria-current). It renders every link
// UNCONDITIONALLY as a real <a href> — nothing is gated behind state or an
// effect — so the full nav (links + text) is present in the server-rendered
// HTML on first request. Hydration only adds the active-state highlight.

import { usePathname } from "next/navigation";
import {
  PRIMARY_LINKS,
  INFRA_GROUP,
  FOOTER_LINKS,
  ICONS,
  type NavLink,
} from "./nav-data";
import ThemeToggle from "./ThemeToggle";
import AccountNavLink from "./account/AccountNavLink";

function Icon({ d }: { d: string }) {
  return (
    <svg
      className="h-[18px] w-[18px] shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function iconFor(href: string): string {
  if (href === "/map") return ICONS.map;
  if (href === "/datacenter-sites") return ICONS.locations;
  if (href === "/site-types") return ICONS.types;
  if (href === "/iso") return ICONS.iso;
  if (href === "/rankings") return ICONS.rankings;
  if (href === "/substations") return ICONS.substations;
  if (href === "/datacenters") return ICONS.datacenters;
  if (href === "/internet-exchanges") return ICONS.exchanges;
  if (href === "/brownfield-sites") return ICONS.brownfields;
  if (href === "/methodology") return ICONS.methodology;
  if (href === "/pricing") return ICONS.pricing;
  return ICONS.types;
}

export default function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() || "/";

  const isActive = (link: NavLink) => {
    const m = link.match ?? link.href;
    if (m === "/map") return pathname === "/map";
    return pathname === m || pathname.startsWith(`${m}/`);
  };

  const linkRow = (link: NavLink) => (
    <a
      key={link.href}
      href={link.href}
      onClick={onNavigate}
      aria-current={isActive(link) ? "page" : undefined}
      className="nav-link flex items-center gap-2.5 px-3 py-2 text-sm font-medium"
    >
      <Icon d={iconFor(link.href)} />
      <span>{link.label}</span>
    </a>
  );

  return (
    <nav aria-label="Primary" className="flex h-full flex-col">
      {/* Search affordance — links to the full search page (real route). */}
      <a
        href="/search"
        onClick={onNavigate}
        className="mx-3 mt-1 mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: "var(--border)", color: "var(--muted)", background: "var(--surface-2)" }}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={ICONS.search} />
        </svg>
        <span>Search sites, counties…</span>
      </a>

      <div className="flex-1 overflow-y-auto px-2">
        <div className="flex flex-col gap-0.5">
          {PRIMARY_LINKS.map(linkRow)}
        </div>

        <div className="mt-5">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            {INFRA_GROUP.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {INFRA_GROUP.links.map(linkRow)}
          </div>
        </div>
      </div>

      {/* Footer area */}
      <div className="mt-3 border-t px-2 pt-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-col gap-0.5">
          {FOOTER_LINKS.map(linkRow)}
          <AccountNavLink onNavigate={onNavigate} />
        </div>
        <div className="mt-1">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
