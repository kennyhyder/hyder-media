#!/usr/bin/env node
// Omicron dashboard user administration.
//
// The Supabase project is SHARED across products (Omicron, AutomateDojo,
// SportsBookISH, solar...). Access to the Omicron dashboard is granted by a
// row in omicron_users — a Supabase session alone proves nothing (see
// clients/omicron/supabase/omicron_users.sql and the 2026-07-14 incident).
//
// This script is the ONLY sanctioned way to provision Omicron logins:
//   • tags every created user with user_metadata {product:'omicron'}
//     (prevents other products' signup triggers from claiming them)
//   • writes the omicron_users membership row BEFORE any link is issued
//   • never sends a Supabase-branded email — it PRINTS the one-time link +
//     6-digit code for Kenny to deliver personally (no shared email-template
//     branding can ever leak another product's name to an Omicron employee)
//
// Usage (from repo root; reads SUPABASE_URL + SUPABASE_SERVICE_KEY from env
// or .env.local):
//   node scripts/omicron-user.mjs list
//   node scripts/omicron-user.mjs add <email> [--name "Full Name"] [--admin]
//   node scripts/omicron-user.mjs link <email>      # fresh set-password link
//   node scripts/omicron-user.mjs remove <email> [--delete-auth]
//
// MFA note: since 2026-07-29 MFA is optional — users who enroll TOTP must
// verify it each session; everyone else signs in with password only.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOGIN_URL = 'https://hyder.me/clients/omicron/login.html'; // must stay in the Supabase auth uri_allow_list

function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) return;
  for (const f of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '').trim();
      }
    } catch (_) {}
  }
}
loadEnv();
const URL = (process.env.SUPABASE_URL || '').trim();
const KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
if (!URL.includes('ilbovwnhrowvxjdkvrln')) { console.error(`Refusing: SUPABASE_URL is not the shared project (got ${URL})`); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const [, , cmd, emailArg] = process.argv;
const email = (emailArg || '').trim().toLowerCase();
const flag = (name) => process.argv.includes(name);
const opt = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };

async function findAuthUser(em) {
  // Tiny pool — paginate and match client-side.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = (data?.users || []).find(u => (u.email || '').toLowerCase() === em);
    if (hit) return hit;
    if (!data?.users?.length || data.users.length < 200) return null;
  }
  return null;
}

async function upsertMembership(user, role, displayName) {
  const { error } = await sb.from('omicron_users').upsert({
    user_id: user.id,
    email: (user.email || '').toLowerCase(),
    role,
    ...(displayName ? { display_name: displayName } : {}),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

function printCredentials(em, link, otp, isNew) {
  console.log('\n──────────────────────────────────────────────────────');
  console.log(`  ${isNew ? 'INVITE' : 'SET-PASSWORD LINK'} for ${em}`);
  console.log('──────────────────────────────────────────────────────');
  console.log('\nOne-time link (send this yourself — no Supabase email was sent):\n');
  console.log('  ' + link);
  if (otp) {
    console.log(`\nOr they can go to ${LOGIN_URL},`);
    console.log(`choose "Enter code instead", and use:  email: ${em}  code: ${otp}`);
  }
  console.log('\nFlow: link → set password → dashboard. MFA is optional (no authenticator app required).');
  console.log('Link/code is single-use and expires — re-run `link` to issue a fresh one.\n');
}

async function main() {
  if (cmd === 'list') {
    const { data: members, error } = await sb.from('omicron_users').select('*').order('created_at');
    if (error) throw error;
    console.log('\nomicron_users membership (the ONLY thing that grants dashboard access):\n');
    for (const m of members) {
      const u = await findAuthUser(m.email);
      const status = !u ? 'NO AUTH USER (!)' :
        u.last_sign_in_at ? `last sign-in ${u.last_sign_in_at.slice(0, 10)}` : 'never signed in';
      const mfa = u && (u.factors || []).some(f => f.status === 'verified') ? ' · MFA enrolled' : '';
      console.log(`  ${m.email.padEnd(36)} ${m.role.padEnd(7)} ${status}${mfa}`);
    }
    console.log('');
    return;
  }

  if (cmd === 'add' || cmd === 'link') {
    if (!email) { console.error('email required'); process.exit(1); }
    let user = await findAuthUser(email);
    const isNew = !user;
    let link, otp;

    if (cmd === 'link' && isNew) { console.error(`${email} has no auth user — use \`add\`.`); process.exit(1); }

    if (isNew) {
      // generateLink(type invite) CREATES the user. product tag is mandatory
      // on the shared pool (keeps other products' triggers off this user).
      const { data, error } = await sb.auth.admin.generateLink({
        type: 'invite', email,
        options: { data: { product: 'omicron' }, redirectTo: LOGIN_URL },
      });
      if (error) throw error;
      user = data.user; link = data.properties?.action_link; otp = data.properties?.email_otp;
    } else {
      // Existing auth user (e.g. seeded but never set up) → recovery link =
      // "set your password" flow on the omicron login.
      const { data, error } = await sb.auth.admin.generateLink({
        type: 'recovery', email,
        options: { redirectTo: LOGIN_URL },
      });
      if (error) throw error;
      link = data.properties?.action_link; otp = data.properties?.email_otp;
      // Make sure the product tag is present even on older users.
      const meta = user.user_metadata || {};
      if (meta.product !== 'omicron') {
        await sb.auth.admin.updateUserById(user.id, { user_metadata: { ...meta, product: 'omicron' } });
      }
    }

    // Membership BEFORE the link goes out — the login gate denies non-members.
    await upsertMembership(user, flag('--admin') ? 'admin' : 'member', opt('--name'));
    console.log(`✓ ${email} — auth user ${isNew ? 'created' : 'exists'} (${user.id})`);
    console.log('✓ omicron_users membership row upserted (product tag set)');
    printCredentials(email, link, otp, isNew);
    return;
  }

  if (cmd === 'remove') {
    if (!email) { console.error('email required'); process.exit(1); }
    const user = await findAuthUser(email);
    const { error } = await sb.from('omicron_users').delete().eq('email', email);
    if (error) throw error;
    console.log(`✓ membership removed — ${email} can no longer pass any Omicron gate`);
    if (user) {
      // Kill their live sessions so removal is immediate, not next-refresh.
      try {
        await fetch(`${URL}/auth/v1/admin/users/${user.id}/logout`, {
          method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
        });
        console.log('✓ active sessions revoked');
      } catch (_) { console.log('(session revoke call failed — access still blocked by gate)'); }
      if (flag('--delete-auth')) {
        const { error: delErr } = await sb.auth.admin.deleteUser(user.id);
        if (delErr) throw delErr;
        console.log('✓ auth user deleted entirely');
      } else {
        console.log('note: auth user kept (may belong to another product). Use --delete-auth to remove it.');
      }
    }
    return;
  }

  console.log('usage: node scripts/omicron-user.mjs list | add <email> [--name "..."] [--admin] | link <email> | remove <email> [--delete-auth]');
}

main().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
