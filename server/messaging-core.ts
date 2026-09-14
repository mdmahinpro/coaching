import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  credentialFingerprint,
  credentialHint,
  decryptMessagingCredential,
  encryptMessagingCredential,
  getScalarAtPath,
  parseMessagingKeyring,
  setAtPath,
  validateProviderConfiguration,
  validateProviderSecret,
  type EncryptedCredential,
} from './messaging-configuration';
import { guardServerEnvironment } from './environment-guard';
import { fetchProvider } from './safe-url';
import type {
  EmailSendRequest,
  MessagingChannel,
  MessagingConfigurationPutRequest,
  MessagingProviderConfiguration,
  MessagingProviderName,
  MessagingSendResult,
  MessagingTestSendRequest,
  SmsSendRequest,
} from '../shared/messaging-schema';

export type CoreResult = { status: number; body: Record<string, unknown> };
type Headers = Record<string, string | undefined>;
type Delivery = { id: string; jobId?: string; recipient: string; status: string; providerId?: string | null; attempt?: number; acceptedAt?: string | null };

const JOBS = 'message_jobs';
const DELIVERIES = 'message_deliveries';
const CONFIGURATION = 'messaging_configuration';
const CREDENTIALS = 'messaging_provider_credentials';
const MIM_SEND_URL = 'https://api.mimsms.com/api/V2/SMS';
const MIM_DLR_URL = 'https://api.mimsms.com/api/V2/DlrApi';
const RESEND_EMAIL_URL = 'https://api.resend.com/emails';
const RESEND_CONCURRENCY = 5;
const TIMEOUT_MS = 10_000;
const READINESS_ACCEPTANCE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const WORKER_HEARTBEAT_WINDOW_MS = 5 * 60 * 1_000;
const WORKER_HEARTBEAT = 'messaging_worker_heartbeat';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIM_SENDER_RE = /^[A-Za-z0-9]{1,11}$/;
const SMS_MAX_LENGTH = 1_500;
const CAMPAIGN_RECIPIENT_LIMIT = 1_000;
const MIM_TERMINAL_DLR_CODES = new Set(['32', '5', '13', '9', '36']);
const HTML_BLOCK_TAG_RE = /<\/?(?:address|article|aside|blockquote|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
const HTML_TAG_RE = /<[^>]*>/g;

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== '#') { return named[key.toLowerCase()] ?? entity; }
    const hexadecimal = key[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity; } catch { return entity; }
  });
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(html
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(HTML_BLOCK_TAG_RE, '\n')
    .replace(HTML_TAG_RE, ''))
    .replace(HTML_TAG_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function result(status: number, body: Record<string, unknown>): CoreResult { return { status, body }; }
function unavailable(error = 'Messaging is unavailable'): CoreResult { return result(503, { status: 'unavailable', error }); }
function parseBody<T>(raw: unknown): T | null { try { return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T; } catch { return null; } }
function envReady() { return guardServerEnvironment(); }
function serviceConfigured(): boolean { return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }

export function normalizeBangladeshPhone(value: string): string | null {
  let digits = value.trim().replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (digits.startsWith('00880')) { digits = digits.slice(2); }
  if (digits.startsWith('01')) { digits = `88${digits}`; }
  if (digits.startsWith('1')) { digits = `880${digits}`; }
  return /^8801[3-9]\d{8}$/.test(digits) ? digits : null;
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 320 && EMAIL_RE.test(email) ? email : null;
}

function normalizeRecipients(channel: MessagingChannel, values: unknown[]): string[] | null {
  const output: string[] = []; const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') { return null; }
    const normalized = channel === 'sms' ? normalizeBangladeshPhone(value) : normalizeEmail(value);
    if (!normalized) { return null; }
    if (!seen.has(normalized)) { seen.add(normalized); output.push(normalized); }
  }
  return output;
}

