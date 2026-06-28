// Shared presentational primitives for the per-entity profile pages
// (substations / brownfields / internet-exchanges / datacenters). Mirrors the
// Row/Card pattern used inline by the site profile page, factored out so the
// four entity pages stay DRY without diverging from the site-page look.

import type { ReactNode } from "react";

export function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right">{value}</span>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="surface-card rounded-xl p-5">
      <h2 className="mb-3 text-lg font-bold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

export function km2mi(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return "—";
  return `${(km * 0.621371).toFixed(1)} mi`;
}
