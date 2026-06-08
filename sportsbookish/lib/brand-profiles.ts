// Centralized brand-profile registry. Every comparison page renders from
// this — so a single edit propagates to every "Kalshi vs X" page,
// /compare/polymarket-vs-kalshi, brand callouts on the sportsbooks index,
// and JSON-LD Organization markup for AI overviews / Google SGE.
//
// IMPORTANT: facts here are best-effort accurate as of the `asOf` date on
// each profile. Public funding numbers, valuations, and volume stats move
// — re-verify against Crunchbase / Wikipedia / official sources before
// using for compliance-sensitive copy.

export type Category = "prediction-market" | "sportsbook" | "dfs";

export interface BrandProfile {
  slug: string;
  name: string;
  legalName: string;
  category: Category;
  emoji: string;
  tagline: string;
  oneSentence: string;
  intro: string;

  // Identity
  founded: number;
  foundersText: string;          // e.g. "Tarek Mansour, Luana Lopes Lara"
  hq: string;                    // "New York, NY"
  ceo: string | null;
  employeesText: string | null;  // e.g. "~120 (2025)"
  parentCompany: string | null;  // e.g. "Flutter Entertainment" for FanDuel
  publicTicker: string | null;   // e.g. "DKNG" for DraftKings

  // Regulatory + access
  regulator: string;             // human-readable
  regulatoryStatus: string;
  statesAvailable: string;       // "All 50 US states" / "21 US states" / "Non-US only"

  // Scale (asOf)
  asOf: string;                  // "2025-Q4" or "2026-01"
  monthlyVolumeUsd: string | null; // e.g. "~$300M" — keep human, not number
  annualVolumeUsd: string | null;
  userCountText: string | null;    // e.g. "~1.5M registered users"

  // Funding
  totalRaisedUsd: string | null;   // e.g. "$50M+ across Series A–C"
  lastRoundLabel: string | null;   // e.g. "Series B, May 2024"
  lastRoundUsd: string | null;     // e.g. "$45M"
  valuationUsd: string | null;     // e.g. "~$2B (reported)"
  keyInvestors: string[];          // ["Sequoia", "Founders Fund", ...]

  // Product / fees
  feeStructure: string;            // "0.07% per side, capped at 7¢/contract"
  minPosition: string;             // "$0.01 (1 contract × $0.01–$0.99)"
  maxPosition: string;             // "Limited only by orderbook depth"
  paymentMethods: string[];        // ["ACH (Plaid)", "Debit card"]
  settlementCurrency: string;      // "USD" / "USDC (Polygon)"
  withdrawalSpeed: string;         // "1–3 business days"
  mobileApps: string;              // "iOS, Android"
  supportedMarkets: string[];      // ["NBA", "MLB", "Politics", ...]
  productCategories: string[];     // ["Sports", "Politics", "Climate", ...]

  // Editorial
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];               // "Long-term holders of MVP-style futures"
  notFor: string[];                // "Casual Sunday parlay players"

  // External refs
  officialSite: string;
  crunchbaseUrl: string | null;
  wikipediaUrl: string | null;
  twitterHandle: string | null;    // "@Kalshi"

  // SEO sources (for footnote citations)
  sources: { label: string; url: string }[];
}

// ============================================================================
// Prediction markets
// ============================================================================

