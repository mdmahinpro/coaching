#!/usr/bin/env node
/** Promote an already-existing Supabase Auth user into admin_users. No password is accepted. Dry-run by default. */
import process from 'node:process';
import {
  assertHttpsIdentity,
  assertNoPasswordInput,
  findAuthUserByEmail,
  getAdminRosterEntry,
  insertAdminRosterEntry,
  normalizeEmail,
  normalizeUuid,
} from './lib/onboarding.mjs';

const apply = process.env.BOOTSTRAP_ADMIN_APPLY === '1';
const userId = normalizeUuid(process.env.BOOTSTRAP_ADMIN_USER_ID);
const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
const allowedProvider = process.env.BOOTSTRAP_ADMIN_ALLOWED_PROVIDER?.trim() || 'email';
const projectRef = process.env.ONBOARD_PROJECT_REF?.trim();
const environment = process.env.ONBOARD_ENVIRONMENT?.trim();
const allowedEnvironment = process.env.ONBOARD_ALLOWED_ENVIRONMENT?.trim();
const supabaseUrl = process.env.ONBOARD_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const confirmation = `ADD ${userId} ${email} TO ${projectRef}/${environment}`;

async function main(fetchImpl = fetch) {
  assertNoPasswordInput();
  const origin = assertHttpsIdentity({ supabaseUrl, projectRef, environment, allowedEnvironment, serviceRoleKey });
  if (apply && process.env.BOOTSTRAP_ADMIN_CONFIRM !== confirmation) {
    throw new Error(`Apply requires exact BOOTSTRAP_ADMIN_CONFIRM=${JSON.stringify(confirmation)}`);
  }

  const user = await findAuthUserByEmail(fetchImpl, {
    origin, serviceRoleKey, userId, email, allowedProvider,
  });
  const existing = await getAdminRosterEntry(fetchImpl, { origin, serviceRoleKey, userId: user.id });
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    projectRef,
    environment,
    userId,
    email,
    approvedProvider: allowedProvider,
    authUserExists: true,
    alreadyAdmin: Boolean(existing),
    passwordAccepted: false,
    changed: false,
  };

  if (!apply) {
    report.nextStep = existing ? 'No change needed.' : `Review identity, then rerun with BOOTSTRAP_ADMIN_APPLY=1 and exact confirmation: ${confirmation}`;
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!existing) {
    const inserted = await insertAdminRosterEntry(fetchImpl, { origin, serviceRoleKey, user });
    if (!inserted || inserted.user_id !== user.id) throw new Error('Admin roster insert could not be verified');
    report.changed = true;
  }
  report.status = report.changed ? 'admin-added' : 'already-admin';
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(`First-admin bootstrap failed: ${error.message}`); process.exitCode = 1; });
}

export { main };
