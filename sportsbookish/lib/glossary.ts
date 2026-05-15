// Glossary entries powering /learn/glossary and /learn/glossary/[term].
// Each entry emits:
//   - a Wikipedia-style standalone page with full definition + example
//   - schema.org DefinedTerm JSON-LD
//   - inbound links from related entries
//
// Keep entries factually precise — these get scraped by AI answer engines
// (Perplexity, ChatGPT search, Claude). Generic content gets ignored;
// specific, citable definitions get quoted.

export interface GlossaryEntry {
  slug: string;
  title: string;
  short: string;                      // <= 200 chars, appears in meta description + index
  body: string;                       // full definition, plain markdown
  example?: string;                   // worked example with real numbers
  related?: string[];                 // slugs of related terms
  also_known_as?: string[];           // synonyms (juice/vig, etc.)
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    slug: "vig",
    title: "Vig (Vigorish)",
    also_known_as: ["juice", "hold", "margin", "overround"],
    short: "The implicit fee a sportsbook charges by pricing odds so that both sides combined imply more than 100% probability. Typical NFL/NBA moneyline vig is 4-5%; outright futures can carry 15-25%.",
    body: `Vig (short for "vigorish," also called juice, hold, margin, or overround) is the implicit commission baked into sportsbook odds. When a book lists Lakers -110 / Celtics -110, those prices imply a combined probability of about 105% — the extra 5% is the book's margin.

The book doesn't take a separate fee; the margin is hidden in the prices themselves. You only see it by adding up the implied probabilities of every outcome in a market: if they sum to more than 100%, the difference is vig.

Vig varies by market type. Game lines (moneyline, spread, total) usually carry 4-5% vig because of the high volume and tight competition between books. Player props can be 8-12%. Outright futures (championship winner, MVP) often run 15-25% because the field is wide and the book takes on more risk.

Why this matters: any sportsbook price you compare against another reference (Kalshi, another book, your own model) must be de-vigged first, otherwise you're comparing apples to oranges. The book's vig is not a probability — it's a fee.`,
    example: `DraftKings lists Lakers -110, Celtics -110. Raw implied: 0.524 + 0.524 = 1.048. The 4.8% over 100% is the vig. After de-vigging both back to a fair 50/50, you're comparing a true 50% probability to Kalshi.`,
    related: ["no-vig", "implied-probability", "moneyline"],
  },
  {
    slug: "no-vig",
    title: "No-Vig (De-Vigged) Probability",
    also_known_as: ["fair odds", "de-vigged", "novig"],
    short: "A sportsbook price with the vigorish removed, expressed as a clean probability that sums with the other side to exactly 100%. The standard reference for comparing prices across books.",
    body: `No-vig probability is the sportsbook's implied probability after removing the bookmaker's margin. It's the cleanest reference point for comparing prices between books or against an exchange like Kalshi.

The standard method is multiplicative normalization: for a two-outcome market, divide each side's raw implied probability by the sum of all sides' raw probabilities. For multi-outcome markets like outright futures (where many players compete for one slot), divide each player's raw probability by the sum across the entire field.

Example: Lakers raw implied 52.4%, Celtics raw implied 52.4%. Sum = 104.8%. Lakers no-vig = 52.4 / 104.8 = 50.0%. Celtics no-vig = 50.0%.

For multi-outcome fields, the same logic applies but the target sum varies — outright winner markets target 100%, top-5 markets target 500% (since 5 winners exist), top-10 target 1000%, etc.

No-vig probabilities are what SportsBookISH uses to compute book medians + edges versus Kalshi. Comparing raw probabilities would systematically penalize Kalshi because the book numbers include 4-25% of vig that Kalshi doesn't charge (Kalshi's fee is a flat per-contract trade fee, not built into the price).`,
    example: `Three players priced at +500, +500, +500 (raw implied 16.7% each). Sum = 50%. After de-vigging to a target 100%: each is 33.3%. The 50% margin was the vig — these are realistically 33.3% each.`,
    related: ["vig", "implied-probability", "kalshi-fees"],
  },
  {
    slug: "implied-probability",
    title: "Implied Probability",
    short: "The probability that a given price implies an outcome has of occurring. For American odds, +200 implies 33.3%, -150 implies 60%. Pure math conversion — no model needed.",
    body: `Implied probability is the probability that a betting price implies an outcome will occur, computed directly from the odds. It's a pure mathematical translation — no model or opinion is involved.

For American odds:
- Positive odds: P = 100 / (odds + 100). So +200 → 100/300 = 33.3%.
- Negative odds: P = |odds| / (|odds| + 100). So -150 → 150/250 = 60%.

For decimal odds: P = 1 / decimal_odds. So 3.0 → 1/3 = 33.3%.

Implied probability is the foundation of every edge calculation: compare the implied probability at one venue (Kalshi) to a reference (book consensus, your own model, DataGolf baseline) and the difference is your edge. Positive edge means the venue is pricing the outcome too cheaply.

Note: a single sportsbook price's raw implied probability includes vig, so it's not a true probability estimate by that book. Use de-vigged probabilities for cross-venue comparison.`,
    example: `Scottie Scheffler at +500 to win the PGA Championship. Implied = 100/600 = 16.7%. If Kalshi prices him at 12¢ (implied 12%), Kalshi is pricing him 4.7 percentage points cheaper than the book — a buy signal.`,
    related: ["no-vig", "expected-value", "vig"],
  },
  {
    slug: "expected-value",
    title: "Expected Value (EV)",
    also_known_as: ["EV", "+EV", "edge"],
    short: "The average profit (or loss) per bet over infinite repetitions, given the true probability of winning vs the price paid. A bet has +EV when the price is better than the true probability.",
    body: `Expected value is the average profit you'd realize per unit wagered if you placed the same bet an infinite number of times. The formula:

EV = (True Probability × Profit if Win) - (Probability of Loss × Amount Risked)

A bet has positive EV (+EV) when the price you're getting is better than the true probability of the outcome. For example, if a coin is truly 50/50 and someone offers you 2:1 odds on heads, your EV per $1 bet is:

(0.5 × $2) - (0.5 × $1) = $1 - $0.50 = +$0.50

Long-run, you'd net $0.50 per dollar wagered.

In practice, "true probability" is impossible to know. The best approximation we have is the no-vig consensus across many independent sportsbooks. If Kalshi prices an outcome at 40% but the book consensus says 45%, Kalshi is offering +EV on the YES side (you're paying for 40% but getting something worth 45%).

This is the heart of value betting and the only theoretically sound way to make sustained profits in betting markets. SportsBookISH surfaces +EV opportunities by comparing Kalshi's price to the de-vigged book median — the standard industry proxy for fair price.`,
    example: `Kalshi: Lakers YES at 47¢ (47% implied). Book consensus de-vigged: 55%. Edge = +8 percentage points. Net of Kalshi's ~2¢ trading fee, your EV is approximately +0.06 × $1 = +$0.06 per dollar of Kalshi YES purchased.`,
    related: ["edge", "no-vig", "kelly-criterion", "kalshi-fees"],
  },
  {
    slug: "edge",
    title: "Edge",
    short: "The percentage-point difference between a venue's implied probability and a more accurate reference probability. Positive edge means the venue is cheaper than fair — a buy signal.",
    body: `Edge measures the gap between a price you can act on and a more reliable estimate of fair value. By SportsBookISH convention:

Edge = Reference Probability - Kalshi Implied Probability

Positive edge means Kalshi is cheaper than your reference (the price is too low → BUY on Kalshi). Negative edge means Kalshi is more expensive than reference (price too high → either SELL on Kalshi or BET the same side at a cheaper book).

The reference can be:
- Books median (de-vigged) — the consensus across all sportsbooks we track. Default reference.
- Your "home book" (Pro+ feature) — your preferred book's de-vigged price. Useful if you have an account at a specific book and want edges measured against that book.
- DataGolf model — for golf only, the DataGolf strokes-gained baseline (Scratch+ subscription).

Edge is most meaningful when:
1. Multiple books agree (high book count → tighter consensus)
2. The market is liquid on Kalshi (real bids/asks, not just one-tick dust)
3. The reference is fresh (we filter out references older than 30 minutes)

A 3-percentage-point edge after Kalshi's fee is typically considered actionable; 5+ is strong.`,
    example: `Patrick Mahomes NFL MVP odds. Kalshi 22%, books median (15 books) 28%. Edge = +6 percentage points. After Kalshi's fee of ~1.5¢, net buy edge ≈ +4.5pp on a 22% market. Strong buy signal.`,
    related: ["expected-value", "no-vig", "closing-line-value"],
  },
  {
    slug: "moneyline",
    title: "Moneyline",
    also_known_as: ["ML", "h2h", "head-to-head"],
    short: "A bet on which team or contestant wins outright, regardless of margin. Listed as American odds: favorites have negative numbers (-150 means bet $150 to win $100); underdogs positive (+130 means bet $100 to win $130).",
    body: `Moneyline (or h2h on the Odds API) is the simplest sports bet: pick the winner of a game with no point spread involved. Just win the game and the bet wins.

Pricing uses American odds. Favorites get negative numbers (the amount you must risk to win $100). Underdogs get positive numbers (the amount you win on a $100 risk).

Examples:
- Lakers -150 vs Celtics +130. Lakers favored. Bet $150 on Lakers to win $100, or $100 on Celtics to win $130.
- An "even" line is +100 / -100 (or "pickem"), implying 50/50.

Moneyline markets are the most liquid sports markets because they involve the least complexity. Vig is typically 4-5% for major-sport games. Kalshi's YES contract pricing maps directly to moneyline implied probability — buy Lakers YES at 60¢ ≈ betting Lakers at -150.

For events with more than two outcomes (golf majors, championship winners), the futures market replaces moneyline.`,
    example: `Kalshi Lakers YES at 58¢ vs DraftKings Lakers -135 (de-vigged: 56%). Edge: 56 - 58 = -2pp. Kalshi is slightly more expensive — bet Lakers at DraftKings instead, or sit out.`,
    related: ["implied-probability", "futures", "spread"],
  },
  {
    slug: "spread",
    title: "Spread",
    also_known_as: ["point spread", "line", "handicap"],
    short: "A handicap applied to a favored team's final score to balance both sides at approximately 50/50. Lakers -3.5 means Lakers must win by 4+ to cover; Celtics +3.5 wins if Lakers win by 3 or fewer (or lose).",
    body: `A point spread (or handicap) adds points to the underdog's score (or subtracts from the favorite's) so that both sides become roughly equal-probability bets. The price is then typically -110 / -110 for both sides, reflecting the vig.

If the actual margin lands exactly on the spread, the bet is a "push" and your stake is returned (no win, no loss).

Half-point spreads (-3.5 instead of -3) eliminate the possibility of a push and are most common. Whole-point spreads can push, so books sometimes price them slightly differently.

For NFL the most common spreads are 3 and 7 (field goal and touchdown margins). Books pay close attention to these because games land exactly on these numbers more often than other margins, and being on the wrong side of a "key number" can be expensive.

SportsBookISH tracks spreads on Kalshi where they exist (mostly NBA + MLB run lines), plus full book consensus across DraftKings, FanDuel, BetMGM, Caesars and 10+ others.`,
    example: `Lakers -3.5 (-110) vs Celtics +3.5 (-110). Lakers must win by 4 or more to cover. Equivalent Kalshi market: "Lakers win by 4+" trading near 52¢ (because the side has small implicit edge once vig is removed).`,
    related: ["moneyline", "total", "no-vig"],
  },
  {
    slug: "total",
    title: "Total (Over / Under)",
    also_known_as: ["over/under", "O/U"],
    short: "A bet on whether the combined score of both teams will go over or under a line set by the book. Has nothing to do with who wins.",
    body: `A total (or over/under, O/U) is a bet on the combined final score of both teams. The book sets a number; you bet that the actual combined total will go OVER or UNDER it.

Like spreads, totals are usually priced -110 / -110 with the vig hidden in the price.

Half-point totals (218.5 instead of 218) prevent pushes. Whole-point totals can result in a push if the score lands exactly on the line.

NBA totals typically range 200-240. NFL totals 38-58. MLB totals 7-12 (lower because of pitching). Books offer multiple "alternate" totals at different prices — e.g., NBA O/U 220.5 at -110, but you can also take O/U 218.5 at -130 if you want a smaller line.

Totals are heavily affected by:
- Weather (NFL, MLB)
- Pace of play (NBA: high-pace teams produce more total points)
- Injuries to key offensive players
- Pitching matchups (MLB)

SportsBookISH ingests h2h, spreads, and totals from The Odds API simultaneously for every game event.`,
    example: `Lakers vs Celtics total 222.5. Over -110 / Under -110. If the game ends 115-110 (total 225), Over wins. If 110-110 (total 220), Under wins. If 112-110 (total 222), Under wins (under 222.5).`,
    related: ["spread", "moneyline", "vig"],
  },
  {
    slug: "futures",
    title: "Futures",
    short: "Bets on outcomes that resolve later in a season — championship winner, division winner, MVP, win total, etc. Vig is usually higher (15-25%) than game lines because the field is wide and the time horizon long.",
    body: `Futures bets resolve at a future date, often weeks or months after you place them. Common futures markets:

- League championship (NBA Finals winner, World Series winner, Super Bowl winner)
- Conference / division winner
- Season win total (over/under N wins)
- Individual awards (MVP, Coach of the Year, Rookie of the Year)
- Tournament outright (PGA Championship winner)

Futures markets have wider vig than game lines because:
1. The field is wider — 30 NBA teams competing for one trophy vs 2 teams in a game
2. Books take on long-duration risk (can't easily hedge an 8-month liability)
3. Public action is concentrated on a few popular names, inflating their prices

This is why Kalshi often offers better value than sportsbooks on futures: Kalshi is a pure exchange (no book vig) and contracts settle at $1 or $0 with just a small per-contract fee.

SportsBookISH groups futures under event_type values: championship, conference, division, mvp, award, win_total, playoffs, record_best, record_worst, trade.`,
    example: `Scottie Scheffler to win the 2026 Masters. DraftKings: +500 (implied 16.7%, no-vig probably ~12-13% after the field's vig). Kalshi: 12¢ YES. Kalshi is essentially fair-priced and saves you the book vig.`,
    related: ["moneyline", "implied-probability", "vig"],
  },
  {
    slug: "parlay",
    title: "Parlay",
    short: "A single bet combining multiple selections that all must win for the parlay to pay out. Pays larger but carries multiplicative vig — typically -EV for the bettor.",
    body: `A parlay combines two or more individual bets into a single wager. ALL selections (legs) must win for the parlay to pay. If even one leg loses, the entire parlay loses.

Because the legs multiply, parlays pay larger amounts than individual bets — but they also compound the vig from each leg, making most parlays significantly -EV.

Example: A 4-leg parlay of -110 bets (each ~52.4% raw implied) has true probability of (0.5)^4 ≈ 6.25% if each leg were 50/50, but pays at 12-1 odds (~7.7%). The math says you lose long-run.

There's exactly one scenario where parlays make sense: CORRELATED parlays where the legs are positively correlated and the book doesn't price the correlation correctly. Example: Same-game parlay of Lakers ML + Over total — if the Lakers are likely to win big, both legs tend to hit together. Sharp books now price correlations into same-game parlays, killing most of this edge.

SportsBookISH doesn't focus on parlays because they're a -EV product for most users. The bet tracker (Elite) records parlays you log but emphasizes single-bet skill score (CLV/ROI) over parlay results.`,
    example: `4-leg parlay of NFL -110 favorites pays about +1200 (12-1). True fair odds for 4 independent ~52.4% bets: (0.524)^4 ≈ 7.5%, requiring +1233 to break even. Vig per leg compounds — even at "fair" prices you lose 4-5% expected value per parlay.`,
    related: ["vig", "expected-value", "hedge"],
  },
  {
    slug: "prop-bet",
    title: "Prop Bet (Proposition Bet)",
    also_known_as: ["props"],
    short: "A bet on a specific outcome WITHIN a game or season, unrelated to the final score. Player props (LeBron points), team props (first to score), event props (coin toss).",
    body: `Prop bets are wagers on outcomes that occur within a game or season but don't depend on the final result. The most common categories:

- Player props: "Will Patrick Mahomes throw for over 275.5 yards?"
- Team props: "First team to score in the first half"
- Event props: "Will there be a safety in the game?"

Props are higher-vig markets than game lines (typically 8-12% vs 4-5%) because:
1. Books have less data and more uncertainty
2. Volume per market is smaller
3. The "fair" price is harder to estimate

This is also why props can be the most valuable for sharp bettors: if you can model a specific player's performance better than the book, the wider vig can be overcome by a precise opinion.

For golf, props include things like "eagle in round" or "lowest round score." For NFL/NBA, anytime touchdown scorers, player point totals, and player-vs-player matchups are most common.

SportsBookISH tracks golf props (via the golfodds_props table) and is rolling out NFL/NBA player props in 2026.`,
    example: `LeBron James over 25.5 points at -110. Implied 52.4%. If your model says he averages 28 points against this opponent's defense and you estimate 60% probability over 25.5, you have +7.6pp edge before vig.`,
    related: ["vig", "moneyline", "expected-value"],
  },
  {
    slug: "closing-line-value",
    title: "Closing Line Value (CLV)",
    also_known_as: ["CLV"],
    short: "The difference between the price you bet at and the price the market settled at by game time. Positive CLV consistently is the single best predictor of profitable long-term betting.",
    body: `Closing line value is the gap between the price you got and the closing line — the price right before the event begins, which represents the market's best estimate of true probability.

Why CLV matters: the closing line is sharper than any individual bettor's model on average, because it incorporates all sharp money + book corrections in the hours before kickoff. If you consistently bet at prices BETTER than where the market closes, you're systematically beating the market — even if the specific bets win or lose, the price you got was favorable.

Calculating CLV (one common method):
CLV % = (your_decimal_odds / closing_decimal_odds) - 1

Example: You bet Lakers -150 (decimal 1.67). Closing line: Lakers -200 (decimal 1.50). CLV = 1.67/1.50 - 1 = +11.3%. Positive — you got a better price than the market eventually agreed on.

Long-term CLV is more predictive of skill than win/loss record. A bettor with a 48% record but consistent +5% CLV is sharper than one with 52% wins but flat CLV — variance explains the win record, but only skill produces consistent CLV.

SportsBookISH's bet tracker (Elite) computes CLV for every logged bet using the close-of-market snapshot. CLV is one of the inputs to the Skill Score composite metric.`,
    example: `Bet Scottie Scheffler to win at +600 (decimal 7.0). Tournament starts; closing line is +500 (decimal 6.0). CLV = 7.0/6.0 - 1 = +16.7%. Strong positive CLV regardless of whether Scheffler wins.`,
    related: ["edge", "expected-value", "no-vig"],
  },
  {
    slug: "kelly-criterion",
    title: "Kelly Criterion",
    also_known_as: ["full Kelly", "fractional Kelly"],
    short: "A formula for optimal bet sizing that maximizes long-run bankroll growth given an edge. Full Kelly is mathematically optimal but emotionally aggressive; most pros use fractional (quarter, half) Kelly.",
    body: `The Kelly criterion is a mathematical formula for sizing bets when you have an edge. It maximizes the long-run geometric growth rate of your bankroll.

Formula:
f* = (bp - q) / b

Where:
- f* = fraction of bankroll to wager
- b = decimal odds - 1 (your profit if you win, per unit risked)
- p = true probability of winning
- q = 1 - p (probability of losing)

Example: 60% chance to win at +200 (decimal 3.0). b=2, p=0.6, q=0.4.
f* = (2 × 0.6 - 0.4) / 2 = 0.8 / 2 = 0.4 → bet 40% of bankroll.

Full Kelly produces high variance — bankrolls can swing 30-50% in normal play. Most professionals use:
- Quarter Kelly (f*/4): much smaller swings, slower growth, more sustainable
- Half Kelly (f*/2): a common middle ground

Kelly assumes you accurately know your probability p, which in practice you never do. If your p estimate is off by even a little, Kelly can recommend bet sizes that risk severe drawdown. Most pros err toward LESS than Kelly suggests, not more.

SportsBookISH's bet tracker doesn't currently auto-recommend bet sizes, but the Skill Score includes Sharpe ratio (return per unit volatility) which is a Kelly-friendly metric.`,
    example: `Edge of 5% on Kalshi at 40¢. Kelly says bet f* = (1.5 × 0.45 - 0.55) / 1.5 ≈ 8.3% of bankroll for full Kelly. Quarter Kelly: 2.1% — safer.`,
    related: ["expected-value", "edge", "bankroll-management"],
  },
  {
    slug: "kalshi-fees",
    title: "Kalshi Trading Fees",
    short: "Kalshi charges a per-contract trading fee of max(1¢, ceil(0.07 × p × (1-p) × 100)), capped at 7¢. Fees are highest near 50¢ (peak ~1.75¢) and lower at extremes.",
    body: `Kalshi is a regulated exchange, not a sportsbook. Instead of pricing in a vig, Kalshi charges an explicit per-contract trading fee. The formula:

Fee per contract = max(1¢, ceil(0.07 × p × (1-p) × 100))

Where p is the price as a fraction (0.00 to 1.00). The fee is symmetric for both buy and sell trades and is capped at 7¢ per contract.

Fee profile by price:
- 1¢: 1¢ fee (min)
- 10¢: 1¢ fee (formula gives 0.63, rounded up to 1)
- 25¢: 2¢ fee
- 50¢: 2¢ fee (peak — formula gives 1.75, rounded up to 2)
- 75¢: 2¢ fee
- 90¢: 1¢ fee
- 99¢: 1¢ fee

Compare to sportsbook vig: a 50% market with 5% vig costs you 2.5¢ per dollar even before you place any bet. Kalshi's 2¢ at the same price is competitive. For futures with 20% vig at sportsbooks, Kalshi's flat fee structure is far cheaper.

SportsBookISH computes edge "net of fee" for Pro+ users, subtracting the Kalshi fee from raw edge before recommending buy/sell. Free users see gross edge.`,
    example: `Kalshi Lakers YES at 47¢. Books no-vig consensus: 52%. Gross buy edge: +5pp. Kalshi fee at 47¢: 2¢. Net buy edge: 5 - 2/100 = +3pp. Still actionable.`,
    related: ["no-vig", "vig", "expected-value"],
  },
  {
    slug: "arbitrage",
    title: "Arbitrage",
    also_known_as: ["arb", "sure bet"],
    short: "Placing offsetting bets across multiple venues to guarantee profit regardless of outcome. Rare and short-lived in mature markets; modest in size when found.",
    body: `An arbitrage opportunity exists when the prices across multiple venues for opposite sides of a market sum to less than 100% (the implied probabilities under-count, meaning whoever wins, you've collected enough on your two bets to net positive).

Formula: An arb exists when (1/A) + (1/B) < 1, where A and B are decimal odds for opposite sides.

Example: Lakers +110 (decimal 2.10) at DraftKings, Celtics -100 (decimal 2.00) at FanDuel. 1/2.10 + 1/2.00 = 0.476 + 0.500 = 0.976. Less than 1, so an arbitrage exists. Bet $476 on Lakers + $500 on Celtics; whichever wins, you collect $1000 (vs $976 total wagered) for a 2.4% locked profit.

Arbs are rare and require:
- Accounts at multiple sportsbooks
- Fast execution (lines move in seconds)
- Modest stakes (books limit arb hunters quickly)

Cross-venue arbs between Kalshi and sportsbooks are more common because the two markets aren't tightly linked yet. As Kalshi matures, these will compress.

SportsBookISH doesn't actively recommend arbitrage but the edge tables surface big book/Kalshi disparities that are arb candidates.`,
    example: `Kalshi Celtics YES at 48¢ (implied 48%). DraftKings: Lakers -110 (de-vigged 50%). Buy Celtics YES on Kalshi for 48¢, bet Lakers at DraftKings sized to balance. Guaranteed profit (net of Kalshi fee) ≈ 0.5-1%.`,
    related: ["edge", "no-vig", "hedge"],
  },
  {
    slug: "hedge",
    title: "Hedge",
    short: "Placing a second bet on the OPPOSITE side of an existing position to lock in profit or reduce loss. Common at the end of long-running futures bets when you have a live ticket near settlement.",
    body: `A hedge is a counter-bet placed against your existing position to lock in profit or reduce variance. The classic use case: you bet a long-shot futures ticket at +5000 (e.g., a 16-seed to win March Madness), they make the title game, and you hedge by betting the favorite on the other side to guarantee profit no matter who wins.

Hedging math:
- Original bet: $100 on Underdog at +5000 → potential profit $5000
- Final game: Underdog +200 vs Favorite -250 (decimal 2.85)
- Hedge: bet $X on Favorite at -250 such that ($X × 2/5) = profit on Underdog ticket - $X
- Solving: optimal hedge locks in equal profit on both outcomes.

Hedging always reduces expected value (you're paying away some of your edge) but reduces variance. Whether it's correct depends on your bankroll size and risk tolerance relative to the bet.

Closely related to arbitrage: an arb is essentially a hedge placed simultaneously with the original bet. A hedge after the original bet has appreciated is sometimes called a "free roll" because you're locking in profit on a paid-for position.`,
    example: `Bought 1000 contracts Scheffler YES Kalshi at 8¢ = $80 risk for $1000 max profit. He's now 35¢ after R2. Hedge by selling 500 contracts at 35¢ = $175. Now risking $80-$175 = -$95 (i.e. guaranteed +$95) and still hold 500 contracts that could pay $500.`,
    related: ["arbitrage", "expected-value", "futures"],
  },
  {
    slug: "sharp-vs-square",
    title: "Sharp vs Square",
    short: "Sharp = sophisticated, model-driven, value-focused bettors who beat the market. Square = casual, narrative-driven bettors. Books treat them differently — sharps get limited; squares get courted.",
    body: `Sharp and square are sportsbook industry shorthand for sophisticated vs casual bettors.

Sharp bettors:
- Use models and probability rigor
- Bet for value (positive expected value) not entertainment
- Track closing line value as their primary skill metric
- Get limited or banned from sportsbooks quickly because they beat the books

Square bettors:
- Bet on favorites, popular teams, and parlays
- Pick based on narratives ("Lakers are due") not probability
- Don't track CLV or compare prices across books
- Get courted with bonuses, promos, and free bets because they lose long-term

The books make their money from squares and try to protect themselves from sharps via limits. The classic "sharp move" is a sudden large bet on an unpopular side, after which the line moves toward the sharp's position — sharps' bets are signal, squares' bets are noise.

Kalshi as an exchange doesn't differentiate. Sharps and squares trade against each other at the same prices, with the spread + fee being the cost. This is one reason why Kalshi often has SHARPER pricing than sportsbooks — the prices reflect actual market consensus, not book risk management against squares.

SportsBookISH's Skill Score is designed to identify sharp behavior: high CLV, positive ROI, low Brier score on closed bets.`,
    example: `Square bet: $50 parlay of 4 home favorites. Sharp bet: $200 on an under against the public lean, because the model shows pace tightening and the line drifted 1 point on light action.`,
    related: ["closing-line-value", "edge", "vig"],
  },
  {
    slug: "fade",
    title: "Fade",
    short: "To bet against a particular side, person, or trend. \"Fade the public\" = bet against whichever side the majority of bettors are taking.",
    body: `To fade is to bet the opposite of a given position. Common uses:

- "Fade the public" — bet against the side most casual bettors take. Books often shade lines toward the public to make money off the popular side, creating value on the unpopular side.
- "Fade [person]" — bet against a specific tipster/handicapper because their picks tend to lose.
- "Fade the line move" — bet against the direction the line has moved recently, on the theory that the move was overdone.

The "fade the public" strategy has a long history but doesn't work as consistently as it used to. Modern books use predictive models that price the public's bias INTO the line already, so the contrarian edge is already squeezed out for major markets.

It still works in smaller markets (low-volume props, college sports, niche futures) where the book doesn't have enough data to perfectly model bias.

SportsBookISH doesn't surface "% of public" because that data isn't reliable and isn't a sharp signal in 2026 — but movement-detection alerts (Kalshi probability moves ≥X%) often correlate with public action getting on a side, which sometimes presents a fade.`,
    example: `Kalshi shows Lakers YES at 67¢ (implied 67%). Books median: 62%. Kalshi is 5pp too expensive on Lakers vs the books — this is a fade. Sell YES (or buy NO) on Kalshi if you have an account, or bet Celtics at the books.`,
    related: ["edge", "sharp-vs-square", "closing-line-value"],
  },
  {
    slug: "bankroll-management",
    title: "Bankroll Management",
    also_known_as: ["unit sizing"],
    short: "The discipline of sizing each bet as a small, consistent fraction of your total betting bankroll. Typical sizing: 1-2% per bet. Prevents variance from wiping out a bankroll.",
    body: `Bankroll management is the practice of:
1. Defining a separate "betting bankroll" (money you can afford to lose entirely)
2. Sizing each bet as a small percentage of the bankroll
3. Adjusting size up/down as the bankroll grows/shrinks

Standard sizing: 1-2% per bet, called "1 unit." A 5-unit bet (5%) is a strong opinion. Anything over 10% is reckless even with a huge edge.

Why this matters: variance can destroy even profitable bettors who bet too big. A bettor with a true 55% win rate at -110 (about +5% ROI) can still go bankrupt if they bet 20% of bankroll per bet, because a normal losing streak compounds catastrophically. The same bettor at 2% sizing is extremely unlikely to bust.

Kelly criterion is the mathematical answer to "optimal" sizing given a known edge. In practice, fractional Kelly (quarter or half) is safer because edges aren't perfectly known.

SportsBookISH's Skill Score includes a Sharpe-style return-per-volatility metric that implicitly rewards good bankroll management. Bets that are too large relative to ROI variance hurt the score.`,
    example: `$10,000 bankroll, 1% unit = $100. Every "regular" bet: $100. Strong-opinion bet: $200-300. Never $1000+ on a single bet.`,
    related: ["kelly-criterion", "expected-value", "edge"],
  },
  {
    slug: "push",
    title: "Push",
    short: "A bet that ends in a tie because the actual result lands exactly on the line. Stake is returned with no win or loss. Most common on whole-point spreads and totals.",
    body: `A push happens when the final result of a game lands exactly on the betting line, so the bet ties. Your stake is returned; no win, no loss.

Common push scenarios:
- Spread of 3 in an NFL game, final margin exactly 3 → push.
- Total of 220 in NBA, final combined exactly 220 → push.
- Moneyline can't push (someone always wins or it's no contest, in which case the bet is voided).

Books use half-point lines (3.5, 220.5) to avoid pushes when they want to. Whole-point lines are common around "key numbers" — NFL 3 (field goal) and 7 (touchdown), NBA 5 and 10 — and books price them carefully because pushes are relatively common there.

A push is functionally similar to "no action" — your money is returned. For tracking and CLV purposes, pushes are usually excluded from win-rate calculations.

In parlays, a push leg typically reduces the parlay to one fewer leg (the parlay continues with the remaining legs). Some books treat a push leg as a loss for the entire parlay — read your book's rules.`,
    example: `Spread: Lakers -3 (-110). Final: Lakers 110, Celtics 107. Margin exactly 3 → push. Stake returned.`,
    related: ["spread", "total", "vig"],
  },
];

export const GLOSSARY_BY_SLUG: Record<string, GlossaryEntry> = Object.fromEntries(GLOSSARY.map((e) => [e.slug, e]));