const KALSHI: BrandProfile = {
  slug: "kalshi",
  name: "Kalshi",
  legalName: "KalshiEX LLC",
  category: "prediction-market",
  emoji: "🟡",
  tagline: "The federally regulated US event-contract exchange",
  oneSentence:
    "Kalshi is a CFTC-licensed Designated Contract Market (DCM) where US users buy and sell YES/NO contracts on real-world events, including sports, in all 50 states.",
  intro:
    "Founded in 2018 by MIT-trained engineers Tarek Mansour and Luana Lopes Lara, Kalshi spent three years working with the Commodity Futures Trading Commission to become the first federally regulated US event-contract exchange. Sports markets launched in late 2024 and have grown into one of the platform's largest categories alongside politics, economics, and climate.",

  founded: 2018,
  foundersText: "Tarek Mansour, Luana Lopes Lara",
  hq: "New York, NY",
  ceo: "Tarek Mansour",
  employeesText: "~150 (2025)",
  parentCompany: null,
  publicTicker: null,

  regulator: "Commodity Futures Trading Commission (CFTC)",
  regulatoryStatus:
    "Registered Designated Contract Market (DCM) — same legal classification as the CME and ICE futures exchanges. Operates under full federal oversight, with segregated customer funds and Consumer Financial Protection Bureau dispute paths.",
  statesAvailable: "All 50 US states",

  asOf: "2025-Q4",
  monthlyVolumeUsd: "~$200M+ (sports + politics combined, peaks during major events)",
  annualVolumeUsd: "$1B+ (2024 — driven by ~$430M on the US presidential market alone)",
  userCountText: "Hundreds of thousands of funded accounts (exact figure not publicly disclosed)",

  totalRaisedUsd: "$50M+ across Series A–C",
  lastRoundLabel: "Series C reported 2025",
  lastRoundUsd: "Undisclosed (Series A was $30M)",
  valuationUsd: "~$2B (reported, 2025)",
  keyInvestors: ["Sequoia Capital", "Henry Kravis (KKR co-founder)", "Charles Schwab", "Y Combinator", "SV Angel"],

  feeStructure: "0.07% per side, capped at 7¢/contract; 2¢ near 50% probability",
  minPosition: "$0.01 (1 contract × $0.01–$0.99 YES/NO)",
  maxPosition: "Limited only by orderbook depth — no per-user account caps",
  paymentMethods: ["ACH (Plaid)", "Debit card", "Wire transfer (high-volume)"],
  settlementCurrency: "USD",
  withdrawalSpeed: "1–3 business days via ACH; same-day for wire",
  mobileApps: "iOS (App Store), Android (Google Play)",
  supportedMarkets: [
    "NBA (championship, game winners, MVP, awards)",
    "NFL (championship, MVP, season totals)",
    "MLB (championship, division leaders, game winners)",
    "NHL (championship, game winners)",
    "EPL, MLS (match winners, league titles)",
    "PGA Tour (tournament winner, top 5/10/20/40, make cut, head-to-head, round leaders, props)",
    "Politics (elections, confirmations, policy)",
    "Climate (temperature records, hurricanes)",
    "Economics (CPI prints, Fed rate paths, unemployment)",
  ],
  productCategories: ["Sports", "Politics", "Climate", "Economics", "Culture", "Science"],

  strengths: [
    "Only federally regulated US prediction market — works in every state",
    "No vig / no house edge — peer-to-peer pricing",
    "USD settlement direct to bank — no crypto required",
    "No per-user limits — sharps don't get throttled the way sportsbooks throttle winners",
    "Mobile apps with full feature parity (place, trade, settle from phone)",
  ],
  weaknesses: [
    "Thinner sports market coverage than DraftKings/FanDuel on game-level props",
    "Lower liquidity on niche markets — spreads can be 5¢+ on illiquid contracts",
    "Newer to sports — settlement disputes occasionally arise on non-canonical sources",
    "Cannot place same-game parlays/combos — single-contract structure only",
  ],
  bestFor: [
    "US users in states where sportsbooks aren't licensed (CA, TX, HI)",
    "Sharp users who get limited at FanDuel/DraftKings",
    "Anyone who wants no-vig pricing on championship/MVP/season-long markets",
    "Traders who want to short an outcome (sell YES) without needing to find the opposite-side book",
  ],
  notFor: [
    "Same-game parlays / multi-leg combos",
    "In-game micro-bets (sportsbooks update faster on game state)",
    "Player-prop volume on every NBA/NFL game (book coverage is wider)",
  ],

  officialSite: "https://kalshi.com",
  crunchbaseUrl: "https://www.crunchbase.com/organization/kalshi",
  wikipediaUrl: "https://en.wikipedia.org/wiki/Kalshi",
  twitterHandle: "@Kalshi",

  sources: [
    { label: "Kalshi — About", url: "https://kalshi.com/about" },
    { label: "CFTC DCM Registry", url: "https://www.cftc.gov/IndustryOversight/TradingOrganizations/DCMs/index.htm" },
    { label: "Crunchbase: Kalshi", url: "https://www.crunchbase.com/organization/kalshi" },
    { label: "Wikipedia: Kalshi", url: "https://en.wikipedia.org/wiki/Kalshi" },
  ],
};

