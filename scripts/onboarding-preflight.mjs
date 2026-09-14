#!/usr/bin/env node
/** Read-only customer handover preflight. It never writes and never prints secrets. */
import fs from 'node:fs/promises';
import process from 'node:process';
import {
  assertHttpsIdentity,
  compareLedger,
  expectedMigrationLedger,
  findAuthUserByEmail,
  getAdminRosterEntry,
  localMigrationFilesPresent,
  normalizeEmail,
  normalizeUuid,
  prerequisiteReport,
  responseJson,
  secretHeaders,
  tableCount,
} from './lib/onboarding.mjs';

const EXTRA_FRESH_BUSINESS_TABLES = [
  'contact_messages', 'notice_reads', 'exam_tokens', 'login_attempts',
  'public_form_rate_events', 'message_jobs', 'message_deliveries', 'message_attempts',
];
const SITE_SETTING_DEFAULTS = {
  coaching_short_name: 'TLY',
  class_levels: 'Class 6,Class 7,Class 8,JSC,Class 9,Class 10,SSC,Class 11,Class 12,HSC,IELTS,Admission Test',
};
const MESSAGING_DEFAULTS = {
  sms: { provider_name: 'mim', enabled: false, max_attempts: 5, base_retry_seconds: 60, lease_seconds: 120 },
  email: { provider_name: 'resend', enabled: false, max_attempts: 5, base_retry_seconds: 60, lease_seconds: 120 },
};
const SECRET_SHAPED_NAME_RE = /(secret|token|password|api.?key|credential|username)/i;
const SECRET_SHAPED_VALUE_RE = /(^|[^a-z])(whsec_|re_[A-Za-z0-9]|bearer\s|basic\s|password|api.?key|credential|secret|token)([^a-z]|$)/i;

function validateSeededConfiguration(siteRows = [], messagingRows = []) {
  const siteKeys = new Map(siteRows.map((row) => [row.key, row.value]));
  const siteColumns = ['id', 'key', 'value', 'updated_at'];
  const siteSettings = {
    exactDefaults: siteRows.length === Object.keys(SITE_SETTING_DEFAULTS).length
      && Object.entries(SITE_SETTING_DEFAULTS).every(([key, value]) => siteKeys.get(key) === value),
    secretShapedColumnsAbsent: siteRows.every((row) => Object.keys(row).every((name) => !SECRET_SHAPED_NAME_RE.test(name))),
    secretShapedValuesAbsent: siteRows.every((row) => Object.values(row).every((value) => typeof value !== 'string' || !SECRET_SHAPED_VALUE_RE.test(value))),
    expectedColumnsOnly: siteRows.every((row) => Object.keys(row).every((name) => siteColumns.includes(name))),
    rowCount: siteRows.length,
  };
  const expectedColumns = ['channel', 'provider_name', 'enabled', 'provider_config', 'config_revision', 'max_attempts', 'base_retry_seconds', 'lease_seconds', 'created_at', 'updated_at'];
  const byChannel = new Map(messagingRows.map((row) => [row.channel, row]));
  const exactRows = messagingRows.length <= 2 && messagingRows.every((row) => {
    const config = row.provider_config;
    const channelCompatible = row.provider_name === 'custom'
      || (row.channel === 'sms' && row.provider_name === 'mim')
      || (row.channel === 'email' && row.provider_name === 'resend');
    return channelCompatible && config && typeof config === 'object'
      && config.providerName === row.provider_name
      && /^[0-9a-f-]{36}$/i.test(row.config_revision)
      && [true, false].includes(row.enabled)
      && Number.isInteger(row.max_attempts) && Number.isInteger(row.base_retry_seconds) && Number.isInteger(row.lease_seconds);
  });
  const messagingConfiguration = {
    exactSupportedRows: exactRows,
    supportedProviders: exactRows,
    secretShapedColumnsAbsent: messagingRows.every((row) => Object.keys(row).every((name) => !SECRET_SHAPED_NAME_RE.test(name))),
    secretShapedValuesAbsent: messagingRows.every((row) => Object.values(row).every((value) => typeof value !== 'string' || !SECRET_SHAPED_VALUE_RE.test(value))),
    selectedColumnsOnly: messagingRows.every((row) => Object.keys(row).every((name) => expectedColumns.includes(name))),
    rowCount: messagingRows.length,
  };
  siteSettings.ok = siteSettings.exactDefaults && siteSettings.secretShapedColumnsAbsent
    && siteSettings.secretShapedValuesAbsent && siteSettings.expectedColumnsOnly;
  messagingConfiguration.ok = messagingConfiguration.exactSupportedRows
    && messagingConfiguration.secretShapedColumnsAbsent
    && messagingConfiguration.secretShapedValuesAbsent
    && messagingConfiguration.selectedColumnsOnly;
  return { siteSettings, messagingConfiguration, ok: siteSettings.ok && messagingConfiguration.ok };
}

