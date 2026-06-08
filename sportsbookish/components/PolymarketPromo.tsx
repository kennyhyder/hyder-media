import Image from "next/image";
import { headers } from "next/headers";
import { isIOSUserAgent } from "@/lib/device";
import { POLYMARKET_AFFILIATE_URL, POLYMARKET_PROMO_CODE } from "@/lib/affiliates";

// iOS-only Polymarket affiliate promo. The current Polymarket offer
// ($20 deposit → $50 trading bonus) is iOS-exclusive — desktop/Android
// signups aren't eligible per Vault Network terms. We hide the visual ad
// for non-iOS visitors so we don't show a CTA the user can't act on.
//
// The affiliate link itself is wired into every Polymarket label sitewide
// via lib/affiliates.ts — that one is fine on every device because the
// regulated app does accept Android visitors for browsing; only the
// promo-bonus claim is iOS-gated.
//
// Compliance language (Vault Network slide): prediction markets use
// "trade / predict / buy a position" — never "bet / wager / gamble / stake".

interface Props {
  size?: "300x250" | "1200x627" | "1200x1200" | "720x1280" | "320x50";
  campaign?: string;
  className?: string;
}

const SIZE_MAP = {
  "300x250": { w: 300, h: 250, src: "/affiliate-ads/polymarket/300x250.png" },
  "320x50": { w: 320, h: 50, src: "/affiliate-ads/polymarket/320x50.png" },
  "1200x627": { w: 1200, h: 627, src: "/affiliate-ads/polymarket/1200x627.png" },
  "1200x1200": { w: 1200, h: 1200, src: "/affiliate-ads/polymarket/1200x1200.png" },
  "720x1280": { w: 720, h: 1280, src: "/affiliate-ads/polymarket/720x1280.png" },
} as const;

export default async function PolymarketPromo({ size = "300x250", campaign, className = "" }: Props) {
  const ua = (await headers()).get("user-agent");
  if (!isIOSUserAgent(ua)) return null;

  const dim = SIZE_MAP[size];
  const href = campaign
    ? `${POLYMARKET_AFFILIATE_URL}&utm_campaign=${encodeURIComponent(campaign)}`
    : POLYMARKET_AFFILIATE_URL;

  return (
    <a
      href={href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      className={`block group ${className}`}
      aria-label="Polymarket — $20 deposit, $50 trading bonus (iOS only). Promo code SPORTSBOOKISH."
    >
      <Image
        src={dim.src}
        alt="Polymarket — deposit $20, get $50 trading bonus. iOS only. Promo code SPORTSBOOKISH."
        width={dim.w}
        height={dim.h}
        className="rounded-lg ring-1 ring-white/5 group-hover:ring-white/20 transition"
        priority={false}
      />
      <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        Sponsored · iOS only · Code <span className="font-mono text-foreground/80">SPORTSBOOKISH</span>
      </p>
    </a>
  );
}