const POLYMARKET: BrandProfile = {
  slug: "polymarket",
  name: "Polymarket",
  legalName: "Polymarket Limited (Cayman Islands)",
  category: "prediction-market",
  emoji: "🟣",
  tagline: "The largest crypto-native global prediction market",
  oneSentence:
    "Polymarket is a peer-to-peer, USDC-settled prediction market on Polygon (Ethereum L2), known for record-breaking election market volume and broad global market coverage.",
  intro:
    "Launched in 2020 by founder Shayne Coplan (then 22), Polymarket became the largest prediction market by trading volume on the 2024 US presidential election — over $3.6B traded on the single Trump-vs-Harris market. After a 2022 CFTC settlement, the platform geo-blocks US IP addresses and operates as a non-US venue through its Cayman Islands subsidiary. Despite the restriction, it remains the dominant venue for global political, sports, and economic event contracts.",

  founded: 2020,
  foundersText: "Shayne Coplan",
  hq: "New York, NY (engineering) · Cayman Islands (legal entity)",
  ceo: "Shayne Coplan",
  employeesText: "~50 (2025)",
  parentCompany: null,
  publicTicker: null,

  regulator: "No US regulator (settled with CFTC in Jan 2022; operates outside US jurisdiction)",
  regulatoryStatus:
    "Settled with the CFTC in January 2022 for $1.4M and agreed to geo-block US users. The platform operates internationally under its Cayman Islands entity, with smart contracts running on the public Polygon network. There is no US consumer-protection framework if users circumvent the geo-block via VPN.",
  statesAvailable: "Non-US only (officially) — geo-blocked in the United States",

  asOf: "2025-Q4",
  monthlyVolumeUsd: "~$200M+ average; spikes to $1B+ on major political event months",
  annualVolumeUsd: "$8B+ in 2024 (driven by the US presidential election cycle)",
  userCountText: "~1M+ wallets transacting, ~250k+ monthly active",

  totalRaisedUsd: "$70M+ across pre-seed, Series A, Series B",
  lastRoundLabel: "Series B, May 2024",
  lastRoundUsd: "$45M",
  valuationUsd: "~$1B+ (reported Series B; later rounds may be higher)",
  keyInvestors: ["Founders Fund (Peter Thiel)", "Vitalik Buterin (angel)", "Polychain Capital", "ParaFi Capital", "1confirmation"],

  feeStructure: "0% trading fee + Polygon gas (~$0.01–$0.50 per trade)",
  minPosition: "$1 USDC (or whatever the smallest order book allows)",
  maxPosition: "Limited only by orderbook depth — no per-user account caps",
  paymentMethods: ["USDC on Polygon (bridge from any chain)", "Direct credit/debit card on-ramp via partners (international only)"],
  settlementCurrency: "USDC (Polygon network)",
  withdrawalSpeed: "Instant on-chain; off-ramp to fiat depends on partner (minutes to a few days)",
  mobileApps: "iOS (international App Store) + responsive web; no Android app as of 2025",
  supportedMarkets: [
    "US politics (elections, confirmations, policy decisions)",
    "International politics (UK, EU, India, LATAM)",
    "Sports (NFL, NBA, NHL, MLB, PGA, soccer, F1)",
    "Crypto (BTC/ETH price targets, regulatory)",
    "World events, conflicts, treaties",
    "Climate and economic indicators",
  ],
  productCategories: ["Politics", "Sports", "Crypto", "World Events", "Economics", "Culture"],

  strengths: [
    "Largest liquidity on US political and international event markets",
    "Zero trading fees — only pay Polygon gas (~pennies)",
    "Transparent on-chain order book — every trade publicly verifiable",
    "Strong API + data feed; institutional-grade tooling",
    "Backed by top-tier VCs (Founders Fund, Vitalik) and operating since 2020",
  ],
  weaknesses: [
    "Geo-blocked in the US; users circumventing via VPN violate the platform ToS and face counterparty risk",
    "Self-custodial wallets carry smart-contract + key-management risk",
    "US sports coverage is shallower than Kalshi's vertical depth",
    "USDC settlement requires crypto on-ramp — adds friction vs ACH",
    "No US consumer-protection framework for disputes",
  ],
  bestFor: [
    "Non-US traders (anywhere outside the US)",
    "Crypto-native users who already hold USDC on Polygon",
    "Anyone trading global politics or world-event markets where US books don't operate",
    "Builders / quants who need a clean public API + on-chain data",
  ],
  notFor: [
    "US residents (officially geo-blocked)",
    "Users who don't want crypto custody or wallet management",
    "Traders who need US consumer protection / regulated dispute resolution",
  ],

  officialSite: "https://polymarket.com",
  crunchbaseUrl: "https://www.crunchbase.com/organization/polymarket",
  wikipediaUrl: "https://en.wikipedia.org/wiki/Polymarket",
  twitterHandle: "@Polymarket",

  sources: [
    { label: "Polymarket — About", url: "https://polymarket.com/about" },
    { label: "CFTC Polymarket Settlement (2022)", url: "https://www.cftc.gov/PressRoom/PressReleases/8478-22" },
    { label: "Crunchbase: Polymarket", url: "https://www.crunchbase.com/organization/polymarket" },
    { label: "Wikipedia: Polymarket", url: "https://en.wikipedia.org/wiki/Polymarket" },
  ],
};

// ============================================================================
// Sportsbooks
// ============================================================================

