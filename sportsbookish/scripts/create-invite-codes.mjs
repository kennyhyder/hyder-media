#!/usr/bin/env node
// Generate invite codes for free tier memberships and print redemption URLs.
//
// Usage:
//   node scripts/create-invite-codes.mjs [--tier elite|pro|free] [--count N]
//                                        [--label "short note"] [--prefix XYZ]
//                                        [--max-uses 1] [--expires "2026-12-31"]
//
// Uses the Supabase REST API directly (no client lib) so it works on any Node
// version without needing the `ws` package.
//
// Requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_KEY
// in env or .env.local.

import { config as dotenv } from "dotenv";
import { randomBytes } from "crypto";
import { resolve } from "path";
import { execSync } from "child_process";

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

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_KEY required. Add them to .env.local.");
  process.exit(1);
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
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

// Insert via psql to bypass PostgREST schema-cache lag right after a migration.
// Falls back to REST if PG password isn't configured.
const pgPassword = process.env.PG_PASSWORD || "#FsW7iqg%EYX&G3M";
const pgHost = "aws-0-us-west-2.pooler.supabase.com";
const pgUser = "postgres.ilbovwnhrowvxjdkvrln";

function escapeSql(s) {
  if (s == null) return "NULL";
  return `'${String(s).replace(/'/g, "''")}'`;
}

const values = rows.map((r) =>
  `(${escapeSql(r.code)}, ${escapeSql(r.tier)}, ${escapeSql(r.label)}, ${r.max_uses}, ${r.expires_at ? escapeSql(r.expires_at) + "::timestamptz" : "NULL"})`
).join(",\n  ");

const sql = `INSERT INTO sb_invite_codes (code, tier, label, max_uses, expires_at) VALUES\n  ${values}\nRETURNING code, tier, max_uses, expires_at, label;`;

let stdout;
try {
  stdout = execSync(`psql -h ${pgHost} -p 6543 -U ${pgUser} -d postgres -t -A -F '|' -c "${sql.replace(/"/g, '\\"')}"`, {
    env: { ...process.env, PGPASSWORD: pgPassword },
    encoding: "utf8",
  });
} catch (e) {
  console.error("psql insert failed:", e.stderr || e.message);
  process.exit(1);
}

const data = stdout
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((line) => !line.startsWith("INSERT ") && line.includes("|"))
  .map((line) => {
    const [code, tier, max_uses, expires_at, label] = line.split("|");
    return { code, tier, max_uses: Number(max_uses), expires_at: expires_at || null, label: label || null };
  });

console.log(`\n✓ Created ${data.length} invite code${data.length === 1 ? "" : "s"} (tier: ${opts.tier}, max uses: ${opts.maxUses}${opts.label ? `, label: "${opts.label}"` : ""})\n`);
for (const row of data) {
  console.log(`  ${opts.siteUrl}/redeem/${row.code}`);
}
console.log("");
console.log("Send the URL(s) to your recipient. They click → enter email → magic-link sign in → invite tier applied automatically.\n");
