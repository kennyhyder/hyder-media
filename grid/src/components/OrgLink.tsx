// Reusable owner/operator → Organization profile link.
//
// Normalizes a raw owner/operator string (e.g. "GEORGIA POWER CO") to its
// canonical organization slug and renders a link to /companies/{slug}. Used on
// every entity profile (site / substation / brownfield / IXP / datacenter) so
// each asset cross-links to the org that owns or operates it — the core of the
// unified-organization interlinking.
//
// Server-safe (no client deps): just string normalization + an <a>.

import { companyProfilePathFromOperator } from "@/lib/entity-slug";

export default function OrgLink({
  owner,
  className,
  fallbackPlain = true,
}: {
  owner: string | null | undefined;
  className?: string;
  /** When no org path resolves, render the raw text (true) or nothing (false). */
  fallbackPlain?: boolean;
}) {
  if (!owner) return null;
  const path = companyProfilePathFromOperator(owner);
  if (!path) return fallbackPlain ? <>{owner}</> : null;
  return (
    <a href={path} className={className ?? "text-purple-700 hover:underline"}>
      {owner}
    </a>
  );
}