const DRAFTKINGS: BrandProfile = {
  slug: "draftkings",
  name: "DraftKings",
  legalName: "DraftKings Inc.",
  category: "sportsbook",
  emoji: "🟢",
  tagline: "Largest US sportsbook by handle",
  oneSentence:
    "DraftKings is a publicly traded US online sportsbook and DFS operator with the deepest market coverage and highest handle in the US legal-sports-betting market.",
  intro:
    "Founded in 2012 as a daily fantasy sports operator, DraftKings pivoted aggressively into online sports betting after the 2018 PASPA repeal and is now the #1 or #2 US sportsbook by handle in nearly every legal state. Public since 2020 (NASDAQ: DKNG) via SPAC merger, the company also operates iGaming (casino), DFS contests, and a developing prediction-markets vertical via its DraftKings Pick6 product line.",

  founded: 2012,
  foundersText: "Jason Robins, Matt Kalish, Paul Liberman",
  hq: "Boston, MA",
  ceo: "Jason Robins",
  employeesText: "~5,500 (2024)",
  parentCompany: null,
  publicTicker: "NASDAQ: DKNG",

  regulator: "State gaming commissions (varies by state)",
  regulatoryStatus:
    "Licensed sportsbook operator under each state's individual gaming commission. Subject to state-by-state KYC, deposit/withdrawal rules, and responsible-gaming requirements.",
  statesAvailable: "27+ US states for sports betting (varies; check the DraftKings state coverage map for the live list)",

  asOf: "2025-Q4",
  monthlyVolumeUsd: "Handle of ~$3–4B/month (peak during NFL season)",
  annualVolumeUsd: "$40B+ annual handle reported 2024",
  userCountText: "~3M+ unique monthly active sports betting users",

  totalRaisedUsd: "Public since 2020 — no private rounds since",
  lastRoundLabel: "SPAC merger April 2020 (Diamond Eagle Acquisition Corp)",
  lastRoundUsd: "~$700M SPAC proceeds",
  valuationUsd: "Market cap typically $15–25B depending on quarter",
  keyInvestors: ["Public markets (NASDAQ)", "GSR Group (DFS-era seed)"],

  feeStructure: "Vig: ~4–5% on standard moneylines; ~10–20% house margin on parlays",
  minPosition: "$0.10 minimum bet",
  maxPosition: "Variable per market — sharps can be limited after big wins",
  paymentMethods: ["ACH", "Debit card", "PayPal", "VIP Preferred", "Online banking"],
  settlementCurrency: "USD",
  withdrawalSpeed: "1–3 business days for ACH; 1–5 business days for check",
  mobileApps: "iOS (App Store), Android (Google Play, DraftKings.com sideload in some states)",
  supportedMarkets: [
    "Every major US league (NFL, NBA, MLB, NHL, MLS, NCAA)",
    "International soccer (EPL, La Liga, Bundesliga, UCL)",
    "Tennis, golf, MMA, boxing, F1, Olympics",
    "Player props (every NBA/NFL game)",
    "Same-game parlays + live in-game betting",
    "Futures (championships, MVP, awards)",
  ],
  productCategories: ["Sports betting", "DFS contests", "iGaming/casino", "Pick6 props"],

  strengths: [
    "Largest US sports betting handle and market coverage",
    "Tightest spreads/totals on major US leagues (NBA, NFL)",
    "Wide player-prop and same-game parlay coverage",
    "Mature mobile app with live streaming, cashout, partial-cashout",
    "Frequent promo offers — boosted odds, deposit matches, no-sweat first bets",
  ],
  weaknesses: [
    "Vig averages 4–5% on moneylines, much higher on parlays",
    "Limits sharps aggressively after sustained winning",
    "State-by-state availability — not legal in CA, TX, FL, HI, AK among others",
    "Geo-restricted; you must be physically in a licensed state to place bets",
  ],
  bestFor: [
    "Recreational bettors who want broad coverage + live betting",
    "Same-game parlay players (the SGP product is best-in-class)",
    "DFS contest players who want betting in the same wallet",
  ],
  notFor: [
    "Sharps who anticipate getting limited",
    "Users in states where DK isn't licensed",
    "Traders looking for no-vig pricing on championship futures (Kalshi tends cheaper)",
  ],

  officialSite: "https://draftkings.com",
  crunchbaseUrl: "https://www.crunchbase.com/organization/draftkings",
  wikipediaUrl: "https://en.wikipedia.org/wiki/DraftKings",
  twitterHandle: "@DraftKings",

  sources: [
    { label: "DraftKings investor relations", url: "https://investors.draftkings.com" },
    { label: "Wikipedia: DraftKings", url: "https://en.wikipedia.org/wiki/DraftKings" },
    { label: "Crunchbase: DraftKings", url: "https://www.crunchbase.com/organization/draftkings" },
  ],
};

