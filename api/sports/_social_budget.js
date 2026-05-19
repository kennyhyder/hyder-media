// Budget tracker for the Make.com free tier (1000 ops/month, 2 ops per tweet
// = 500 tweets/month max). We budget below the ceiling so a spike day doesn't
// blow it:
//
//   MAX_POSTS_PER_MONTH = 450   (90 ops headroom — 4.5% safety margin)
//   MAX_POSTS_PER_DAY   = 18    (450/25 days = 18/day; gives 5 cushion days)
//
// We also scale the move-alert threshold dynamically. As monthly usage
// climbs, we get pickier so the remaining budget goes to bigger moves only:
//
//   <60%  burn rate → threshold = base (7%)
//   60-80%          → threshold = 9%
//   80-95%          → threshold = 11%
//   >95%            → skip alerts entirely (digest still protected)

import { createClient } from "@supabase/supabase-js";

export const MAX_POSTS_PER_DAY = 18;
export const MAX_POSTS_PER_MONTH = 450;
export const BASE_MOVE_THRESHOLD = 0.07;   // 7%

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Counts only rows that consumed a Make op (status sent OR failed; skipped
// means we never POST'd to Make's webhook so no op consumed).
export async function getBudgetState() {
  const supabase = getSupabase();
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const [{ count: todayCount }, { count: monthCount }] = await Promise.all([
    supabase
      .from("sb_social_posts")
      .select("id", { count: "exact", head: true })
      .eq("platform", "x")
      .in("status", ["sent", "failed"])
      .gte("posted_at", todayStart),
    supabase
      .from("sb_social_posts")
      .select("id", { count: "exact", head: true })
      .eq("platform", "x")
      .in("status", ["sent", "failed"])
      .gte("posted_at", monthStart),
  ]);

  const day = todayCount ?? 0;
  const month = monthCount ?? 0;
  const dayRemaining = Math.max(0, MAX_POSTS_PER_DAY - day);
  const monthRemaining = Math.max(0, MAX_POSTS_PER_MONTH - month);
  const monthBurnPct = month / MAX_POSTS_PER_MONTH;

  // Threshold scales up as monthly budget depletes
  let moveThreshold = BASE_MOVE_THRESHOLD;
  if (monthBurnPct >= 0.95) moveThreshold = 999;     // effectively skip alerts
  else if (monthBurnPct >= 0.80) moveThreshold = 0.11;
  else if (monthBurnPct >= 0.60) moveThreshold = 0.09;

  return {
    posts_today: day,
    posts_this_month: month,
    day_remaining: dayRemaining,
    month_remaining: monthRemaining,
    month_burn_pct: Number((monthBurnPct * 100).toFixed(1)),
    move_threshold: moveThreshold,
    blocked: dayRemaining <= 0 || monthRemaining <= 0,
  };
}

// Reserve 1 slot per day + 1 per month for the daily digest, so move alerts
// don't accidentally eat the slot the digest needs.
export function digestCanRun(state) {
  return state.posts_today < MAX_POSTS_PER_DAY && state.posts_this_month < MAX_POSTS_PER_MONTH;
}

// Move alerts get the budget MINUS the digest's reservation, so a digest
// always has room to fire later in the day.
export function alertCanRun(state) {
  return state.day_remaining > 1 && state.month_remaining > 1 && state.move_threshold < 1;
}
