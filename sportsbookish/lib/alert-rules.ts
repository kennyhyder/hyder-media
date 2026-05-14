// Shared types + constants for alert rules. Used by API, UI, and dispatcher.

export interface AlertRule {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  sports: string[] | null;
  leagues: string[] | null;
  alert_types: string[] | null;     // 'movement' | 'edge_buy' | 'edge_sell'
  direction: "up" | "down" | null;
  min_delta: number;                // 0.03 = 3%
  min_kalshi_prob: number | null;
  max_kalshi_prob: number | null;
  channels: string[];               // 'email' | 'sms'
  preset_key: string | null;        // 'big_movers' | 'top_buys_daily' | 'sharp_action' | null = manual
  watchlist_only: boolean;          // Elite: only fire on watchlisted teams/players
  created_at: string;
  updated_at: string;
  last_fired_at: string | null;
  fire_count: number;
}

// Smart presets — one-click toggles available to Elite. Each one expands into
// a stored sb_alert_rules row with these defaults; the dispatcher reads them
// like any other rule.
export interface SmartPreset {
  key: string;
  name: string;
  description: string;
  defaults: Omit<Partial<AlertRule>, "id" | "user_id" | "created_at" | "updated_at" | "last_fired_at" | "fire_count">;
}

export const SMART_PRESETS: SmartPreset[] = [
  {
    key: "big_movers",
    name: "🚀 Big movers (≥5%)",
    description: "Any market on any sport that moves ≥5% in 15 min on Kalshi.",
    defaults: {
      name: "🚀 Big movers (≥5%)",
      enabled: true,
      alert_types: ["movement"],
      min_delta: 0.05,
      direction: null,
      channels: ["email", "sms"],
      preset_key: "big_movers",
      watchlist_only: false,
    },
  },
  {
    key: "top_buys_daily",
    name: "💰 Top buy edges (≥3%)",
    description: "Best buy opportunities — Kalshi cheaper than book consensus by ≥3%.",
    defaults: {
      name: "💰 Top buy edges (≥3%)",
      enabled: true,
      alert_types: ["edge_buy"],
      min_delta: 0.03,
      direction: "up",
      channels: ["email"],
      preset_key: "top_buys_daily",
      watchlist_only: false,
    },
  },
  {
    key: "my_watchlist",
    name: "⭐ My watchlist only",
    description: "Any move ≥2% on any team or player you've bookmarked.",
    defaults: {
      name: "⭐ My watchlist only",
      enabled: true,
      alert_types: null,
      min_delta: 0.02,
      direction: null,
      channels: ["email", "sms"],
      preset_key: "my_watchlist",
      watchlist_only: true,
    },
  },
  {
    key: "sharp_action",
    name: "📊 Sharp action (≥7%)",
    description: "Very large moves that usually indicate sharp money — ≥7% in 15 min.",
    defaults: {
      name: "📊 Sharp action (≥7%)",
      enabled: true,
      alert_types: ["movement"],
      min_delta: 0.07,
      direction: null,
      channels: ["email", "sms"],
      preset_key: "sharp_action",
      watchlist_only: false,
    },
  },
];

export interface AlertRuleInput {
  name: string;
  enabled?: boolean;
  sports?: string[] | null;
  leagues?: string[] | null;
  alert_types?: string[] | null;
  direction?: "up" | "down" | null;
  min_delta?: number;
  min_kalshi_prob?: number | null;
  max_kalshi_prob?: number | null;
  channels?: string[];
}

export const ALL_LEAGUES = [
  { key: "pga", label: "PGA Tour (Golf)", sport: "golf", icon: "⛳" },
  { key: "nba", label: "NBA", sport: "basketball", icon: "🏀" },
  { key: "mlb", label: "MLB", sport: "baseball", icon: "⚾" },
  { key: "nhl", label: "NHL", sport: "hockey", icon: "🏒" },
  { key: "epl", label: "Premier League", sport: "soccer", icon: "⚽" },
  { key: "mls", label: "MLS", sport: "soccer", icon: "⚽" },
] as const;