async function evidenceFilePresent(file, label) {
  if (!file?.trim()) {
    return { present: false };
  }
  try {
    const stat = await fs.stat(file.trim());
    return { present: stat.isFile() && stat.size > 0 };
  } catch {
    return { present: false, error: `${label} file is missing or unreadable` };
  }
}

async function handoverEvidenceReport(env) {
  const [resendVerification, mimApproval, independentBackup, smsLiveDelivery, emailLiveDelivery] = await Promise.all([
    evidenceFilePresent(env.ONBOARD_RESEND_VERIFICATION_EVIDENCE_FILE, 'Resend verification evidence'),
    evidenceFilePresent(env.ONBOARD_MIM_APPROVAL_EVIDENCE_FILE, 'MIM approval evidence'),
    evidenceFilePresent(env.ONBOARD_INDEPENDENT_BACKUP_EVIDENCE_FILE, 'Independent backup evidence'),
    evidenceFilePresent(env.ONBOARD_SMS_LIVE_DELIVERY_EVIDENCE_FILE, 'SMS live-delivery evidence'),
    evidenceFilePresent(env.ONBOARD_EMAIL_LIVE_DELIVERY_EVIDENCE_FILE, 'Email live-delivery evidence'),
  ]);
  return {
    workerConfigured: Boolean(env.MESSAGING_WORKER_SECRET),
    cronConfigured: Boolean(env.CRON_SECRET),
    resendVerification,
    mimApproval,
    independentBackup,
    liveDelivery: { sms: smsLiveDelivery, email: emailLiveDelivery },
  };
}