const FANDUEL: BrandProfile = {
  slug: "fanduel",
  name: "FanDuel",
  legalName: "FanDuel Group",
  category: "sportsbook",
  emoji: "🔵",
  tagline: "Largest US online sportsbook market share",
  oneSentence:
    "FanDuel is the US online sportsbook arm of Flutter Entertainment (LSE: FLTR), consistently #1 or #2 in US market share with deep coverage and aggressive new-user promos.",
  intro:
    "Founded in Edinburgh in 2009 as a daily fantasy sports operator, FanDuel was acquired by Paddy Power Betfair (now Flutter Entertainment) in 2018 and became one of the first movers in US legal sports betting after the PASPA repeal. Backed by Flutter's global sportsbook tech stack, FanDuel typically holds the #1 US online sports betting market share and operates in every state where online betting is licensed.",

  founded: 2009,
  foundersText: "Nigel Eccles, Lesley Eccles, Tom Griffiths, Rob Jones, Chris Stafford",
  hq: "New York, NY (US HQ); London (parent Flutter HQ)",
  ceo: "Amy Howe (FanDuel CEO); Peter Jackson (Flutter Group CEO)",
  employeesText: "~3,000 US (FanDuel); ~30,000 (Flutter Group)",
  parentCompany: "Flutter Entertainment plc (LSE: FLTR; NYSE: FLUT)",
  publicTicker: "Parent: NYSE: FLUT / LSE: FLTR",

  regulator: "State gaming commissions (varies by state)",
  regulatoryStatus:
    "Licensed sportsbook in each operating state. Parent Flutter is dual-listed in London + New York and subject to UK FCA + US state regulators.",
  statesAvailable: "20+ US states for online sports betting",

  asOf: "2025-Q4",
  monthlyVolumeUsd: "Handle of ~$3–4B/month (US); Flutter Group ~$30B+ globally",
  annualVolumeUsd: "FanDuel ~$45B+ annual handle (2024)",
  userCountText: "~3M+ US monthly active users",

  totalRaisedUsd: "N/A — parent Flutter is publicly traded since 2002 (FanDuel itself wholly owned)",
  lastRoundLabel: "Flutter NYSE listing January 2024",
  lastRoundUsd: "N/A — secondary listing, no new capital",
  valuationUsd: "Flutter market cap ~$30–40B; FanDuel US arm valued internally at $20B+",
  keyInvestors: ["Flutter Entertainment (100% owner)"],

  feeStructure: "Vig ~4–5% on moneylines; higher on parlays",
  minPosition: "$0.10 minimum bet",
  maxPosition: "Variable per market; sharps may face per-bet limits",
  paymentMethods: ["ACH", "Debit card", "PayPal", "Play+ prepaid", "Online banking"],
  settlementCurrency: "USD",
  withdrawalSpeed: "1–5 business days for ACH; same-day for PayPal/Play+",
  mobileApps: "iOS, Android (in licensed states)",
  supportedMarkets: [
    "Every major US league (NFL, NBA, MLB, NHL, MLS, NCAA)",
    "International soccer, tennis, golf, MMA, boxing, F1",
    "Same-game parlays + live in-game",
    "Player props (deep coverage on NFL/NBA)",
    "Futures",
  ],
  productCategories: ["Sports betting", "DFS contests", "iGaming/casino", "Horse racing (TVG)"],

  strengths: [
    "#1 or #2 US sportsbook by market share",
    "Sharp pricing on NFL/NBA mainlines + strong same-game parlay product",
    "Backed by Flutter's global tech + actuarial team",
    "Generous new-user promos (often $200+ first-bet bonus)",
    "Single app for DFS + sports + casino + horse racing",
  ],
  weaknesses: [
    "Vig + parlay margin same magnitude as DraftKings (no edge there)",
    "Limits winning users — Sharps reportedly hit caps faster than at DK",
    "State availability constrained — not in CA, TX, FL, HI, AK",
    "Limited cashout flexibility vs European Flutter properties",
  ],
  bestFor: [
    "Recreational bettors looking for the most US user-friendly app",
    "Same-game parlay players",
    "Users who want a single ecosystem for fantasy + sports + casino",
  ],
  notFor: [
    "Sharps who anticipate getting limited",
    "Users outside FanDuel's licensed footprint",
    "No-vig pricing seekers (Kalshi has zero vig structurally)",
  ],

  officialSite: "https://fanduel.com",
  crunchbaseUrl: "https://www.crunchbase.com/organization/fanduel",
  wikipediaUrl: "https://en.wikipedia.org/wiki/FanDuel",
  twitterHandle: "@FanDuel",

  sources: [
    { label: "Flutter investor relations", url: "https://www.flutter.com/investors" },
    { label: "Wikipedia: FanDuel", url: "https://en.wikipedia.org/wiki/FanDuel" },
    { label: "Crunchbase: FanDuel", url: "https://www.crunchbase.com/organization/fanduel" },
  ],
};

const BETMGM: BrandProfile = {
  slug: "betmgm",
  name: "BetMGM",
  legalName: "BetMGM, LLC",
  category: "sportsbook",
  emoji: "🟠",
  tagline: "MGM Resorts + Entain joint venture",
  oneSentence:
    "BetMGM is a joint venture between MGM Resorts International (NYSE: MGM) and Entain plc (LSE: ENT), one of the top three US online sportsbooks by handle.",
  intro:
    "BetMGM launched in 2018 as a 50/50 joint venture between MGM Resorts (the casino operator) and Entain plc (parent of Ladbrokes, Coral, partypoker). It leverages MGM's casino brand + M life Rewards loyalty program and Entain's global sportsbook trading desk. Typically #3 in US online sports betting market share behind DraftKings and FanDuel.",

  founded: 2018,
  foundersText: "Joint venture (MGM Resorts + GVC/Entain)",
  hq: "Jersey City, NJ",
  ceo: "Adam Greenblatt",
  employeesText: "~1,800 (2025)",
  parentCompany: "MGM Resorts International + Entain plc (50/50 JV)",
  publicTicker: "MGM Resorts: NYSE: MGM · Entain: LSE: ENT",

  regulator: "State gaming commissions (varies)",
  regulatoryStatus:
    "Licensed in 25+ US states. JV structure means it operates under both MGM Resorts' state casino licenses and Entain's UK/international gaming licenses.",
  statesAvailable: "25+ US states for sports betting (varies by year)",

  asOf: "2025-Q4",
  monthlyVolumeUsd: "Handle of ~$1.5–2B/month",
  annualVolumeUsd: "~$15B+ annual handle (2024)",
  userCountText: "~1.5M+ monthly active US users",

  totalRaisedUsd: "JV-funded — MGM + Entain each committed $450M initial capital",
  lastRoundLabel: "Ongoing JV capital injections",
  lastRoundUsd: "N/A",
  valuationUsd: "Entain has previously valued its 50% stake at ~$5B",
  keyInvestors: ["MGM Resorts International (50%)", "Entain plc (50%)"],

  feeStructure: "Vig ~4–5% on moneylines; standard parlay margins",
  minPosition: "$0.50 minimum bet",
  maxPosition: "Variable per market; competitive limits for non-sharps",
  paymentMethods: ["ACH", "Debit card", "PayPal", "Play+ prepaid", "M life integration"],
  settlementCurrency: "USD",
  withdrawalSpeed: "1–3 business days for ACH; instant for M life Rewards conversion",
  mobileApps: "iOS, Android",
  supportedMarkets: [
    "Every major US league",
    "International soccer, tennis, golf",
    "Same-game parlays + live in-game",
    "Comprehensive player props",
    "Futures",
  ],
  productCategories: ["Sports betting", "iGaming/casino", "Poker (in some states)"],

  strengths: [
    "Tied into MGM Resorts loyalty (M life Rewards earn on bets, redeem at any MGM property)",
    "Strong casino integration — single wallet across sports + slots + table games",
    "Backed by Entain's global trading desk (sharp pricing on European soccer)",
    "Wide state availability and frequent state-specific promos",
  ],
  weaknesses: [
    "Standard vig + parlay margin (no structural pricing edge vs Kalshi)",
    "Limits skewed against winners (industry standard)",
    "User experience can lag DK/FanDuel on app polish",
  ],
  bestFor: [
    "Users who already visit MGM properties + want loyalty earn",
    "Casino-first players who occasionally bet sports",
    "European soccer focus (Entain pricing depth)",
  ],
  notFor: [
    "Users in states where BetMGM isn't licensed",
    "No-vig seekers",
    "Sharps anticipating limits",
  ],

  officialSite: "https://sports.betmgm.com",
  crunchbaseUrl: "https://www.crunchbase.com/organization/betmgm",
  wikipediaUrl: "https://en.wikipedia.org/wiki/BetMGM",
  twitterHandle: "@BetMGM",

  sources: [
    { label: "MGM Resorts investor relations", url: "https://investors.mgmresorts.com" },
    { label: "Entain plc investor relations", url: "https://www.entaingroup.com/investors" },
    { label: "Wikipedia: BetMGM", url: "https://en.wikipedia.org/wiki/BetMGM" },
  ],
};

