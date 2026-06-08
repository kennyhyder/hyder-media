import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BrandProfile } from "@/lib/brand-profiles";
import { affiliateUrl } from "@/lib/affiliates";

// Side-by-side brand profile card. Renders the "at a glance" facts about a
// brand (founded, HQ, regulator, funding, scale, fees, etc.) in a compact
// stacked format so two cards side-by-side give an instant visual diff.

interface Props {
  profile: BrandProfile;
  campaign: string;             // analytics tag for the outbound CTA
  accentClass?: string;         // e.g. "border-amber-500/40" for Kalshi
  highlightClass?: string;      // e.g. "text-amber-400" for headings
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  );
}

export default function BrandProfileCard({ profile: p, campaign, accentClass = "", highlightClass = "" }: Props) {
  const url = affiliateUrl(p.slug, { campaign }) || p.officialSite;
  return (
    <Card className={`overflow-hidden ${accentClass}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-3xl" aria-hidden="true">{p.emoji}</span>
            <div>
              <h3 className={`text-xl font-bold ${highlightClass}`}>{p.name}</h3>
              <p className="text-xs text-muted-foreground">{p.tagline}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase">{p.category.replace("-", " ")}</Badge>
        </div>

        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{p.oneSentence}</p>

        <a
          href={url}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-current/40 bg-current/10 hover:bg-current/20 transition px-3 py-1.5 text-xs font-semibold mb-4"
        >
          Visit {p.name} →
        </a>

        <div className="space-y-0 mb-4">
          <Row label="Founded" value={`${p.founded} · ${p.foundersText}`} />
          <Row label="HQ" value={p.hq} />
          <Row label="CEO" value={p.ceo} />
          <Row label="Employees" value={p.employeesText} />
          <Row label="Public ticker" value={p.publicTicker} />
          <Row label="Parent" value={p.parentCompany} />
        </div>

        <div className="space-y-0 mb-4">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Regulation</h4>
          <Row label="Regulator" value={p.regulator} />
          <Row label="States" value={p.statesAvailable} />
        </div>

        <div className="space-y-0 mb-4">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Scale · {p.asOf}</h4>
          <Row label="Monthly volume" value={p.monthlyVolumeUsd} />
          <Row label="Annual volume" value={p.annualVolumeUsd} />
          <Row label="Users" value={p.userCountText} />
        </div>

        <div className="space-y-0 mb-4">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Funding</h4>
          <Row label="Total raised" value={p.totalRaisedUsd} />
          <Row label="Last round" value={p.lastRoundLabel} />
          <Row label="Last round size" value={p.lastRoundUsd} />
          <Row label="Valuation" value={p.valuationUsd} />
          {p.keyInvestors.length > 0 && <Row label="Key investors" value={p.keyInvestors.join(", ")} />}
        </div>

        <div className="space-y-0 mb-4">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Product</h4>
          <Row label="Fees" value={p.feeStructure} />
          <Row label="Min position" value={p.minPosition} />
          <Row label="Max position" value={p.maxPosition} />
          <Row label="Settlement" value={p.settlementCurrency} />
          <Row label="Withdrawal" value={p.withdrawalSpeed} />
          <Row label="Mobile" value={p.mobileApps} />
          <Row label="Payments" value={p.paymentMethods.join(" · ")} />
        </div>

        <div className="mb-3">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">References</h4>
          <ul className="text-xs space-y-1">
            {p.officialSite && <li><a className="text-emerald-500 hover:underline" href={p.officialSite} target="_blank" rel="noopener noreferrer">Official site ↗</a></li>}
            {p.crunchbaseUrl && <li><a className="text-emerald-500 hover:underline" href={p.crunchbaseUrl} target="_blank" rel="noopener noreferrer">Crunchbase ↗</a></li>}
            {p.wikipediaUrl && <li><a className="text-emerald-500 hover:underline" href={p.wikipediaUrl} target="_blank" rel="noopener noreferrer">Wikipedia ↗</a></li>}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