async function main(fetchImpl = fetch, env = process.env) {
  const projectRef = env.ONBOARD_PROJECT_REF?.trim();
  const environment = env.ONBOARD_ENVIRONMENT?.trim();
  const origin = assertHttpsIdentity({
    supabaseUrl: env.ONBOARD_SUPABASE_URL?.trim(), projectRef, environment,
    allowedEnvironment: env.ONBOARD_ALLOWED_ENVIRONMENT?.trim(),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  });
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  let firstAdminEmail = null;
  let firstAdminUserId = null;
  try {
    firstAdminEmail = normalizeEmail(env.BOOTSTRAP_ADMIN_EMAIL);
    firstAdminUserId = normalizeUuid(env.BOOTSTRAP_ADMIN_USER_ID);
  } catch { /* reported as not ready below */ }
  const { manifest, entries } = await expectedMigrationLedger();
  const localFiles = await localMigrationFilesPresent(entries);
  const ledger = await responseJson(await fetchImpl(
    `${origin}/rest/v1/provisioning_migrations?select=version,sha256&order=version.asc`,
    { headers: secretHeaders(serviceRoleKey) },
  ), 'Migration ledger lookup');
  const migrationLedger = compareLedger(entries, ledger);

  const tables = [...new Set([...manifest.verification.businessTables, ...EXTRA_FRESH_BUSINESS_TABLES])].sort();
  const counts = {};
  for (const table of tables) {
    counts[table] = await tableCount(fetchImpl, { origin, serviceRoleKey, table });
  }
  const emptyBusinessTables = { ok: Object.values(counts).every((count) => count === 0), counts };

  const configurationHeaders = { headers: secretHeaders(serviceRoleKey) };
  const [siteRows, messagingRows, credentialRows, buckets] = await Promise.all([
    responseJson(await fetchImpl(`${origin}/rest/v1/site_settings?select=*&order=key.asc`, configurationHeaders), 'Site settings lookup'),
    responseJson(await fetchImpl(`${origin}/rest/v1/messaging_configuration?select=*&order=channel.asc`, configurationHeaders), 'Messaging configuration lookup'),
    responseJson(await fetchImpl(`${origin}/rest/v1/messaging_provider_credentials?select=channel,provider_name,config_revision`, configurationHeaders), 'Messaging credential metadata lookup'),
    responseJson(await fetchImpl(`${origin}/storage/v1/bucket`, configurationHeaders), 'Storage bucket lookup'),
  ]);
  const seededConfiguration = validateSeededConfiguration(siteRows, messagingRows);
  let authUser = null;
  if (firstAdminEmail && firstAdminUserId) {
    try {
      authUser = await findAuthUserByEmail(fetchImpl, {
        origin, serviceRoleKey, userId: firstAdminUserId, email: firstAdminEmail,
        allowedProvider: env.BOOTSTRAP_ADMIN_ALLOWED_PROVIDER?.trim() || 'email',
      });
    } catch { /* not ready */ }
  }
  const rosterEntry = authUser
    ? await getAdminRosterEntry(fetchImpl, { origin, serviceRoleKey, userId: authUser.id })
    : null;
  const firstAdmin = {
    uuidAndEmailDeclaredAndValid: Boolean(firstAdminUserId && firstAdminEmail),
    authUserPresent: Boolean(authUser),
    rosterEntryPresent: Boolean(rosterEntry),
    ready: Boolean(authUser && rosterEntry),
  };

  const byId = new Map((buckets ?? []).map((bucket) => [bucket.id, bucket]));
  const storage = {
    avatarsPrivate: byId.get('avatars')?.public === false,
    publicAssetsPublic: byId.get('public-assets')?.public === true,
    requiredBucketsPresent: byId.has('avatars') && byId.has('public-assets'),
  };
  storage.ok = storage.requiredBucketsPresent && storage.avatarsPrivate && storage.publicAssetsPublic;

  const providers = prerequisiteReport(env, messagingRows, credentialRows);
  const evidence = await handoverEvidenceReport(env);
  const report = {
    mode: 'read-only-preflight', projectRef, environment,
    requiredMigrations: { localFiles, ledger: migrationLedger },
    freshCustomerBusinessTables: emptyBusinessTables,
    seededConfiguration,
    storage,
    firstAdmin,
    providers,
    handoverEvidence: evidence,
    secretsReported: false,
  };
  report.coreReady = localFiles.ok && migrationLedger.ok && emptyBusinessTables.ok
    && seededConfiguration.ok && storage.ok && firstAdmin.ready;
  const activeNames = new Set(providers.active.map((provider) => provider.providerName));
  const activeChannels = new Set(providers.active.map((provider) => provider.channel));
  report.handoverReady = report.coreReady
    && providers.ready
    && evidence.workerConfigured && evidence.cronConfigured
    && (!activeNames.has('resend') || evidence.resendVerification.present)
    && (!activeNames.has('mim') || evidence.mimApproval.present)
    && evidence.independentBackup.present
    && (!activeChannels.has('sms') || evidence.liveDelivery.sms.present)
    && (!activeChannels.has('email') || evidence.liveDelivery.email.present);
  console.log(JSON.stringify(report, null, 2));
  if (!report.handoverReady) {
    process.exitCode = 1;
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(`Onboarding preflight failed: ${error.message}`); process.exitCode = 1; });
}

export {
  EXTRA_FRESH_BUSINESS_TABLES,
  MESSAGING_DEFAULTS,
  SITE_SETTING_DEFAULTS,
  handoverEvidenceReport,
  main,
  validateSeededConfiguration,
};