const CAESARS: BrandProfile = {
  slug: "caesars",
  name: "Caesars",
  legalName: "Caesars Entertainment, Inc.",
  category: "sportsbook",
  emoji: "🔴",
  tagline: "Caesars Sportsbook + Caesars Rewards integration",
  oneSentence:
    "Caesars Sportsbook is the online sports betting brand of Caesars Entertainment (NASDAQ: CZR), with deep Caesars Rewards loyalty integration across 50+ Caesars properties nationally.",
  intro:
    "Caesars Sportsbook (formerly William Hill US, rebranded in 2021) is the online sports arm of Caesars Entertainment — the largest casino-resort operator in the US. Bets earn Caesars Rewards Tier Credits, which redeem at Caesars Palace, Harrah's, Horseshoe, and other properties. Competitive market share but typically #4–5 in US online sports betting handle.",

  founded: 2021,
  foundersText: "Rebrand of William Hill US (Caesars acquired William Hill 2021)",
  hq: "Reno, NV",
  ceo: "Tom Reeg (Caesars CEO); Eric Hession (Sports VP)",
  employeesText: "~50,000 across Caesars Entertainment; ~1,000 sportsbook-specific",
  parentCompany: "Caesars Entertainment, Inc.",
  publicTicker: "NASDAQ: CZR",

  regulator: "State gaming commissions",
  regulatoryStatus:
    "Licensed in 20+ US states. Operates under each state's gaming commission framework.",
  statesAvailable: "20+ US states for sports betting",

  asOf: "2025-Q4",
  monthlyVolumeUsd: "Handle ~$800M–$1B/month",
  annualVolumeUsd: "~$10B+ annual handle",
  userCountText: "Approx. 1M+ US monthly active",

  totalRaisedUsd: "Public since 1973 — current entity post-Eldorado merger 2020",
  lastRoundLabel: "Eldorado/Caesars merger July 2020",
  lastRoundUsd: "$17.3B merger value",
  valuationUsd: "Market cap typically $5–10B",
  keyInvestors: ["Public markets (NASDAQ)"],

  feeStructure: "Vig ~4–5% on moneylines",
  minPosition: "$0.50 minimum bet",
  maxPosition: "Variable; competitive limits",
  paymentMethods: ["ACH", "Debit card", "PayPal", "Play+ prepaid", "VIP Preferred"],
  settlementCurrency: "USD",
  withdrawalSpeed: "1–5 business days for ACH",
  mobileApps: "iOS, Android (in licensed states)",
  supportedMarkets: [
    "All major US leagues",
    "Same-game parlays, live betting",
    "Player props",
    "Futures",
    "Horse racing (some states)",
  ],
  productCategories: ["Sports betting", "iGaming/casino", "Poker (some states)", "Horse racing"],

  strengths: [
    "Caesars Rewards integration — Tier Credits on every bet, redeemable across 50+ Caesars properties",
    "Competitive promos for casino-first users",
    "Strong Las Vegas brand affinity",
    "Decent line accuracy on standard markets (William Hill heritage)",
  ],
  weaknesses: [
    "Newer to digital — app polish trails DK/FD",
    "Vig + parlay margin standard (no Kalshi-style structural edge)",
    "Limited promo creativity vs competitors",
  ],
  bestFor: [
    "Users who already visit Caesars properties (Vegas/Atlantic City)",
    "Casino-first players who occasionally bet sports",
    "Steady recreational bettors who like loyalty earn",
  ],
  notFor: [
    "Sharps",
    "No-vig seekers",
    "Users in non-licensed states",
  ],

  officialSite: "https://www.caesars.com/sportsbook",
  crunchbaseUrl: "https://www.crunchbase.com/organization/caesars-entertainment",
  wikipediaUrl: "https://en.wikipedia.org/wiki/Caesars_Entertainment",
  twitterHandle: "@CaesarsSports",

  sources: [
    { label: "Caesars investor relations", url: "https://investor.caesars.com" },
    { label: "Wikipedia: Caesars Entertainment", url: "https://en.wikipedia.org/wiki/Caesars_Entertainment" },
  ],
};

