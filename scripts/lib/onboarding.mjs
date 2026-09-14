import fs from 'node:fs/promises';
import path from 'node:path';
import { checksumFile, loadManifest, migrationsDir, root } from './provisioning.mjs';

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_NAMES = ['PASSWORD', 'ADMIN_PASSWORD', 'BOOTSTRAP_PASSWORD', 'SUPABASE_PASSWORD'];

export function assertNoPasswordInput(env = process.env, argv = process.argv.slice(2)) {
  const supplied = PASSWORD_NAMES.find((name) => env[name]);
  if (supplied || argv.some((arg) => /password/i.test(arg))) {
    throw new Error('Password input is forbidden: create the user in Supabase Auth separately');
  }
}

export function assertHttpsIdentity({ supabaseUrl, projectRef, environment, allowedEnvironment, serviceRoleKey }) {
  if (!supabaseUrl || !projectRef || !environment || !allowedEnvironment || !serviceRoleKey) {
    throw new Error('Supabase URL, service-role key, project ref, environment, and allowed environment are required');
  }
  if (!PROJECT_REF_RE.test(projectRef)) throw new Error('Project ref must be the exact 20-character Supabase ref');
  if (environment !== allowedEnvironment) throw new Error('Environment identity mismatch');
  const url = new URL(supabaseUrl);
  if (url.protocol !== 'https:' || url.origin !== `https://${projectRef}.supabase.co` || url.href !== `${url.origin}/`) {
    throw new Error('Supabase URL must be the exact HTTPS origin for the declared project ref');
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Strict TLS is required; NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden');
  }
  return url.origin;
}

export function normalizeEmail(email) {
  const value = email?.trim().toLowerCase();
  if (!value || !EMAIL_RE.test(value)) throw new Error('A valid existing Supabase Auth user email is required');
  return value;
}

export function normalizeUuid(userId) {
  const value = userId?.trim().toLowerCase();
  if (!value || !UUID_RE.test(value)) throw new Error('BOOTSTRAP_ADMIN_USER_ID must be an exact UUID');
  return value;
}

export function assertBootstrapAuthUser(user, { userId, email, allowedProvider = 'email' }) {
  if (!user || user.id !== userId || user.email !== email) {
    throw new Error('Auth user UUID/email did not exactly match the declared bootstrap identity');
  }
  if (!user.email_confirmed_at) throw new Error('Bootstrap Auth user email is not confirmed');
  if (user.email_change || user.new_email || user.email_change_sent_at) {
    throw new Error('Bootstrap Auth user has a pending email change');
  }
  const approvedIdentity = Array.isArray(user.identities) && user.identities.some((identity) => (
    identity?.provider === allowedProvider
    && identity?.user_id === userId
    && identity?.identity_data?.email === email
  ));
  if (!approvedIdentity) {
    throw new Error(`Bootstrap Auth user lacks the approved ${allowedProvider} identity for the exact email`);
  }
  return user;
}

export function secretHeaders(serviceRoleKey, extra = {}) {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, ...extra };
}

export async function responseJson(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return text ? JSON.parse(text) : null;
}

export async function findAuthUserByEmail(fetchImpl, {
  origin, serviceRoleKey, userId, email, allowedProvider = 'email',
}) {
  const wantedId = normalizeUuid(userId);
  const wantedEmail = normalizeEmail(email);
  const matches = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = `${origin}/auth/v1/admin/users?page=${page}&per_page=1000`;
    const payload = await responseJson(await fetchImpl(url, { headers: secretHeaders(serviceRoleKey) }), 'Auth user lookup');
    const users = Array.isArray(payload) ? payload : (payload?.users ?? []);
    matches.push(...users.filter((user) => user?.id === wantedId || user?.email === wantedEmail));
    if (users.length < 1000) break;
  }
  if (matches.length === 0) throw new Error('No existing Supabase Auth user matches that exact UUID/email');
  if (matches.length !== 1) throw new Error('Auth user UUID/email lookup was not unique');
  return assertBootstrapAuthUser(matches[0], { userId: wantedId, email: wantedEmail, allowedProvider });
}

