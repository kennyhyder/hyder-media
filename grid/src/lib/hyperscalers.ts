// Hyperscaler / colo footprint classifier (Phase 1, DC pipeline) — Jon De Pena's
// fallback ask: when the off-taker for a project is unknown, show "who already
// has a footprint near here." Derived from the operator field on grid_datacenters
// (existing DCs), so it's real data, not a hand-curated location list.

const HYPERSCALERS: Array<{ name: string; re: RegExp }> = [
  { name: "AWS", re: /amazon|\baws\b|vadata/i },
  { name: "Microsoft", re: /microsoft|azure/i },
  { name: "Google", re: /\bgoogle\b/i },
  { name: "Meta", re: /\bmeta\b|facebook/i },
  { name: "Oracle", re: /\boracle\b/i },
  { name: "Apple", re: /\bapple\b/i },
];

const COLOS: Array<{ name: string; re: RegExp }> = [
  { name: "Equinix", re: /equinix/i },
  { name: "Digital Realty", re: /digital realty/i },
  { name: "CyrusOne", re: /cyrusone/i },
  { name: "CoreSite", re: /coresite/i },
  { name: "NTT", re: /\bntt\b/i },
  { name: "QTS", re: /\bqts\b/i },
  { name: "Vantage", re: /vantage/i },
  { name: "Switch", re: /\bswitch\b/i },
];

/** Returns the hyperscaler brand for an operator string, or null if not a hyperscaler. */
export function hyperscalerOf(operator: string | null | undefined): string | null {
  if (!operator) return null;
  for (const h of HYPERSCALERS) if (h.re.test(operator)) return h.name;
  return null;
}

/** Returns the colo brand for an operator string, or null. */
export function coloOf(operator: string | null | undefined): string | null {
  if (!operator) return null;
  for (const c of COLOS) if (c.re.test(operator)) return c.name;
  return null;
}

export function isHyperscaler(operator: string | null | undefined): boolean {
  return hyperscalerOf(operator) != null;
}