const FANATICS: BrandProfile = {
  slug: "fanatics",
  name: "Fanatics",
  legalName: "Fanatics Betting and Gaming, LLC",
  category: "sportsbook",
  emoji: "⚫",
  tagline: "Fan-loyalty-driven sportsbook from the merch giant",
  oneSentence:
    "Fanatics Sportsbook launched in 2023 from sports merchandise giant Fanatics Inc., absorbing PointsBet's US operations to enter the online betting market with aggressive new-user pricing.",
  intro:
    "Fanatics Inc. — the $30B+ valuation sports merchandise company that licenses gear with every major US league — launched its sports betting arm in 2023 and acquired PointsBet's US business in 2024 to accelerate state-by-state expansion. Pitched as the first sportsbook that rewards fan loyalty across merch + tickets + bets, Fanatics is rapidly building out coverage in 20+ states.",

  founded: 2023,
  foundersText: "Michael Rubin (Fanatics founder/CEO)",
  hq: "Boca Raton, FL",
  ceo: "Matt King (Sportsbook CEO); Michael Rubin (Fanatics Inc. CEO)",
  employeesText: "~500 sportsbook-specific",
  parentCompany: "Fanatics Inc. (private)",
  publicTicker: null,

  regulator: "State gaming commissions",
  regulatoryStatus:
    "Licensed in growing list of US states. Acquired PointsBet's US licenses + customer base in May 2024.",
  statesAvailable: "20+ US states",

  asOf: "2025-Q4",
  monthlyVolumeUsd: "Handle ~$300–500M/month (rapid growth)",
  annualVolumeUsd: "~$5B+ annual handle 2025 (projected)",
  userCountText: "~500k+ monthly active and growing fast post-PointsBet absorption",

  totalRaisedUsd: "Fanatics Inc. has raised $4B+ in venture (multiple rounds)",
  lastRoundLabel: "Fanatics Inc. Series F, Dec 2022",
  lastRoundUsd: "$700M",
  valuationUsd: "Fanatics Inc. valued at $31B (Dec 2022 round)",
  keyInvestors: ["SoftBank", "MLB", "NFL", "Fidelity", "BlackRock", "Eldridge Industries"],

  feeStructure: "Vig ~4–5%; aggressive boosts and odds-improvement on home-team bets",
  minPosition: "$0.50 minimum bet",
  maxPosition: "Generous during growth phase; limits expected to tighten over time",
  paymentMethods: ["ACH", "Debit card", "PayPal", "Apple Pay", "Online banking"],
  settlementCurrency: "USD",
  withdrawalSpeed: "1–3 business days ACH; same-day for some methods",
  mobileApps: "iOS, Android",
  supportedMarkets: [
    "Every major US league (NFL, NBA, MLB, NHL, MLS, NCAA)",
    "International soccer, tennis, golf",
    "Same-game parlays",
    "Live in-game betting",
    "Player props (growing depth)",
  ],
  productCategories: ["Sports betting", "Tied to Fanatics merch + tickets (FanCash loyalty)"],

  strengths: [
    "FanCash loyalty — bets earn rewards redeemable on Fanatics merch + tickets",
    "Aggressive new-user pricing and home-team boosts",
    "Backed by Fanatics' deep league relationships",
    "Reasonable limits during the growth phase (sharps haven't been heavily limited yet)",
  ],
  weaknesses: [
    "Newest operator — line accuracy still improving on niche markets",
    "Limited futures + prop coverage vs DraftKings",
    "Mobile app stability issues reported at launch (improved by 2025)",
    "Limits expected to tighten as market share grows",
  ],
  bestFor: [
    "Fans who already shop at Fanatics + want loyalty rollover",
    "New-user promo seekers (frequent boost/match offers)",
    "Sharps who've been limited at DK/FD and want a temporary home",
  ],
  notFor: [
    "Users in non-licensed states",
    "Sharps who want long-term limit-free access (PointsBet started with high limits too)",
  ],

  officialSite: "https://sportsbook.fanatics.com",
  crunchbaseUrl: "https://www.crunchbase.com/organization/fanatics",
  wikipediaUrl: "https://en.wikipedia.org/wiki/Fanatics,_Inc.",
  twitterHandle: "@FanaticsSports",

  sources: [
    { label: "Fanatics newsroom", url: "https://about.fanatics.com" },
    { label: "Wikipedia: Fanatics", url: "https://en.wikipedia.org/wiki/Fanatics,_Inc." },
    { label: "Crunchbase: Fanatics", url: "https://www.crunchbase.com/organization/fanatics" },
  ],
};

