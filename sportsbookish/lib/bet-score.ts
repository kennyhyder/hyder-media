// SportsBookISH Skill Score — composite 0-1000 rating for logged bets.
//
// Design philosophy: raw P/L is the obvious metric but a weak signal
// because variance dominates in small samples. We blend five sub-scores
// so the composite distinguishes "lucky" from "actually sharp".
//
// 1. CLV  (Closing Line Value) — 30% — best long-run skill predictor.
//    Did the market move toward your side after you bet? If yes, you
//    were ahead of the market regardless of outcome.
// 2. ROI                       — 30% — actual profit per unit staked.
// 3. Brier score (calibration) — 20% — only if user-stated probabilities
//    exist. Reward being well-calibrated forecasters.
// 4. Difficulty bonus          — 10% — reward winning long-shot bets
//    that require real edge identification, not just hammering chalk.
// 5. Sharpe-ish ratio          — 10% — risk-adjusted return.

export interface Bet {
  id: string;
  status: "pending" | "won" | "lost" | "push" | "void" | "cashed_out";
  stake_units: number;
  profit_units: number | null;
  line_american: number | null;
  line_implied_prob: number | null;
  user_stated_prob: number | null;
  closing_implied_prob: number | null;
  clv: number | null;
}

export interface SkillScore {
  total_bets: number;
  pending_bets: number;
  settled_bets: number;
  won_bets: number;
  lost_bets: number;
  push_bets: number;
  total_stake_units: number;
  total_profit_units: number;
  roi: number | null;
  win_rate: number | null;
  clv_avg: number | null;
  brier_score: number | null;
  difficulty_avg: number | null;
  sharpe_ratio: number | null;
  composite_score: number | null;          // 0-1000, null if too few bets
  skill_tier: "novice" | "casual" | "sharp" | "pro" | null;
  components: {
    roi: number;          // 0-300
    clv: number;          // 0-300
    brier: number;        // 0-200 (or 0 if no calibration data)
    difficulty: number;   // 0-100 (or 0 if no wins)
    sharpe: number;       // 0-100
  } | null;
}

const MIN_BETS_FOR_SCORE = 5;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function normalize(x: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return clamp01((x - min) / (max - min));
}

