// Server-side event tracker. Drop-in for server components + route
// handlers. Writes to sb_user_events using the service-role client (the
// table is RLS-protected so the regular SSR client can't write).
//
// Fire-and-forget pattern — failures are swallowed so a tracking outage
// never blocks the user's request.

import { createClient } from "@supabase/supabase-js";

export type TrackedEvent =
  | "signup"
  | "login"
  | "page_view"
  | "event_view"
  | "league_view"
  | "contestant_view"
  | "positive_ev_view"
  | "movers_view"
  | "pricing_view"
  | "sportsbooks_view"
  | "subscription_started"
  | "subscription_canceled"
  | "paywall_hit"
  | "bet_logged"
  | "alert_created"
  | "preference_changed"
  | "settings_view";

export interface TrackPayload {
  userId: string;
  event: TrackedEvent;
  sport?: string | null;
  marketType?: string | null;
  props?: Record<string, unknown>;
}

let serviceClient: ReturnType<typeof createClient> | null = null;

function getServiceClient() {
  if (serviceClient) return serviceClient;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  serviceClient = createClient(url, key, { auth: { persistSession: false } });
  return serviceClient;
}

export async function trackEvent({ userId, event, sport, marketType, props }: TrackPayload): Promise<void> {
  if (!userId) return;
  const client = getServiceClient();
  if (!client) return;
  try {
    // Supabase types this insert as the generic `never[]` shape — cast to
    // unblock until we regenerate types.
    await (client.from("sb_user_events") as unknown as { insert: (row: unknown) => Promise<unknown> }).insert({
      user_id: userId,
      event_name: event,
      sport: sport ?? null,
      market_type: marketType ?? null,
      props: props ?? {},
    });
  } catch {
    // Tracker must never break the page render
  }
}

// Convenience wrapper that no-ops for anonymous visitors.
export async function trackIfUser(
  userId: string | null | undefined,
  event: TrackedEvent,
  extra?: { sport?: string | null; marketType?: string | null; props?: Record<string, unknown> },
): Promise<void> {
  if (!userId) return;
  await trackEvent({ userId, event, ...extra });
}
