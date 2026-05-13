import { createClient } from "@/lib/supabase/server";
import type { TierKey } from "./tiers";

/**
 * Server-side helper: resolve the current user's tier from the
 * sb_subscriptions table. Defaults to "free" for anonymous visitors or
 * subscriptions that aren't currently active.
 *
 * Use this in every server component / API route that gates data.
 */
export async function getCurrentTier(): Promise<{ tier: TierKey; userId: string | null; email: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { tier: "free", userId: null, email: null };

  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("tier, status")
    .eq("user_id", user.id)
    .maybeSingle();

  const active = sub?.status === "active" || sub?.status === "trialing";
  const tier = (active ? (sub?.tier as TierKey) : "free") as TierKey;
  return { tier, userId: user.id, email: user.email || null };
}

/**
 * Free tier sees only the "win" market type. Pro and Elite see everything.
 */
export function canSeeMarket(tier: TierKey, marketType: string): boolean {
  if (tier === "free") return marketType === "win";
  return true;
}

/**
 * Filter an array of market objects by tier — handy for any
 * comparison-API consumer in sportsbookish.
 */
export function filterMarketsByTier<T extends { market_type: string }>(items: T[], tier: TierKey): T[] {
  return items.filter((it) => canSeeMarket(tier, it.market_type));
}

/**
 * Tier-aware "what counts in the median" — Pro+ users can exclude books.
 * Free tier: no filtering; everyone gets the same default.
 */
export function applyBookFilter<T extends { book: string }>(
  items: T[],
  tier: TierKey,
  excludedBooks: string[] | null | undefined
): T[] {
  if (tier === "free" || !excludedBooks?.length) return items;
  const set = new Set(excludedBooks);
  return items.filter((b) => !set.has(b.book));
}

/**
 * Get the user's preferences (home_book, excluded_books, etc.) — only
 * meaningful for authenticated users. Returns sensible defaults for free.
 */
export async function getUserPreferences(): Promise<{
  home_book: string | null;
  excluded_books: string[];
  alert_thresholds: Record<string, unknown>;
  notification_channels: string[];
  sms_phone: string | null;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { home_book: null, excluded_books: [], alert_thresholds: {}, notification_channels: [], sms_phone: null };
  }
  const { data } = await supabase
    .from("sb_user_preferences")
    .select("home_book, excluded_books, alert_thresholds, notification_channels, sms_phone")
    .eq("user_id", user.id)
    .maybeSingle();
  return {
    home_book: data?.home_book ?? null,
    excluded_books: data?.excluded_books ?? [],
    alert_thresholds: (data?.alert_thresholds as Record<string, unknown>) ?? {},
    notification_channels: data?.notification_channels ?? ["email"],
    sms_phone: data?.sms_phone ?? null,
  };
}
