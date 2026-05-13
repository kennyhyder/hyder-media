#!/usr/bin/env node
// Generate invite codes for free tier memberships and print redemption URLs.
//
// Usage:
//   node scripts/create-invite-codes.mjs [--tier elite|pro|free] [--count N]
//                                        [--label "short note"] [--prefix XYZ]
//                                        [--max-uses 1] [--expires "2026-12-31"]
//
// Examples:
//   node scripts/create-invite-codes.mjs --count 3
//      → 3 single-use Elite codes
//
//   node scripts/create-invite-codes.mjs --tier pro --count 10 --label "press"
//      → 10 Pro codes labelled "press"
//
//   node scripts/create-invite-codes.mjs --max-uses 50 --label "newsletter"
//      → one code redeemable by 50 different people
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in env (or .env.local).

import { createClient } from "@supabase/supabase-js";
import { config as dotenv } from "dotenv";
import { randomBytes } from "crypto";
import { resolve } from "path";

dotenv({ path: resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const opts = {
  tier: "elite",
  count: 1,
  label: null,
  prefix: "",
  maxUses: 1,
  expires: null,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com",
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const v = args[i + 1];
  if (a === "--tier") { opts.tier = v; i++; }
  else if (a === "--count") { opts.count = Number(v); i++; }
  else if (a === "--label") { opts.label = v; i++; }
  else if (a === "--prefix") { opts.prefix = v.toUpperCase(); i++; }
  else if (a === "--max-uses") { opts.maxUses = Number(v); i++; }
  else if (a === "--expires") { opts.expires = new Date(v).toISOString(); i++; }
  else if (a === "--site-url") { opts.siteUrl = v; i++; }
  else if (a === "--help" || a === "-h") {
    console.log(`Usage:\n  node scripts/create-invite-codes.mjs [options]\n\nOptions:\n  --tier <elite|pro|free>   tier to grant (default: elite)\n  --count <N>               how many codes to create (default: 1)\n  --label <text>            internal label (e.g. "friends", "press")\n  --prefix <ABC>            prefix on every code (e.g. "FRIENDS")\n  --max-uses <N>            how many redemptions each code allows (default: 1)\n  --expires <YYYY-MM-DD>    expiration date (default: never)\n  --site-url <url>          override site URL for printed redemption URLs`);
    process.exit(0);
  }
}

if (!["elite", "pro", "free"].includes(opts.tier)) {
  console.error(`Invalid tier "${opts.tier}". Must be elite | pro | free.`);
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required. Add them to .env.local.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function makeCode() {
  // 12-char alphanumeric, easy to read aloud (no 0/O/1/I)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const len = 10;
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return opts.prefix ? `${opts.prefix}-${out}` : out;
}

const rows = [];
for (let i = 0; i < opts.count; i++) {
  rows.push({
    code: makeCode(),
    tier: opts.tier,
    label: opts.label,
    max_uses: opts.maxUses,
    expires_at: opts.expires,
  });
}

const { data, error } = await supabase.from("sb_invite_codes").insert(rows).select("code, tier, max_uses, expires_at, label");
if (error) {
  console.error("Insert failed:", error.message);
  process.exit(1);
}

console.log(`\n✓ Created ${data.length} invite code${data.length === 1 ? "" : "s"} (tier: ${opts.tier}, max uses: ${opts.maxUses}${opts.label ? `, label: "${opts.label}"` : ""})\n`);
for (const r of data) {
  console.log(`  ${opts.siteUrl}/redeem/${r.code}`);
}
console.log("");
console.log("Send the URL(s) to your recipient. They click → enter email → magic-link sign in → Elite is applied automatically.\n");
