import Link from "next/link";
import { bookLabel } from "@/lib/format";
import { affiliateUrl, getAffiliate } from "@/lib/affiliates";

// Render a sportsbook name. If we have an affiliate URL configured, it
// renders as an outbound link with rel="sponsored noopener" and UTM
// tracking. Otherwise just plain text.

interface Props {
  book: string;
  className?: string;
  campaign?: string;             // e.g. 'event-detail', 'best-bets-card'
  showLabel?: boolean;           // false → render only the URL wrap
  children?: React.ReactNode;
}

export default function BookLink({ book, className, campaign, showLabel = true, children }: Props) {
  const info = getAffiliate(book);
  const url = affiliateUrl(book, { campaign });
  const label = children ?? (showLabel ? bookLabel(book) : null);

  if (!info || info.status === "unavailable" || !url) {
    return <span className={className}>{label}</span>;
  }

  return (
    <Link
      href={url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      className={className}
      title={`Visit ${bookLabel(book)} (affiliate link)`}
    >
      {label}
    </Link>
  );
}
