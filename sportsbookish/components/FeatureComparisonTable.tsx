import type { BrandProfile } from "@/lib/brand-profiles";

// Side-by-side feature comparison. Two profiles in, one wide table out.
// Rows are picked for the dimensions that actually matter to a user
// deciding between two venues (regulator/fees/min/max/withdrawal/markets).
//
// Used by /compare/polymarket-vs-kalshi (Kalshi vs Polymarket) and
// /compare/[slug] (Kalshi vs any sportsbook).

interface Props {
  left: BrandProfile;
  right: BrandProfile;
  caption?: string;
}

function fmtList(items: string[], max = 4): string {
  if (items.length <= max) return items.join(", ");
  return items.slice(0, max).join(", ") + ` (+${items.length - max} more)`;
}

export default function FeatureComparisonTable({ left, right, caption }: Props) {
  const rows: { label: string; left: string; right: string }[] = [
    { label: "Category", left: left.category.replace("-", " "), right: right.category.replace("-", " ") },
    { label: "Founded", left: String(left.founded), right: String(right.founded) },
    { label: "Headquarters", left: left.hq, right: right.hq },
    { label: "Regulator", left: left.regulator, right: right.regulator },
    { label: "States available", left: left.statesAvailable, right: right.statesAvailable },
    { label: "Monthly volume", left: left.monthlyVolumeUsd || "Undisclosed", right: right.monthlyVolumeUsd || "Undisclosed" },
    { label: "Annual volume", left: left.annualVolumeUsd || "Undisclosed", right: right.annualVolumeUsd || "Undisclosed" },
    { label: "Total raised", left: left.totalRaisedUsd || "—", right: right.totalRaisedUsd || "—" },
    { label: "Reported valuation", left: left.valuationUsd || "—", right: right.valuationUsd || "—" },
    { label: "Parent company", left: left.parentCompany || "Independent", right: right.parentCompany || "Independent" },
    { label: "Public ticker", left: left.publicTicker || "Private", right: right.publicTicker || "Private" },
    { label: "Fee structure", left: left.feeStructure, right: right.feeStructure },
    { label: "Min position", left: left.minPosition, right: right.minPosition },
    { label: "Max position", left: left.maxPosition, right: right.maxPosition },
    { label: "Settlement", left: left.settlementCurrency, right: right.settlementCurrency },
    { label: "Withdrawal", left: left.withdrawalSpeed, right: right.withdrawalSpeed },
    { label: "Payments", left: fmtList(left.paymentMethods, 3), right: fmtList(right.paymentMethods, 3) },
    { label: "Mobile apps", left: left.mobileApps, right: right.mobileApps },
    { label: "Product categories", left: fmtList(left.productCategories), right: fmtList(right.productCategories) },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        {caption && <caption className="caption-top px-3 py-2 text-xs text-muted-foreground bg-card/40 text-left">{caption}</caption>}
        <thead className="bg-card/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="text-left px-3 py-2 w-1/4">Dimension</th>
            <th scope="col" className="text-left px-3 py-2"><span aria-hidden="true">{left.emoji} </span>{left.name}</th>
            <th scope="col" className="text-left px-3 py-2"><span aria-hidden="true">{right.emoji} </span>{right.name}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border/40 align-top">
              <th scope="row" className="text-left px-3 py-2 text-muted-foreground font-medium">{r.label}</th>
              <td className="px-3 py-2">{r.left}</td>
              <td className="px-3 py-2">{r.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