export function computeSkillScore(bets: Bet[]): SkillScore {
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost" || b.status === "push");
  const won = settled.filter((b) => b.status === "won");
  const lost = settled.filter((b) => b.status === "lost");
  const pushed = settled.filter((b) => b.status === "push");

  const totalStake = settled.reduce((s, b) => s + (b.stake_units || 0), 0);
  const totalProfit = settled.reduce((s, b) => s + (b.profit_units || 0), 0);
  const roi = totalStake > 0 ? totalProfit / totalStake : null;
  const winRate = won.length + lost.length > 0 ? won.length / (won.length + lost.length) : null;

  // CLV: per-bet log ratio of (1 - my_implied) / (1 - closing_implied) — measures odds movement
  // We use a simpler form: closing_implied_prob - line_implied_prob, where positive means the
  // closing line saw the outcome as MORE likely than your bet did (i.e. you beat the close).
  // Our `clv` column stores this delta directly.
  const withCLV = settled.filter((b) => b.clv != null);
  const clvAvg = withCLV.length > 0 ? withCLV.reduce((s, b) => s + (b.clv as number), 0) / withCLV.length : null;

  // Brier — only if user stated a probability
  const withStated = settled.filter((b) => b.user_stated_prob != null);
  let brier: number | null = null;
  if (withStated.length > 0) {
    brier = withStated.reduce((s, b) => {
      const outcome = b.status === "won" ? 1 : b.status === "lost" ? 0 : 0.5;
      const p = b.user_stated_prob as number;
      return s + Math.pow(p - outcome, 2);
    }, 0) / withStated.length;
  }

  // Difficulty — average implied prob of WON bets. Lower = harder/longer-shot wins.
  const wonWithImplied = won.filter((b) => b.line_implied_prob != null);
  const difficultyAvg = wonWithImplied.length > 0
    ? wonWithImplied.reduce((s, b) => s + (b.line_implied_prob as number), 0) / wonWithImplied.length
    : null;

  // Sharpe-ish — mean per-bet return / stddev
  const returns = settled.map((b) => (b.profit_units || 0) / (b.stake_units || 1));
  let sharpe: number | null = null;
  if (returns.length >= 3) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const sd = Math.sqrt(variance);
    sharpe = sd > 0 ? mean / sd : 0;
  }

  if (settled.length < MIN_BETS_FOR_SCORE) {
    return {
      total_bets: bets.length,
      pending_bets: bets.filter((b) => b.status === "pending").length,
      settled_bets: settled.length,
      won_bets: won.length,
      lost_bets: lost.length,
      push_bets: pushed.length,
      total_stake_units: totalStake,
      total_profit_units: totalProfit,
      roi, win_rate: winRate, clv_avg: clvAvg, brier_score: brier, difficulty_avg: difficultyAvg, sharpe_ratio: sharpe,
      composite_score: null, skill_tier: null, components: null,
    };
  }

  // Components (each 0..maxWeight)
  const roiPts = Math.round(300 * normalize(roi ?? 0, -0.2, 0.2));
  const clvPts = Math.round(300 * normalize(clvAvg ?? 0, -0.1, 0.1));
  const brierPts = brier != null ? Math.round(200 * clamp01(1 - brier * 4)) : 0; // Brier 0 = perfect, 0.25 = uninformative
  const difficultyPts = difficultyAvg != null ? Math.round(100 * clamp01(1 - difficultyAvg)) : 0;
  const sharpePts = sharpe != null ? Math.round(100 * normalize(sharpe, -2, 2)) : 50;

  const composite = roiPts + clvPts + brierPts + difficultyPts + sharpePts;
  const tier: SkillScore["skill_tier"] =
    composite >= 750 ? "pro" :
    composite >= 550 ? "sharp" :
    composite >= 350 ? "casual" : "novice";

  return {
    total_bets: bets.length,
    pending_bets: bets.filter((b) => b.status === "pending").length,
    settled_bets: settled.length,
    won_bets: won.length,
    lost_bets: lost.length,
    push_bets: pushed.length,
    total_stake_units: totalStake,
    total_profit_units: totalProfit,
    roi, win_rate: winRate, clv_avg: clvAvg, brier_score: brier, difficulty_avg: difficultyAvg, sharpe_ratio: sharpe,
    composite_score: composite, skill_tier: tier,
    components: { roi: roiPts, clv: clvPts, brier: brierPts, difficulty: difficultyPts, sharpe: sharpePts },
  };
}

// Convert American odds to implied probability (raw, includes vig)
export function americanToImplied(american: number): number {
  if (american === 0) return 0;
  if (american > 0) return 100 / (american + 100);
  return -american / (-american + 100);
}

export function americanToDecimal(american: number): number {
  if (american === 0) return 1;
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / -american;
}

// Compute profit_units from line + stake + outcome
export function computeProfit(stake: number, american: number, status: Bet["status"]): number {
  if (status === "won") {
    const decimal = americanToDecimal(american);
    return stake * (decimal - 1);
  }
  if (status === "lost") return -stake;
  if (status === "push" || status === "void") return 0;
  return 0;
}

// Skill tier display info
export const TIER_INFO: Record<NonNullable<SkillScore["skill_tier"]>, { label: string; color: string; description: string }> = {
  novice:  { label: "Novice",  color: "#6b7280", description: "Building a track record. Log a few more bets to refine your score." },
  casual:  { label: "Casual",  color: "#0ea5e9", description: "Holding your own. Some calibration to improve." },
  sharp:   { label: "Sharp",   color: "#10b981", description: "Beating the market more often than not. Keep doing what you're doing." },
  pro:     { label: "Pro",     color: "#f59e0b", description: "Top-tier closing-line value and risk-adjusted return." },
};
