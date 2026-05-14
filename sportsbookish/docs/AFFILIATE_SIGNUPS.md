# Sportsbook affiliate program signup checklist

Where to apply for each book that SportsBookISH displays, plus commission
structure and network details. Once approved for each, paste the tracking
URL into Vercel as `AFFILIATE_<BOOK>_URL` and our codebase will use it
automatically (otherwise we link out to the plain homepage — good UX, zero
commission).

## US-licensed books (require state operating licenses)

These require more vetting since the brands are regulated under state
gaming commissions. Approval typically takes 1-3 weeks and they may
require traffic / volume thresholds.

### DraftKings
- **Apply at:** https://www.draftkings.com/about/affiliates
- **Network:** Direct (CAKE platform)
- **Commission:** $100-200 CPA per first-time deposit (FTD), or 25-40% revenue share — negotiable based on traffic
- **Vercel env:** `AFFILIATE_DRAFTKINGS_URL`

### FanDuel
- **Apply at:** https://affiliates.fanduel.com — through Impact Radius
- **Network:** Impact Radius
- **Commission:** $100-150 CPA per FTD or 25-30% rev share
- **Vercel env:** `AFFILIATE_FANDUEL_URL`

### BetMGM
- **Apply at:** https://www.betmgm.com/affiliates — Income Access platform
- **Network:** Income Access (Paysafe Group)
- **Commission:** $100-200 CPA or rev share negotiable
- **Vercel env:** `AFFILIATE_BETMGM_URL`

### Caesars Sportsbook
- **Apply at:** https://www.caesars.com/sportsbook/affiliates — Income Access
- **Network:** Income Access (legacy William Hill US affiliate program)
- **Commission:** CPA up to $250 per FTD on big states
- **Vercel env:** `AFFILIATE_CAESARS_URL`

### BetRivers
- **Apply at:** https://www.rushstreetinteractive.com/affiliates
- **Network:** Direct (Rush Street Interactive)
- **Commission:** $80-150 CPA or 25-35% rev share
- **Vercel env:** `AFFILIATE_BETRIVERS_URL`

### Fanatics Sportsbook
- **Apply at:** Email `sportsbook-partners@fanatics.com` — newer program, no public portal as of 2026
- **Network:** Income Access (Paysafe — same parent as BetMGM)
- **Commission:** TBD — they're rolling out, expect $100-150 CPA
- **Vercel env:** `AFFILIATE_FANATICS_URL`

## Offshore books (no US state license — easier approval)

Lighter regulatory bar, faster approvals, generally higher commission %.

### Bovada
- **Apply at:** https://www.bovadaaffiliates.com
- **Network:** Direct
- **Commission:** 25-45% lifetime rev share
- **Vercel env:** `AFFILIATE_BOVADA_URL`

### BetOnline.ag
- **Apply at:** https://www.revenuegiants.com
- **Network:** Revenue Giants (multi-brand)
- **Commission:** 25-35% lifetime rev share
- **Vercel env:** `AFFILIATE_BETONLINE_URL`

### LowVig.ag
- **Apply at:** https://www.revenuegiants.com (joint program with BetOnline — same parent)
- **Network:** Revenue Giants
- **Commission:** 25-35% lifetime rev share
- **Vercel env:** `AFFILIATE_LOWVIG_URL`

### MyBookie.ag
- **Apply at:** https://www.mybookieagents.ag
- **Network:** Direct (highest commission rates of any book on our list)
- **Commission:** 30-50% rev share
- **Vercel env:** `AFFILIATE_MYBOOKIE_URL`

### BetUS
- **Apply at:** https://www.betuspartners.com
- **Network:** Direct
- **Commission:** 30-50% lifetime rev share
- **Vercel env:** `AFFILIATE_BETUS_URL`

## Prediction markets

### Kalshi
- **Apply at:** https://kalshi.com/refer — invite-based referral, not a traditional affiliate program
- **Commission:** $10-25 per qualified signup historically
- **Vercel env:** `AFFILIATE_KALSHI_URL`
- **Note:** This is the most important link to enable — Kalshi is the core comparison and many users will sign up there.

### Polymarket
- **Status:** No public affiliate program as of 2026
- Plain link only.

## Recommended priority for signups

1. **Kalshi referral** — most users will sign up here based on edge findings
2. **DraftKings, FanDuel, BetMGM** — biggest US books, highest brand recognition
3. **Bovada + offshore network (RevenueGiants for BetOnline/LowVig)** — easier approval, higher rev share
4. **BetRivers + Caesars** — sharp lines often, useful for arb users
5. **MyBookie + BetUS** — high rev share, easier approval

## Setting URLs after approval

For each approved program, add the tracking URL to Vercel:

```bash
vercel env add AFFILIATE_DRAFTKINGS_URL production
# paste the full URL when prompted, e.g.:
# https://wlsportsbookus.com/track?affid=12345&offerid=234
```

The codebase will pick up the env var on next deploy and use it for all
DraftKings link renders. Each render gets `?utm_source=sportsbookish`
appended automatically.

## Rendering on the site

`<BookLink book="draftkings" campaign="event-detail">` renders a clickable
sportsbook name. Uses `rel="sponsored noopener noreferrer"` on every
outbound link, opens in a new tab.

Currently wired:
- Event detail "Best book" callout
- (more locations to wire as program approvals come in)