async function verifyAdmin(authHeader?: string): Promise<boolean> {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim(); const url = process.env.SUPABASE_URL; const anon = process.env.SUPABASE_ANON_KEY;
  if (!token || !url || !anon) { return false; }
  try {
    const response = await fetch(`${url}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok && (await response.json()) === true;
  } catch { return false; }
}

function constantTimeSecretMatch(provided: string | undefined, configured: string | undefined): boolean {
  if (!configured || !provided) { return false; }
  return timingSafeEqual(createHash('sha256').update(configured, 'utf8').digest(), createHash('sha256').update(provided, 'utf8').digest());
}

function verifyWorkerSecret(provided?: string): boolean {
  return constantTimeSecretMatch(provided, process.env.MESSAGING_WORKER_SECRET);
}

function verifySchedulerBearer(authHeader?: string): boolean {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return constantTimeSecretMatch(token, process.env.MESSAGING_WORKER_SECRET) || constantTimeSecretMatch(token, process.env.CRON_SECRET);
}

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...serviceHeaders(), ...(init.headers as Record<string, string> | undefined) }, signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS) });
}

type ProviderSnapshot = { providerName: MessagingProviderName; providerConfig: MessagingProviderConfiguration; configRevision: string };
type CredentialRow = EncryptedCredential & { channel?: MessagingChannel; provider_name?: MessagingProviderName; config_revision?: string };
const ENVIRONMENT_CONFIG_REVISION = '00000000-0000-4000-8000-000000000000';

function environmentSnapshot(channel: MessagingChannel): ProviderSnapshot {
  if (channel === 'sms') {return { providerName: 'mim', providerConfig: { providerName: 'mim', userName: process.env.SMS_USERNAME ?? '', senderName: process.env.SMS_SENDER_NAME ?? '' }, configRevision: ENVIRONMENT_CONFIG_REVISION };}
  return { providerName: 'resend', providerConfig: { providerName: 'resend', from: process.env.RESEND_FROM ?? '' }, configRevision: ENVIRONMENT_CONFIG_REVISION };
}

async function currentProviderSnapshot(channel: MessagingChannel): Promise<ProviderSnapshot | null> {
  const response = await db(`${CONFIGURATION}?channel=eq.${channel}&select=channel,provider_name,enabled,provider_config,config_revision&limit=1`);
  if (!response.ok) {throw new Error('persistence');}
  const raw = await response.json();
  const row = Array.isArray(raw) ? raw[0] as Record<string, unknown> | undefined : undefined;
  if (!row) {return environmentSnapshot(channel);}
  if (row.enabled !== true) {return null;}
  try {
    const providerName = row.provider_name as MessagingProviderName;
    const providerConfig = validateProviderConfiguration(channel, providerName, row.provider_config);
    const configRevision = String(row.config_revision ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(configRevision)) {throw new Error('invalid revision');}
    return { providerName, providerConfig, configRevision };
  } catch { throw new Error('configuration'); }
}

async function encryptedCredential(snapshot: ProviderSnapshot, channel: MessagingChannel): Promise<Record<string, string> | null> {
  const response = await db(`${CREDENTIALS}?channel=eq.${channel}&provider_name=eq.${snapshot.providerName}&config_revision=eq.${snapshot.configRevision}&select=ciphertext,iv,auth_tag,key_id,config_revision&limit=1`);
  if (!response.ok) {throw new Error('persistence');}
  const raw = await response.json(); const row = Array.isArray(raw) ? raw[0] as CredentialRow | undefined : undefined;
  if (!row) {return null;}
  const value = decryptMessagingCredential(row, channel, snapshot.providerName, snapshot.configRevision);
  return validateProviderSecret(snapshot.providerName, value);
}

async function resolveProviderCredential(snapshot: ProviderSnapshot, channel: MessagingChannel): Promise<Record<string, string> | null> {
  const encrypted = await encryptedCredential(snapshot, channel);
  if (encrypted) {return encrypted;}
  if (snapshot.providerName === 'mim' && channel === 'sms' && process.env.SMS_USERNAME && process.env.SMS_API_KEY) {return { userName: process.env.SMS_USERNAME, apiKey: process.env.SMS_API_KEY };}
  if (snapshot.providerName === 'resend' && channel === 'email' && process.env.RESEND_API_KEY) {return { apiKey: process.env.RESEND_API_KEY };}
  return null;
}

async function providerReady(channel: MessagingChannel): Promise<boolean> {
  try {
    const snapshot = await currentProviderSnapshot(channel); if (!snapshot) {return false;}
    if (snapshot.providerName === 'mim' && (snapshot.providerConfig.providerName !== 'mim' || !MIM_SENDER_RE.test(snapshot.providerConfig.senderName))) {return false;}
    if (snapshot.providerName === 'resend' && (snapshot.providerConfig.providerName !== 'resend' || !snapshot.providerConfig.from)) {return false;}
    return Boolean(await resolveProviderCredential(snapshot, channel));
  } catch { return false; }
}

function safeConfigurationRow(row: Record<string, unknown>, credential?: { fingerprint?: string; hint?: string }) {
  return {
    channel: row.channel, providerName: row.provider_name, enabled: row.enabled,
    providerConfig: row.provider_config, configRevision: row.config_revision,
    credentialConfigured: Boolean(credential),
    ...(credential?.fingerprint ? { credentialFingerprint: credential.fingerprint } : {}),
    ...(credential?.hint ? { credentialHint: credential.hint } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

export async function handleMessagingConfiguration(method: string, authHeader: string | undefined, rawBody?: unknown): Promise<CoreResult> {
  if (!['GET', 'PUT', 'DELETE'].includes(method)) {return result(405, { error: 'Method not allowed' });}
  const environment = envReady(); if (!environment.ok) {return environment.response;}
  if (!(await verifyAdmin(authHeader))) {return result(401, { error: 'Unauthorized' });}
  if (!serviceConfigured()) {return unavailable('Messaging persistence is unavailable');}
  if (method === 'GET') {
    try {
      const [configurationResponse, credentialResponse] = await Promise.all([
        db(`${CONFIGURATION}?select=channel,provider_name,enabled,provider_config,config_revision,updated_at&order=channel`),
        db(`${CREDENTIALS}?select=channel,provider_name,config_revision,fingerprint,hint`),
      ]);
      if (!configurationResponse.ok || !credentialResponse.ok) {throw new Error('persistence');}
      const rows = await configurationResponse.json() as Record<string, unknown>[];
      const credentials = await credentialResponse.json() as Array<{ channel: string; provider_name: string; config_revision: string; fingerprint?: string; hint?: string }>;
      return result(200, { configurations: rows.map((row) => safeConfigurationRow(row, credentials.find((item) => item.channel === row.channel && item.provider_name === row.provider_name && item.config_revision === row.config_revision))) });
    } catch { return unavailable('Messaging configuration is unavailable'); }
  }
  const body = parseBody<MessagingConfigurationPutRequest & { channel?: MessagingChannel }>(rawBody);
  if (!body || !['sms', 'email'].includes(body.channel as string)) {return result(400, { error: 'A valid channel is required' });}
  const channel = body.channel as MessagingChannel;
  if (method === 'DELETE') {
    try {
      const response = await db('rpc/remove_messaging_configuration', { method: 'POST', body: JSON.stringify({ p_channel: channel }) });
      if (!response.ok) {
        const detail = await response.text();
        if (/nonterminal|referenc/i.test(detail)) {return result(409, { error: 'Provider credentials are referenced by nonterminal jobs' });}
        throw new Error('persistence');
      }
      return result(200, { deleted: true, channel });
    } catch { return unavailable('Messaging configuration is unavailable'); }
  }
  if (!['mim', 'resend', 'custom'].includes(body.providerName) || typeof body.enabled !== 'boolean' || !['preserve', 'replace', 'remove'].includes(body.secretAction)) {return result(400, { error: 'Invalid provider configuration request' });}
  try {
    const providerConfig = validateProviderConfiguration(channel, body.providerName, body.providerConfig);
    const priorResponse = await db(`${CONFIGURATION}?channel=eq.${channel}&select=config_revision,provider_name&limit=1`);
    if (!priorResponse.ok) {throw new Error('persistence');}
    const priorRows = await priorResponse.json();
    const prior = Array.isArray(priorRows) ? priorRows[0] as { config_revision?: string; provider_name?: MessagingProviderName } | undefined : undefined;
    if (body.secretAction === 'preserve' && prior?.provider_name && prior.provider_name !== body.providerName) {return result(400, { error: 'Credentials cannot be preserved when changing provider' });}
    const configRevision = randomUUID();
    let secret: Record<string, string> | null = null;
    if (body.secretAction === 'replace') {secret = validateProviderSecret(body.providerName, body.secret);}
    if (body.secretAction === 'preserve' && prior?.config_revision) {
      const existingResponse = await db(`${CREDENTIALS}?channel=eq.${channel}&provider_name=eq.${body.providerName}&config_revision=eq.${prior.config_revision}&select=ciphertext,iv,auth_tag,key_id&limit=1`);
      if (!existingResponse.ok) {throw new Error('persistence');}
      const existingRows = await existingResponse.json();
      const existing = Array.isArray(existingRows) ? existingRows[0] as EncryptedCredential | undefined : undefined;
      if (existing) {secret = validateProviderSecret(body.providerName, decryptMessagingCredential(existing, channel, body.providerName, prior.config_revision));}
    }
    const encrypted = secret ? encryptMessagingCredential(secret, channel, body.providerName, configRevision, parseMessagingKeyring()) : null;
    const saveResponse = await db('rpc/save_messaging_configuration', {
      method: 'POST',
      body: JSON.stringify({
        p_channel: channel, p_provider_name: body.providerName, p_enabled: body.enabled,
        p_provider_config: providerConfig, p_config_revision: configRevision,
        p_secret_action: body.secretAction,
        p_ciphertext: encrypted?.ciphertext ?? null, p_iv: encrypted?.iv ?? null,
        p_auth_tag: encrypted?.auth_tag ?? null, p_key_id: encrypted?.key_id ?? null,
        p_fingerprint: secret ? credentialFingerprint(secret) : null,
        p_hint: secret ? credentialHint(secret) : null,
      }),
    });
    if (!saveResponse.ok) {
      const detail = await saveResponse.text();
      if (/nonterminal|referenc/i.test(detail)) {return result(409, { error: 'Provider credentials are referenced by nonterminal jobs' });}
      throw new Error('persistence');
    }
    return result(200, safeConfigurationRow({ channel, provider_name: body.providerName, enabled: body.enabled, provider_config: providerConfig, config_revision: configRevision }, secret ? { fingerprint: credentialFingerprint(secret), hint: credentialHint(secret) } : undefined));
  } catch (error) {
    const message = error instanceof Error && !['persistence', 'configuration'].includes(error.message) ? error.message : 'Messaging configuration is unavailable';
    return message === 'Messaging configuration is unavailable' ? unavailable(message) : result(400, { error: message });
  }
}

function summaryFromJob(row: Record<string, unknown>): MessagingSendResult {
  const total = Number(row.recipient_count); const accepted = Number(row.accepted_count) + Number(row.delivered_count); const failed = Number(row.failed_count) + Number(row.bounced_count); const unknown = Number(row.unknown_count ?? 0); const dryRun = row.source_type === 'api_dry_run';
  return { jobId: String(row.id), status: dryRun ? 'dry_run' : row.status === 'partially_failed' ? 'partial' : row.status as MessagingSendResult['status'], total, accepted, failed, pending: dryRun ? 0 : Math.max(0, total - accepted - failed - unknown), unknown, requiresReview: unknown > 0, dryRun };
}

async function findJob(idempotencyKey: string): Promise<MessagingSendResult | null> {
  const response = await db(`${JOBS}?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=id,status,source_type,recipient_count,accepted_count,delivered_count,failed_count,bounced_count,unknown_count&limit=1`);
  if (!response.ok) { throw new Error('persistence'); }
  const row = (await response.json() as Array<Record<string, unknown>>)[0]; return row ? summaryFromJob(row) : null;
}

async function createJob(channel: MessagingChannel, recipients: string[], payload: Record<string, unknown>, dryRun: boolean, queued: boolean, idempotencyKey: string, workerId: string, readinessSnapshot: ProviderSnapshot): Promise<{ summary: MessagingSendResult; deliveries: Delivery[]; snapshot: ProviderSnapshot }> {
  const prior = await findJob(idempotencyKey); if (prior) { return { summary: prior, deliveries: [], snapshot: readinessSnapshot }; }
  const content = channel === 'sms' ? { body: String(payload.message) } : { body: String(payload.html), subject: String(payload.subject) };
  const enqueue = await db('rpc/enqueue_message_job', { method: 'POST', body: JSON.stringify({ p_idempotency_key: idempotencyKey, p_channel: channel, p_source_type: dryRun ? 'api_dry_run' : 'api_send', p_source_id: null, p_content: content, p_recipients: recipients, p_available_at: new Date().toISOString() }) });
  if (!enqueue.ok) { throw new Error('persistence'); }
  const jobId = String(await enqueue.json()).replace(/^"|"$/g, '');
  const summary: MessagingSendResult = { jobId, status: dryRun ? 'dry_run' : queued ? 'queued' : 'processing', total: recipients.length, accepted: 0, failed: 0, pending: dryRun ? 0 : recipients.length, unknown: 0, requiresReview: false, dryRun };
  if (dryRun) {
    const cancel = await db(`${JOBS}?id=eq.${jobId}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() }) });
    if (!cancel.ok) { throw new Error('persistence'); }
  }
  if (dryRun || queued) { return { summary, deliveries: [], snapshot: readinessSnapshot }; }
  const claimResponse = await db('rpc/claim_message_job_delivery', { method: 'POST', body: JSON.stringify({ p_job_id: jobId, p_worker_id: workerId, p_lease_seconds: 120 }) });
  if (!claimResponse.ok) { throw new Error('persistence'); }
  const claims = await claimResponse.json() as Array<{ delivery_id: string; job_id: string; recipient: string; attempt_no: number }>;
  if (!claims.length) {
    return { summary: { ...summary, status: 'queued' }, deliveries: [], snapshot: readinessSnapshot };
  }
  const claim = claims[0] as typeof claims[0] & { provider_name?: MessagingProviderName; provider_config_snapshot?: Record<string, unknown>; provider_config_revision?: string };
  const claimedSnapshot = claim.provider_name ? { providerName: claim.provider_name, providerConfig: validateProviderConfiguration(channel, claim.provider_name, claim.provider_config_snapshot), configRevision: String(claim.provider_config_revision) } : readinessSnapshot;
  return { summary, deliveries: claims.map((row) => ({ id: row.delivery_id, jobId: row.job_id, recipient: row.recipient, status: 'processing', attempt: row.attempt_no })), snapshot: claimedSnapshot };
}