export async function getAdminRosterEntry(fetchImpl, { origin, serviceRoleKey, userId }) {
  const url = `${origin}/rest/v1/admin_users?select=user_id,email&user_id=eq.${encodeURIComponent(userId)}`;
  const rows = await responseJson(await fetchImpl(url, { headers: secretHeaders(serviceRoleKey) }), 'Admin roster lookup');
  return rows?.[0] ?? null;
}

export async function insertAdminRosterEntry(fetchImpl, { origin, serviceRoleKey, user }) {
  const response = await fetchImpl(`${origin}/rest/v1/admin_users`, {
    method: 'POST',
    headers: secretHeaders(serviceRoleKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify({ user_id: user.id, email: user.email }),
  });
  const rows = await responseJson(response, 'Admin roster insert');
  return rows?.[0] ?? null;
}

export async function expectedMigrationLedger() {
  const manifest = await loadManifest();
  const baselinePath = path.join(root, manifest.baseline.file);
  const entries = [{ version: manifest.baseline.file, sha256: await checksumFile(baselinePath) }];
  for (const migration of manifest.migrations) {
    entries.push({ version: migration.file, sha256: await checksumFile(path.join(migrationsDir, migration.file)) });
  }
  return { manifest, entries };
}

export function compareLedger(expected, found) {
  const byVersion = new Map((found ?? []).map((row) => [row.version, row.sha256]));
  const missing = expected.filter((entry) => !byVersion.has(entry.version)).map((entry) => entry.version);
  const mismatched = expected.filter((entry) => byVersion.has(entry.version) && byVersion.get(entry.version) !== entry.sha256).map((entry) => entry.version);
  return { ok: missing.length === 0 && mismatched.length === 0, expectedCount: expected.length, foundCount: found?.length ?? 0, missing, mismatched };
}

export async function tableCount(fetchImpl, { origin, serviceRoleKey, table }) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Unsafe table identifier: ${table}`);
  const response = await fetchImpl(`${origin}/rest/v1/${table}?select=*`, {
    method: 'HEAD',
    headers: secretHeaders(serviceRoleKey, { Prefer: 'count=exact', Range: '0-0' }),
  });
  if (!response.ok) throw new Error(`Business table check failed for ${table} with HTTP ${response.status}`);
  const range = response.headers.get('content-range');
  const count = Number(range?.split('/')[1]);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Business table count unavailable for ${table}`);
  return count;
}

export function prerequisiteReport(env = process.env, configurations = [], credentialRows = []) {
  const active = configurations.filter((row) => row.enabled === true).map((row) => {
    const encryptedCredential = credentialRows.some((credential) => credential.channel === row.channel
      && credential.provider_name === row.provider_name && credential.config_revision === row.config_revision);
    const environmentFallback = row.provider_name === 'mim'
      ? Boolean(env.SMS_API_KEY)
      : row.provider_name === 'resend' ? Boolean(env.RESEND_API_KEY) : false;
    const credentialConfigured = encryptedCredential || environmentFallback;
    const metadataConfigured = Boolean(row.provider_config && row.provider_config.providerName === row.provider_name);
    return { channel: row.channel, providerName: row.provider_name, configRevision: row.config_revision, metadataConfigured, credentialConfigured, ready: metadataConfigured && credentialConfigured };
  });
  return {
    active,
    ready: active.length > 0 && active.every((provider) => provider.ready),
    encryptedCredentialBooleansOnly: true,
    liveDeliveryVerified: false,
    note: 'Readiness follows only enabled provider rows. Built-in environment credentials are fallback; custom providers require an encrypted credential version.',
  };
}

export async function localMigrationFilesPresent(entries) {
  const missing = [];
  for (const entry of entries) {
    const file = entry.version.startsWith('supabase/') ? path.join(root, entry.version) : path.join(migrationsDir, entry.version);
    try { await fs.access(file); } catch { missing.push(entry.version); }
  }
  return { ok: missing.length === 0, missing };
}