const BETRIVERS: BrandProfile = {
  slug: "betrivers",
  name: "BetRivers",
  legalName: "Rush Street Interactive, Inc.",
  category: "sportsbook",
  emoji: "🟣",
  tagline: "Rush Street's regional sportsbook with strong loyalty",
  oneSentence:
    "BetRivers is the online sportsbook of Rush Street Interactive (NYSE: RSI), parent of the Rivers Casino chain, known for strong regional presence and the iRush Rewards loyalty program.",
  intro:
    "Launched in 2018 by Rush Street Interactive, BetRivers leverages Rush Street's casino properties (Rivers Casino in Pittsburgh, Philadelphia, Schenectady, Des Plaines, Portsmouth) and operates online sports betting in states where Rush Street holds a casino license — plus several others. Smaller national share than DK/FD but strong regional density in the Mid-Atlantic/Midwest.",

  founded: 2018,
  foundersText: "Neil Bluhm (Rush Street Gaming founder)",
  hq: "Chicago, IL",
  ceo: "Richard Schwartz",
  employeesText: "~1,500 (Rush Street Interactive)",
  parentCompany: "Rush Street Interactive, Inc.",
  publicTicker: "NYSE: RSI",

  regulator: "State gaming commissions",
  regulatoryStatus: "Licensed in 15+ US states",
  statesAvailable: "15+ US states",

  asOf: "2025-Q4",
  monthlyVolumeUsd: "Handle ~$400–600M/month",
  annualVolumeUsd: "~$5B+ annual handle",
  userCountText: "~700k+ US monthly active",

  totalRaisedUsd: "Public via SPAC merger 2020",
  lastRoundLabel: "dMY Technology SPAC merger Dec 2020",
  lastRoundUsd: "~$160M",
  valuationUsd: "Market cap typically $1–3B",
  keyInvestors: ["Public markets (NYSE)", "Rush Street Gaming"],

  feeStructure: "Vig ~4–5% on moneylines",
  minPosition: "$1 minimum bet",
  maxPosition: "Variable; competitive limits in regional markets",
  paymentMethods: ["ACH", "Debit card", "PayPal", "Play+ prepaid"],
  settlementCurrency: "USD",
  withdrawalSpeed: "1–5 business days ACH",
  mobileApps: "iOS, Android",
  supportedMarkets: [
    "All major US leagues",
    "International soccer, tennis, golf, MMA",
    "Same-game parlays, live betting",
    "Player props",
    "Futures",
  ],
  productCategories: ["Sports betting", "iGaming/casino", "Horse racing (some states)"],

  strengths: [
    "iRush Rewards loyalty — strong cashback on regular play",
    "Strong regional presence (Pittsburgh, Philly, NY)",
    "Frequent low-vig promos in launch states",
    "Competitive line pricing for a Tier-2 operator",
  ],
  weaknesses: [
    "Smaller national footprint than DK/FD",
    "Lower promo budget than the top-3 operators",
    "Mobile app less feature-rich than DK/FD",
  ],
  bestFor: [
    "Users in Rush Street Casino regional markets (Pittsburgh/Philly area)",
    "Cashback-loyalty users (iRush Rewards is competitive)",
  ],
  notFor: [
    "Users outside Rush Street's licensed states",
    "No-vig seekers",
  ],

  officialSite: "https://www.betrivers.com",
  crunchbaseUrl: "https://www.crunchbase.com/organization/rush-street-interactive",
  wikipediaUrl: "https://en.wikipedia.org/wiki/Rush_Street_Interactive",
  twitterHandle: "@BetRivers",

  sources: [
    { label: "Rush Street Interactive investor relations", url: "https://investors.rushstreetinteractive.com" },
    { label: "Wikipedia: Rush Street Interactive", url: "https://en.wikipedia.org/wiki/Rush_Street_Interactive" },
  ],
};

// ============================================================================
// Registry export
// ============================================================================

export const BRAND_PROFILES: Record<string, BrandProfile> = {
  kalshi: KALSHI,
  polymarket: POLYMARKET,
  draftkings: DRAFTKINGS,
  fanduel: FANDUEL,
  betmgm: BETMGM,
  caesars: CAESARS,
  fanatics: FANATICS,
  betrivers: BETRIVERS,
};

export function getBrandProfile(slug: string): BrandProfile | null {
  return BRAND_PROFILES[slug.toLowerCase().trim()] || null;
}

// JSON-LD Organization for any profile — used in <JsonLd> on comparison pages
// so Google AI Overviews + Perplexity can cite us with structured data.
export function brandOrganizationLd(p: BrandProfile): Record<string, unknown> {
  const sameAs = [p.crunchbaseUrl, p.wikipediaUrl, p.twitterHandle ? `https://twitter.com/${p.twitterHandle.replace(/^@/, "")}` : null].filter(Boolean) as string[];
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: p.name,
    legalName: p.legalName,
    foundingDate: String(p.founded),
    description: p.oneSentence,
    url: p.officialSite,
    sameAs,
    address: { "@type": "PostalAddress", addressLocality: p.hq.split(",")[0] || p.hq },
    parentOrganization: p.parentCompany ? { "@type": "Organization", name: p.parentCompany } : undefined,
    founder: { "@type": "Person", name: p.foundersText.split(",")[0]?.trim() },
  };
}