export const ALERT_TYPES = [
  { key: "movement", label: "Kalshi price movement", description: "Kalshi probability moved ≥X% in 15 minutes" },
  { key: "edge_buy", label: "Buy edge (Kalshi vs books)", description: "Kalshi prob below books consensus by ≥X% — cheaper to buy YES on Kalshi" },
  { key: "edge_sell", label: "Sell edge / overpriced", description: "Kalshi prob above books consensus by ≥X% — Kalshi overpriced" },
] as const;

export function validateRuleInput(input: AlertRuleInput): { ok: true; data: AlertRuleInput } | { ok: false; error: string } {
  if (!input.name || input.name.trim().length === 0) return { ok: false, error: "Name required" };
  if (input.name.length > 100) return { ok: false, error: "Name too long" };
  if (input.min_delta != null) {
    if (typeof input.min_delta !== "number" || input.min_delta <= 0 || input.min_delta > 1) {
      return { ok: false, error: "min_delta must be between 0 and 1 (e.g. 0.05 = 5%)" };
    }
  }
  if (input.direction && !["up", "down"].includes(input.direction)) return { ok: false, error: "Invalid direction" };
  if (input.channels) {
    for (const c of input.channels) {
      if (!["email", "sms"].includes(c)) return { ok: false, error: `Invalid channel: ${c}` };
    }
  }
  if (input.alert_types) {
    for (const t of input.alert_types) {
      if (!["movement", "edge_buy", "edge_sell"].includes(t)) return { ok: false, error: `Invalid alert type: ${t}` };
    }
  }
  return { ok: true, data: input };
}

// Decide whether a fired alert satisfies a rule. Used both client-side (for
// the filtered feed) and server-side (for dispatch matching).
export interface AlertMatchInput {
  source: "golf" | "sports";
  sport: string | null;      // 'golf', 'basketball', etc.
  league: string;             // 'pga', 'nba', etc.
  alert_type: "movement" | "edge_buy" | "edge_sell" | string;
  direction: string;          // 'up' | 'down' | 'buy' | 'sell'
  delta: number;              // absolute value compared against min_delta
  probability: number | null;
  contestant_key?: string;    // normalized "league:contestant_norm" for watchlist matching
}

export function alertMatchesRule(alert: AlertMatchInput, rule: AlertRule, watchlistRefs?: Set<string>): boolean {
  if (!rule.enabled) return false;

  // Watchlist filter (smart preset / Elite)
  if (rule.watchlist_only) {
    if (!watchlistRefs || watchlistRefs.size === 0) return false;
    // alert needs a contestant_norm or similar identifier — convention: we pass
    // a flat set of strings the dispatcher built from the alert payload
    if (!alert.contestant_key || !watchlistRefs.has(alert.contestant_key)) return false;
  }

  // Sport filter
  if (rule.sports && rule.sports.length > 0 && alert.sport && !rule.sports.includes(alert.sport)) {
    return false;
  }
  // League filter
  if (rule.leagues && rule.leagues.length > 0 && !rule.leagues.includes(alert.league)) {
    return false;
  }
  // Alert type filter
  if (rule.alert_types && rule.alert_types.length > 0 && !rule.alert_types.includes(alert.alert_type)) {
    return false;
  }
  // Direction
  if (rule.direction) {
    const dirMatches =
      (rule.direction === "up" && (alert.direction === "up" || alert.direction === "buy")) ||
      (rule.direction === "down" && (alert.direction === "down" || alert.direction === "sell"));
    if (!dirMatches) return false;
  }
  // Threshold
  if (Math.abs(alert.delta) < rule.min_delta) return false;
  // Prob range
  if (rule.min_kalshi_prob != null && alert.probability != null && alert.probability < rule.min_kalshi_prob) return false;
  if (rule.max_kalshi_prob != null && alert.probability != null && alert.probability > rule.max_kalshi_prob) return false;

  return true;
}
