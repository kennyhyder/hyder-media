#!/usr/bin/env node

/**
 * CLI tool for managing SolarTrack demo access tokens.
 *
 * Usage:
 *   node scripts/create-demo-token.js --label "Blue Water Battery - John" --days 30
 *   node scripts/create-demo-token.js --list
 *   node scripts/create-demo-token.js --revoke TOKEN
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

async function createToken() {
  const label = getArg("label");
  if (!label) {
    console.error("Usage: --label \"Description\" [--days N] [--daily-limit N] [--hourly-limit N]");
    process.exit(1);
  }

  const days = parseInt(getArg("days") || "0");
  const dailyLimit = parseInt(getArg("daily-limit") || "200");
  const hourlyLimit = parseInt(getArg("hourly-limit") || "50");
  const token = randomBytes(18).toString("base64url").slice(0, 24);
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;

  const { data, error } = await supabase
    .from("solar_demo_tokens")
    .insert({
      token,
      label,
      expires_at: expiresAt,
      daily_limit: dailyLimit,
      hourly_limit: hourlyLimit,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating token:", error.message);
    process.exit(1);
  }

  console.log("\nDemo token created:");
  console.log(`  Token:    ${data.token}`);
  console.log(`  Label:    ${data.label}`);
  console.log(`  Expires:  ${data.expires_at ? new Date(data.expires_at).toLocaleDateString() : "Never"}`);
  console.log(`  Limits:   ${dailyLimit}/day, ${hourlyLimit}/hour`);
  console.log(`\n  Login URL: https://hyder.me/solar/password.html`);
  console.log(`  (Enter the token as the access code)`);
}

async function listTokens() {
  const { data, error } = await supabase
    .from("solar_demo_tokens")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log("No demo tokens found.");
    return;
  }

  console.log(`\n${data.length} demo token(s):\n`);
  for (const t of data) {
    const expired = t.expires_at && new Date(t.expires_at) < new Date();
    const status = !t.is_active ? "REVOKED" : expired ? "EXPIRED" : "ACTIVE";
    console.log(`  [${status}] ${t.token}`);
    console.log(`    Label:   ${t.label}`);
    console.log(`    Created: ${new Date(t.created_at).toLocaleDateString()}`);
    console.log(`    Expires: ${t.expires_at ? new Date(t.expires_at).toLocaleDateString() : "Never"}`);
    console.log(`    Limits:  ${t.daily_limit}/day, ${t.hourly_limit}/hour`);
    console.log();
  }
}

async function revokeToken() {
  const token = getArg("revoke") || args[args.indexOf("--revoke") + 1];
  if (!token) {
    console.error("Usage: --revoke TOKEN");
    process.exit(1);
  }

  const { data, error } = await supabase
    .from("solar_demo_tokens")
    .update({ is_active: false })
    .eq("token", token)
    .select()
    .single();

  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }

  console.log(`Token revoked: ${data.token} (${data.label})`);
}

if (args.includes("--list")) {
  await listTokens();
} else if (args.includes("--revoke")) {
  await revokeToken();
} else {
  await createToken();
}
