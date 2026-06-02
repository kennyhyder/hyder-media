import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getCurrentTier } from "@/lib/tier-guard";

const ADMIN_EMAILS = new Set(["kenny@hyder.me"]);

export async function POST(req: Request) {
  const { userId, email } = await getCurrentTier();
  if (!userId || !email || !ADMIN_EMAILS.has(email)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const tweetId = url.searchParams.get("tweet_id");
  if (!tweetId) return NextResponse.json({ error: "tweet_id required" }, { status: 400 });

  const svc = createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { error } = await svc
    .from("sb_twitter_seen")
    .update({ reply_status: "manual_dismissed_by_admin" })
    .eq("tweet_id", tweetId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