async function updateDelivery(id: string, patch: Record<string, unknown>): Promise<void> {
  const response = await db(`${DELIVERIES}?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  if (!response.ok) { throw new Error('persistence'); }
}

type AttemptOutcome = 'accepted' | 'delivered' | 'failed' | 'bounced' | 'unknown';
async function recordAttempt(deliveryId: string, workerId: string, outcome: AttemptOutcome, options: { httpStatus?: number; category?: string; failureCode?: string; failureMessage?: string; providerId?: string | null; retryable?: boolean } = {}): Promise<void> {
  const successful = outcome === 'accepted' || outcome === 'delivered';
  const response = await db('rpc/record_message_attempt', { method: 'POST', body: JSON.stringify({
    p_delivery_id: deliveryId,
    p_worker_id: workerId,
    p_outcome: outcome,
    p_provider_message_id: options.providerId ?? null,
    p_failure_category: successful ? null : options.category ?? (options.httpStatus === 429 ? 'rate_limit' : outcome === 'unknown' ? 'unknown' : 'provider'),
    p_failure_code: successful ? null : options.failureCode ?? String(options.httpStatus ?? 'unknown'),
    p_failure_message: successful ? null : options.failureMessage ?? (outcome === 'unknown' ? 'Provider outcome is ambiguous' : 'Provider request was not accepted'),
    p_retryable: outcome === 'failed' && options.retryable === true,
    p_next_attempt_at: outcome === 'failed' && options.retryable === true ? new Date(Date.now() + 60_000).toISOString() : null,
  }) });
  if (!response.ok) { throw new Error('persistence'); }
}

type AggregateRpcSummary = {
  job_id: string;
  status: MessagingSendResult['status'];
  total: number;
  accepted: number;
  failed: number;
  pending: number;
  unknown: number;
  requires_review: boolean;
  dry_run: boolean;
};

async function refreshJobAggregate(jobId: string): Promise<MessagingSendResult> {
  const response = await db('rpc/refresh_message_job_aggregate', { method: 'POST', body: JSON.stringify({ p_job_id: jobId }) });
  if (!response.ok) { throw new Error('persistence'); }
  const [summary] = await response.json() as AggregateRpcSummary[];
  if (!summary) { throw new Error('persistence'); }
  return { jobId: summary.job_id, status: summary.status, total: summary.total, accepted: summary.accepted, failed: summary.failed, pending: summary.pending, unknown: summary.unknown, requiresReview: summary.requires_review, dryRun: summary.dry_run };
}

async function providerJson(url: string, init: RequestInit): Promise<{ response: Response; raw: unknown }> {
  const response = await fetchProvider(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > 1024 * 1024) {throw new Error('Provider response exceeds 1 MiB');}
  const reader = response.body?.getReader();
  if (!reader) {return { response, raw: null };}
  const chunks: Uint8Array[] = []; let total = 0;
  let reading = true;
  while (reading) {
    const { done, value } = await reader.read();
    if (done) { reading = false; break; }
    total += value.byteLength;
    if (total > 1024 * 1024) { await reader.cancel(); throw new Error('Provider response exceeds 1 MiB'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let raw: unknown = null;
  try { raw = total ? JSON.parse(new TextDecoder().decode(bytes)) : null; } catch { raw = null; }
  return { response, raw };
}
function transportCategory(_error: unknown): string { return 'unknown'; }

async function markUnknown(delivery: Delivery, workerId: string, category: string, providerId?: string | null): Promise<void> {
  await recordAttempt(delivery.id, workerId, 'unknown', { category, providerId, retryable: false });
}

async function beginNonIdempotentDispatch(deliveryId: string, workerId: string): Promise<boolean> {
  const response = await db('rpc/begin_non_idempotent_dispatch', {
    method: 'POST',
    body: JSON.stringify({ p_delivery_id: deliveryId, p_worker_id: workerId }),
  });
  return response.ok && await response.json() === true;
}

async function sendMim(deliveries: Delivery[], message: string, workerId: string, credential: Record<string, string>, configuration: MessagingProviderConfiguration): Promise<void> {
  if (configuration.providerName !== 'mim') {throw new Error('configuration');}
  const userName = configuration.userName; const apiKey = credential.apiKey; const senderName = configuration.senderName;
  for (const delivery of deliveries) {
    if (!await beginNonIdempotentDispatch(delivery.id, workerId)) { continue; }
    let providerResult: { response: Response; raw: unknown };
    try {
      providerResult = await providerJson(MIM_SEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, userName, senderName, transactionType: 'T', mobileNumber: delivery.recipient, message }) });
    } catch (error) {
      await markUnknown(delivery, workerId, transportCategory(error));
      continue;
    }
    const { response, raw } = providerResult;
    const value = (raw ?? {}) as Record<string, unknown>; const successData = value.success_Data as Record<string, unknown> | Array<Record<string, unknown>> | undefined; const first = Array.isArray(successData) ? successData[0] : successData; const trackingId = String(first?.trackingId ?? value.trackingId ?? value.trxnId ?? '').trim();
    const accepted = response.ok && String(value.statusCode) === '200' && String(value.status).toLowerCase() === 'success' && Boolean(trackingId);
    if (accepted) {
      await recordAttempt(delivery.id, workerId, 'accepted', { httpStatus: response.status, providerId: trackingId });
    } else if (response.ok) { await markUnknown(delivery, workerId, 'unknown', trackingId || null); }
    else {
      await recordAttempt(delivery.id, workerId, 'failed', { httpStatus: response.status, retryable: false });
    }
  }
}

function resendIdempotencyKey(deliveryId: string): string {
  return `message-delivery/${createHash('sha256').update(deliveryId).digest('hex')}`;
}

async function sendResendDelivery(delivery: Delivery, subject: string, html: string, text: string, workerId: string, credential: Record<string, string>, configuration: MessagingProviderConfiguration): Promise<void> {
  if (configuration.providerName !== 'resend') {throw new Error('configuration');}
  const apiKey = credential.apiKey; const from = configuration.from;
  let providerResult: { response: Response; raw: unknown };
  try {
    providerResult = await providerJson(RESEND_EMAIL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': resendIdempotencyKey(delivery.id) },
      body: JSON.stringify({ from, to: [delivery.recipient], subject, html, text }),
    });
  } catch (error) {
    await markUnknown(delivery, workerId, transportCategory(error));
    return;
  }
  const { response, raw } = providerResult;
  if (response.ok) {
    const providerId = typeof (raw as { id?: unknown } | null)?.id === 'string' ? String((raw as { id: string }).id).trim() : '';
    if (providerId) { await recordAttempt(delivery.id, workerId, 'accepted', { httpStatus: response.status, providerId }); }
    else { await markUnknown(delivery, workerId, 'unknown'); }
    return;
  }
  await recordAttempt(delivery.id, workerId, 'failed', { httpStatus: response.status, retryable: response.status === 429 || response.status >= 500 });
}

async function sendResend(deliveries: Delivery[], subject: string, html: string, workerId: string, credential: Record<string, string>, configuration: MessagingProviderConfiguration): Promise<void> {
  const text = htmlToPlainText(html); let next = 0;
  async function worker(): Promise<void> {
    while (next < deliveries.length) {
      const delivery = deliveries[next]; next += 1;
      await sendResendDelivery(delivery, subject, html, text, workerId, credential, configuration);
    }
  }
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(RESEND_CONCURRENCY, deliveries.length) }, () => worker()));
  const failed = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failed?.status === 'rejected') { throw failed.reason; }
}

async function sendCustom(deliveries: Delivery[], channel: MessagingChannel, content: Record<string, unknown>, workerId: string, credential: Record<string, string>, configuration: MessagingProviderConfiguration): Promise<void> {
  if (configuration.providerName !== 'custom') {throw new Error('configuration');}
  for (const delivery of deliveries) {
    if (configuration.idempotency.placement === 'none' && !await beginNonIdempotentDispatch(delivery.id, workerId)) {continue;}
    const idempotencyKey = resendIdempotencyKey(delivery.id);
    const canonical: Record<string, unknown> = {
      recipient: delivery.recipient,
      message: content.body,
      subject: content.subject,
      html: channel === 'email' ? content.body : undefined,
      text: channel === 'email' ? htmlToPlainText(String(content.body ?? '')) : content.body,
      sender: configuration.senderIdentity,
    };
    const body: Record<string, unknown> = Object.create(null);
    for (const [field, path] of Object.entries(configuration.fieldMappings)) {
      const value = canonical[field];
      if (value !== undefined && path) {setAtPath(body, path, value);}
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (configuration.auth?.placement === 'header') {headers[configuration.auth.name] = `${configuration.auth.scheme ?? ''}${credential.secret}`;}
    else if (configuration.auth?.placement === 'body') {setAtPath(body, configuration.auth.path, credential.secret);}
    if (configuration.idempotency.placement === 'header') {headers[configuration.idempotency.name] = idempotencyKey;}
    else if (configuration.idempotency.placement === 'body') {setAtPath(body, configuration.idempotency.path, idempotencyKey);}
    let providerResult: { response: Response; raw: unknown };
    try { providerResult = await providerJson(configuration.endpoint, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (error) { await markUnknown(delivery, workerId, transportCategory(error)); continue; }
    const acceptedStatus = configuration.acceptedStatuses.includes(providerResult.response.status);
    const success = !configuration.success || getScalarAtPath(providerResult.raw, configuration.success.path) === configuration.success.value;
    const providerIdValue = getScalarAtPath(providerResult.raw, configuration.providerIdPath);
    const providerId = typeof providerIdValue === 'string' || typeof providerIdValue === 'number' ? String(providerIdValue).trim() : '';
    if (acceptedStatus && success && providerId) {await recordAttempt(delivery.id, workerId, 'accepted', { httpStatus: providerResult.response.status, providerId });}
    else if (acceptedStatus) {await markUnknown(delivery, workerId, 'unknown', providerId || null);}
    else {await recordAttempt(delivery.id, workerId, 'failed', { httpStatus: providerResult.response.status, retryable: configuration.idempotency.placement !== 'none' && (providerResult.response.status === 429 || providerResult.response.status >= 500) });}
  }
}

async function dispatchSnapshot(deliveries: Delivery[], channel: MessagingChannel, content: Record<string, unknown>, workerId: string, snapshot: ProviderSnapshot): Promise<void> {
  const credential = await resolveProviderCredential(snapshot, channel);
  if (!credential) {throw new Error('configuration');}
  if (snapshot.providerName === 'mim') {return sendMim(deliveries, String(content.body), workerId, credential, snapshot.providerConfig);}
  if (snapshot.providerName === 'resend') {return sendResend(deliveries, String(content.subject ?? 'Notification'), String(content.body), workerId, credential, snapshot.providerConfig);}
  return sendCustom(deliveries, channel, content, workerId, credential, snapshot.providerConfig);
}

function smsConfigurationError(): string | null {
  if (!process.env.SMS_USERNAME || !process.env.SMS_API_KEY || !process.env.SMS_SENDER_NAME) { return 'SMS provider credentials are incomplete'; }
  if (!MIM_SENDER_RE.test(process.env.SMS_SENDER_NAME)) { return 'SMS_SENDER_NAME must be 1-11 ASCII alphanumeric characters'; }
  return null;
}

function credentialsReady(channel: MessagingChannel): boolean { return channel === 'sms' ? smsConfigurationError() === null : Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM); }

async function authorize(method: string, expected: string, authHeader?: string): Promise<CoreResult | null> {
  if (method !== expected) { return result(405, { error: 'Method not allowed' }); }
  const environment = envReady(); if (!environment.ok) { return environment.response; }
  if (!(await verifyAdmin(authHeader))) { return result(401, { error: 'Unauthorized' }); }
  return null;
}
async function authorizeWorker(method: string, authHeader?: string, workerSecret?: string): Promise<CoreResult | null> {
  if (method !== 'POST' && method !== 'GET') { return result(405, { error: 'Method not allowed' }); }
  const environment = envReady(); if (!environment.ok) { return environment.response; }
  if (!verifyWorkerSecret(workerSecret) && !verifySchedulerBearer(authHeader) && !(await verifyAdmin(authHeader))) { return result(401, { error: 'Unauthorized' }); }
  return null;
}

export async function sendMessage(channel: MessagingChannel, recipients: string[], payload: Record<string, unknown>, options: { dryRun?: boolean; queue?: boolean; idempotencyKey?: string } = {}): Promise<CoreResult> {
  const normalized = normalizeRecipients(channel, recipients); if (!normalized?.length) { return result(400, { error: `Invalid ${channel} recipient` }); }
  if (channel === 'sms' && (typeof payload.message !== 'string' || !payload.message || payload.message.length > SMS_MAX_LENGTH)) { return result(400, { error: `SMS message must be 1-${SMS_MAX_LENGTH} characters` }); }
  const dryRun = options.dryRun === true; if (!serviceConfigured()) { return unavailable('Messaging persistence is unavailable'); }
  const idempotencyKey = options.idempotencyKey?.trim() || randomUUID(); const queued = options.queue === true || normalized.length > 1; const workerId = `relaycore-inline-${randomUUID()}`;
  try {
    const snapshot = await currentProviderSnapshot(channel);
    if (!snapshot) {return unavailable(`${channel.toUpperCase()} provider is unavailable`);}
    if (!dryRun && snapshot.providerName === 'mim' && snapshot.providerConfig.providerName === 'mim' && !MIM_SENDER_RE.test(snapshot.providerConfig.senderName)) {return unavailable(snapshot.providerConfig.senderName ? 'SMS_SENDER_NAME must be 1-11 ASCII alphanumeric characters' : 'SMS provider credentials are incomplete');}
    if (!dryRun && !await resolveProviderCredential(snapshot, channel)) {return unavailable(channel === 'sms' && snapshot.providerName === 'mim' ? smsConfigurationError() ?? 'SMS provider credentials are incomplete' : `${channel.toUpperCase()} provider is unavailable`);}
    const created = await createJob(channel, normalized, payload, dryRun, queued, idempotencyKey, workerId, snapshot);
    if (!created.deliveries.length || dryRun || queued) { return result(dryRun ? 200 : created.summary.status === 'queued' ? 202 : 200, created.summary as unknown as Record<string, unknown>); }
    await dispatchSnapshot(created.deliveries, channel, channel === 'sms' ? { body: String(payload.message) } : { subject: String(payload.subject), body: String(payload.html) }, workerId, created.snapshot);
    return result(200, await refreshJobAggregate(created.summary.jobId) as unknown as Record<string, unknown>);
  } catch { return unavailable('Messaging persistence is unavailable'); }
}

export async function handleSendSms(method: string, authHeader: string | undefined, rawBody: unknown, headers: Headers = {}): Promise<CoreResult> {
  const auth = await authorize(method, 'POST', authHeader); if (auth) { return auth; }
  const body = parseBody<SmsSendRequest>(rawBody); if (!body || !Array.isArray(body.phones) || !body.phones.length || typeof body.message !== 'string' || !body.message) { return result(400, { error: 'phones and message are required' }); }
  if (body.phones.length > CAMPAIGN_RECIPIENT_LIMIT) { return result(413, { error: `SMS requests support at most ${CAMPAIGN_RECIPIENT_LIMIT} recipients; split this campaign into smaller requests` }); }
  if (body.message.length > SMS_MAX_LENGTH) { return result(400, { error: `SMS message must be no more than ${SMS_MAX_LENGTH} characters` }); }
  return sendMessage('sms', body.phones, { message: body.message }, { dryRun: body.dryRun, queue: body.queue === true || body.phones.length > 1, idempotencyKey: headers['idempotency-key'] });
}

export async function handleSendEmail(method: string, authHeader: string | undefined, rawBody: unknown, headers: Headers = {}): Promise<CoreResult> {
  const auth = await authorize(method, 'POST', authHeader); if (auth) { return auth; }
  const body = parseBody<EmailSendRequest>(rawBody); if (!body || !Array.isArray(body.emails) || !body.emails.length || typeof body.subject !== 'string' || !body.subject || typeof body.html !== 'string' || !body.html) { return result(400, { error: 'emails, subject and html are required' }); }
  if (body.emails.length > CAMPAIGN_RECIPIENT_LIMIT) { return result(413, { error: `Email requests support at most ${CAMPAIGN_RECIPIENT_LIMIT} recipients; split this campaign into smaller requests` }); }
  if (body.subject.length > 200 || Buffer.byteLength(body.html) > 512 * 1024) { return result(413, { error: 'Email subject or HTML body exceeds limits' }); }
  return sendMessage('email', body.emails, { subject: body.subject, html: body.html, templateType: body.templateType }, { dryRun: body.dryRun, queue: body.queue === true || body.emails.length > 1, idempotencyKey: headers['idempotency-key'] });
}

async function recentAcceptance(channel: MessagingChannel): Promise<boolean> {
  const since = new Date(Date.now() - READINESS_ACCEPTANCE_WINDOW_MS).toISOString();
  const response = await db(`${DELIVERIES}?accepted_at=gte.${encodeURIComponent(since)}&accepted_at=not.is.null&select=id,${JOBS}!inner(channel)&${JOBS}.channel=eq.${channel}&limit=1`); if (!response.ok) { throw new Error('persistence'); }
  return (await response.json() as unknown[]).length > 0;
}

async function recordWorkerHeartbeat(): Promise<void> {
  const timestamp = new Date().toISOString();
  const response = await db(`${WORKER_HEARTBEAT}?id=eq.messaging-worker`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_success_at: timestamp, updated_at: timestamp }) });
  if (!response.ok) { throw new Error('persistence'); }
}

async function workerIsLive(): Promise<boolean> {
  const since = new Date(Date.now() - WORKER_HEARTBEAT_WINDOW_MS).toISOString();
  const response = await db(`${WORKER_HEARTBEAT}?id=eq.messaging-worker&last_success_at=gte.${encodeURIComponent(since)}&select=id&limit=1`);
  if (!response.ok) { throw new Error('persistence'); }
  return (await response.json() as unknown[]).length > 0;
}

export async function handleMessagingReadiness(method: string, authHeader?: string): Promise<CoreResult> {
  const auth = await authorize(method, 'GET', authHeader); if (auth) { return auth; }
  const smsError = smsConfigurationError();
  const readinessBody = (sms: string, email: string, persistence: string, status = 'unavailable') => ({ status, sms, email, persistence, ...(smsError ? { smsError } : {}) });
  if (!serviceConfigured()) { return result(503, readinessBody(credentialsReady('sms') ? 'configured' : 'unavailable', credentialsReady('email') ? 'configured' : 'unavailable', 'unavailable')); }
  try {
    const [smsConfigured, emailConfigured] = await Promise.all([providerReady('sms'), providerReady('email')]);
    const [smsAccepted, emailAccepted, workerLive] = await Promise.all([smsConfigured ? recentAcceptance('sms') : Promise.resolve(false), emailConfigured ? recentAcceptance('email') : Promise.resolve(false), workerIsLive()]);
    const sms = !smsConfigured ? 'unavailable' : smsAccepted && workerLive ? 'live-ready' : 'configured'; const email = !emailConfigured ? 'unavailable' : emailAccepted && workerLive ? 'live-ready' : 'configured'; const persistence = workerLive ? 'live-ready' : 'configured';
    const status = sms === 'unavailable' || email === 'unavailable' ? 'unavailable' : sms === 'live-ready' && email === 'live-ready' ? 'live-ready' : 'configured';
    return result(status === 'unavailable' ? 503 : 200, readinessBody(sms, email, persistence, status));
  } catch { return result(503, readinessBody(credentialsReady('sms') ? 'configured' : 'unavailable', credentialsReady('email') ? 'configured' : 'unavailable', 'unavailable')); }
}

function allowlisted(channel: MessagingChannel, recipient: string): boolean {
  const normalized = channel === 'sms' ? normalizeBangladeshPhone(recipient) : normalizeEmail(recipient); const allowed = (process.env.MESSAGING_TEST_RECIPIENT_ALLOWLIST ?? '').split(',').map((value) => channel === 'sms' ? normalizeBangladeshPhone(value) : normalizeEmail(value)).filter(Boolean); return Boolean(normalized && allowed.includes(normalized));
}
export async function handleMessagingTestSend(method: string, authHeader: string | undefined, rawBody: unknown, headers: Headers = {}): Promise<CoreResult> {
  const auth = await authorize(method, 'POST', authHeader); if (auth) { return auth; }
  const body = parseBody<MessagingTestSendRequest>(rawBody); if (!body || !['sms', 'email'].includes(body.channel) || typeof body.recipient !== 'string' || !allowlisted(body.channel, body.recipient)) { return result(400, { error: 'A single allowlisted test recipient is required' }); }
  if (!body.dryRun && body.confirmRealSend !== true) { return result(400, { error: 'confirmRealSend is required' }); }
  return body.channel === 'sms' ? sendMessage('sms', [body.recipient], { message: body.message || 'Relaycore messaging test' }, { dryRun: body.dryRun, idempotencyKey: headers['idempotency-key'] }) : sendMessage('email', [body.recipient], { subject: body.subject || 'Relaycore messaging test', html: body.html || '<p>Relaycore messaging test</p>' }, { dryRun: body.dryRun, idempotencyKey: headers['idempotency-key'] });
}

export async function processMessagingJobs(): Promise<CoreResult> {
  if (!serviceConfigured()) { return unavailable('Messaging persistence is unavailable'); }
  const [smsReady, emailReady] = await Promise.all([providerReady('sms'), providerReady('email')]);
  const claimChannels: MessagingChannel[] = ['sms', 'email'];
  const channelStatus = { sms: smsReady ? 'configured' : 'unavailable', email: emailReady ? 'configured' : 'unavailable' };
  try {
    const workerId = `relaycore-${randomUUID()}`;
    const claimed: Array<{ delivery_id: string; job_id: string; channel: MessagingChannel; recipient: string; content: Record<string, unknown>; attempt_no: number; provider_name: MessagingProviderName; provider_config_snapshot: Record<string, unknown>; provider_config_revision: string }> = [];
    for (const channel of claimChannels) {
      const response = await db('rpc/claim_message_deliveries', { method: 'POST', body: JSON.stringify({ p_worker_id: workerId, p_channel: channel, p_limit: channel === 'sms' ? 1 : 100, p_lease_seconds: 120 }) });
      if (!response.ok) { throw new Error('persistence'); }
      claimed.push(...await response.json() as typeof claimed);
    }
    const groups = new Map<string, typeof claimed>();
    for (const item of claimed) { groups.set(item.job_id, [...(groups.get(item.job_id) ?? []), item]); }
    let processed = 0;
    for (const [jobId, items] of groups) {
      const channel = items[0].channel; const deliveries: Delivery[] = [];
      for (const item of items) {
        const normalized = channel === 'sms' ? normalizeBangladeshPhone(item.recipient) : normalizeEmail(item.recipient);
        if (!normalized) {
          await recordAttempt(item.delivery_id, workerId, 'failed', { category: 'invalid_recipient', failureCode: 'invalid_recipient', failureMessage: 'Recipient validation failed', retryable: false });
          processed += 1;
          continue;
        }
        if (normalized !== item.recipient) { await updateDelivery(item.delivery_id, { recipient: normalized }); }
        deliveries.push({ id: item.delivery_id, jobId, recipient: normalized, status: 'processing', attempt: item.attempt_no });
      }
      const content = items[0].content;
      if (deliveries.length) {
        const first = items[0];
        const snapshot = {
          providerName: first.provider_name,
          providerConfig: validateProviderConfiguration(channel, first.provider_name, first.provider_config_snapshot),
          configRevision: first.provider_config_revision,
        };
        await dispatchSnapshot(deliveries, channel, content, workerId, snapshot);
        processed += deliveries.length;
      }
    }
    await recordWorkerHeartbeat();
    return result(200, { status: 'completed', processed, ...channelStatus });
  } catch { return unavailable('Messaging persistence is unavailable'); }
}

export async function handleProcessMessagingJobs(method: string, authHeader?: string, workerSecret?: string): Promise<CoreResult> {
  const auth = await authorizeWorker(method, authHeader, workerSecret); if (auth) { return auth; }
  return processMessagingJobs();
}

function verifySvix(rawBody: string, headers: Headers): boolean {
  const secretValue = process.env.RESEND_WEBHOOK_SECRET; const id = headers['svix-id']; const timestamp = headers['svix-timestamp']; const signatures = headers['svix-signature'];
  if (!secretValue || !id || !timestamp || !signatures || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) { return false; }
  try {
    const expected = createHmac('sha256', Buffer.from(secretValue.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
    return signatures.split(' ').some((entry) => { const actual = Buffer.from(entry.replace(/^v\d+,/, '')); const wanted = Buffer.from(expected); return actual.length === wanted.length && timingSafeEqual(actual, wanted); });
  } catch { return false; }
}

export async function handleResendWebhook(method: string, rawBody: string, headers: Headers): Promise<CoreResult> {
  if (method !== 'POST') { return result(405, { error: 'Method not allowed' }); } if (!verifySvix(rawBody, headers)) { return result(401, { error: 'Invalid webhook signature' }); } if (!serviceConfigured()) { return unavailable('Messaging persistence is unavailable'); }
  const event = parseBody<{ type?: string; data?: { email_id?: string } }>(rawBody); const providerId = event?.data?.email_id; if (!providerId) { return result(400, { error: 'Invalid webhook payload' }); }
  const status = event.type === 'email.delivered' ? 'delivered' : event.type === 'email.bounced' || event.type === 'email.complained' ? 'bounced' : event.type === 'email.sent' ? 'accepted' : null;
  if (status) {
    const timestampPatch = status === 'delivered' ? { delivered_at: new Date().toISOString() } : status === 'bounced' ? { bounced_at: new Date().toISOString() } : { accepted_at: new Date().toISOString() };
    const eligibleStatuses = status === 'accepted' ? 'accepted' : status === 'delivered' ? 'accepted,delivered' : 'accepted,delivered,bounced';
    const response = await db(`${DELIVERIES}?provider_message_id=eq.${encodeURIComponent(providerId)}&status=in.(${eligibleStatuses})&select=job_id,${JOBS}!inner(provider_name)&${JOBS}.provider_name=eq.resend`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, ...timestampPatch }) }); if (!response.ok) { return unavailable('Messaging persistence is unavailable'); }
    const changed = await response.json() as Array<{ job_id: string }>;
    try { for (const jobId of new Set(changed.map((row) => row.job_id))) { await refreshJobAggregate(jobId); } } catch { return unavailable('Messaging persistence is unavailable'); }
  }
  return result(200, { received: true });
}

function mimDlrStatus(raw: unknown): 'delivered' | 'failed' | null {
  const value = (raw ?? {}) as Record<string, unknown>; if (String(value.statusCode) !== '200') { return null; }
  const operatorStatus = String(value.operatorStatus ?? '').trim().toUpperCase().replace(/[_-]+/g, ' '); const dlrCode = String(value.dlrCode ?? '').trim();
  if (dlrCode === '0' && operatorStatus === 'DELIVERED') { return 'delivered'; }
  if (MIM_TERMINAL_DLR_CODES.has(dlrCode)) { return 'failed'; }
  return null;
}

export async function syncMimDlr(): Promise<CoreResult> {
  if (!serviceConfigured()) { return unavailable(); }
  try {
    const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const pending = await db(`${DELIVERIES}?status=eq.accepted&provider_message_id=not.is.null&accepted_at=not.is.null&accepted_at=lte.${encodeURIComponent(cutoff)}&select=id,job_id,recipient,provider_message_id,accepted_at,${JOBS}!inner(channel,provider_name,provider_config_snapshot,provider_config_revision)&${JOBS}.channel=eq.sms&${JOBS}.provider_name=eq.mim&limit=100`); if (!pending.ok) { throw new Error('persistence'); }
    const rows = await pending.json() as Array<{ id: string; job_id: string; recipient: string; provider_message_id: string; accepted_at: string; message_jobs: { provider_name: 'mim'; provider_config_snapshot: Record<string, unknown>; provider_config_revision: string } }>;
    const touchedJobs = new Set<string>(); let updated = 0;
    for (const row of rows) {
      try {
        const snapshot: ProviderSnapshot = { providerName: 'mim', providerConfig: validateProviderConfiguration('sms', 'mim', row.message_jobs.provider_config_snapshot), configRevision: row.message_jobs.provider_config_revision };
        const mimCredential = await resolveProviderCredential(snapshot, 'sms');
        if (!mimCredential || snapshot.providerConfig.providerName !== 'mim') {continue;}
        const { response, raw } = await providerJson(MIM_DLR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: mimCredential.apiKey, userName: snapshot.providerConfig.userName, mobileNumber: row.recipient, trackingId: row.provider_message_id }) }); const status = response.ok ? mimDlrStatus(raw) : null;
        if (status) { await updateDelivery(row.id, { status, ...(status === 'delivered' ? { delivered_at: new Date().toISOString() } : { failed_at: new Date().toISOString() }) }); if (row.job_id) { touchedJobs.add(row.job_id); } updated += 1; }
      } catch { /* Failed polling leaves the accepted delivery eligible for a later sync. */ }
    }
    for (const jobId of touchedJobs) { await refreshJobAggregate(jobId); }
    return result(200, { status: 'completed', checked: rows.length, updated });
  } catch { return unavailable('Messaging persistence is unavailable'); }
}

export async function handleMimDlrSync(method: string, authHeader?: string, workerSecret?: string): Promise<CoreResult> {
  const auth = await authorizeWorker(method, authHeader, workerSecret); if (auth) { return auth; }
  return syncMimDlr();
}
