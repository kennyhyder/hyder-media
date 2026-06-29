import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared Supabase service-role client for the GridCensus data API route handlers.
 * Points at the dedicated GridCensus Supabase project via SUPABASE_URL +
 * SUPABASE_SERVICE_KEY (set in grid/.env.local).
 */
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
  return _client;
}
