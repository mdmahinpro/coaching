#!/usr/bin/env node
/* Set up ONE synthetic admin for the approved disposable project.
 *
 * Target-locked to hjzwbicauyxffrmdhvgy. Uses the supported server-side Auth
 * Admin API with email_confirm=true (never an invitation email, never a direct
 * insert into auth.users).
 *
 * Safe by construction:
 *   - never resets an existing account's password;
 *   - never promotes an unrelated user;
 *   - adds exactly one admin_users roster row for the created account;
 *   - never prints key material.
 *
 * Required env (server-side process only, never VITE_*):
 *   E2E_DISPOSABLE_SUPABASE_URL   disposable project URL
 *   SUPABASE_SERVICE_ROLE_KEY     disposable service-role key
 *   DISPOSABLE_ADMIN_EMAIL        synthetic admin email
 *   DISPOSABLE_ADMIN_PASSWORD     synthetic admin password (or hidden prompt)
 *
 * Flags:
 *   --check    validate env + target only (no network, no writes)
 */
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DISPOSABLE_PROJECT_REF = 'hjzwbicauyxffrmdhvgy';
const ORIGINAL_PROJECT_REF = 'flbvusudwszxdylxevfe';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDS_FILE = path.resolve(__dirname, '..', 'e2e', 'isolated-creds.json');

function refFromUrl(url) {
  try {
    return new URL(String(url)).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

function hiddenPrompt(label) {
  return new Promise((resolve) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      const s = String(ch);
      if (s === '\r' || s === '\n') {
        if (stdin.isTTY) stdin.setRawMode(Boolean(wasRaw));
        stdin.removeListener('data', onData);
        stdin.pause();
        process.stdout.write('\n');
        resolve(value);
      } else if (s === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      } else if (s === '\u007f' || s === '\b') {
        value = value.slice(0, -1);
      } else {
        value += s;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const url = process.env.E2E_DISPOSABLE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const checkOnly = process.argv.includes('--check');

  if (!url) fail('E2E_DISPOSABLE_SUPABASE_URL is not set.');
  const ref = refFromUrl(url);
  if (ref === ORIGINAL_PROJECT_REF) fail(`refusing original project ${ORIGINAL_PROJECT_REF}.`);
  if (ref !== DISPOSABLE_PROJECT_REF) fail(`only ${DISPOSABLE_PROJECT_REF} is approved (got ${ref ?? '<unparseable>'}).`);

  if (!serviceKey) {
    fail(
      'SUPABASE_SERVICE_ROLE_KEY is not set for the disposable project. ' +
        'Set it in this local process only (never VITE_*, never committed).'
    );
  }

  const email = process.env.DISPOSABLE_ADMIN_EMAIL;
  if (checkOnly) {
    console.log(
      JSON.stringify(
        {
          status: 'setup-config-ok',
          projectRef: ref,
          serviceKeyPresent: true,
          adminEmailPresent: Boolean(email),
          credsFilePresent: fs.existsSync(CREDS_FILE),
        },
        null,
        2
      )
    );
    return;
  }

  if (!email) fail('DISPOSABLE_ADMIN_EMAIL is not set.');
  let password = process.env.DISPOSABLE_ADMIN_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) {
      fail('DISPOSABLE_ADMIN_PASSWORD is not set and no TTY is available for a hidden prompt.');
    }
    password = await hiddenPrompt('Synthetic admin password (hidden): ');
  }
  if (!password || password.length < 12) {
    fail('synthetic admin password must be at least 12 characters.');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Look for an existing account with this email. If present, NEVER reset it.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) fail(`could not list users: ${listErr.message}`);
  const existing = (list?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());

  let userId;
  if (existing) {
    userId = existing.id;
    console.log(`user already exists for the synthetic admin email; not resetting password (id=${userId}).`);
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) fail(`CreateUser failed: ${createErr.message}`);
    userId = created?.user?.id;
    if (!userId) fail('CreateUser returned no user id.');
    console.log(`created synthetic Auth user (id=${userId}, email_confirm=true).`);
  }

  // Add exactly the matching roster entry. RLS is enabled and broad roles are
  // revoked, so this requires the service role; it is not reachable from the browser.
  const { error: rosterErr } = await admin
    .from('admin_users')
    .upsert({ user_id: userId, email }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (rosterErr) fail(`admin_users roster insert failed: ${rosterErr.message}`);
  console.log(`admin_users roster entry present for id=${userId}.`);

  // Verify BOTH: authentication (password sign-in) AND authorization (is_admin()).
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.E2E_DISPOSABLE_SUPABASE_ANON_KEY;
  if (!anonKey) fail('SUPABASE_ANON_KEY (or E2E_DISPOSABLE_SUPABASE_ANON_KEY) is needed to verify authorization.');
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authErr } = await userClient.auth.signInWithPassword({ email, password });
  if (authErr) fail(`admin authentication failed: ${authErr.message}`);
  if (!authData?.session) fail('admin authentication returned no session.');
  const { data: isAdmin, error: adminErr } = await userClient.rpc('is_admin');
  if (adminErr) fail(`is_admin() check failed: ${adminErr.message}`);
  if (isAdmin !== true) fail('account authenticated but is_admin() is not true (authorization failed).');
  await userClient.auth.signOut().catch(() => {});

  fs.writeFileSync(CREDS_FILE, JSON.stringify({ email, password }, null, 2), { mode: 0o600 });
  console.log(`verified: admin authentication AND is_admin() authorization both true.`);
  console.log(`wrote ${path.relative(process.cwd(), CREDS_FILE)} (git-ignored).`);
}

main().catch((e) => fail(String(e?.message ?? e)));
