import { supabase } from './supabase';
import { logError } from '@/utils/logger';

export type MessagingChannel = 'sms' | 'email';
export type MessagingStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'requires_review'
  | 'failed'
  | 'dry_run'
  | 'pending'
  | 'unavailable';
export type ProviderReadinessState = 'configured' | 'simulated' | 'unavailable' | 'live-ready';

export interface MessagingResponse {
  jobId: string | null;
  status: MessagingStatus;
  total: number;
  accepted: number;
  failed: number;
  pending: number;
  unknown: number;
  requiresReview: boolean;
  dryRun: boolean;
}

export interface MessagingRequest {
  channel: MessagingChannel;
  recipients: string[];
  message: string;
  subject?: string;
  templateType?: string;
  idempotencyKey: string;
  dryRun?: boolean;
}

export interface ProviderReadiness {
  sms: ProviderReadinessState;
  email: ProviderReadinessState;
}

const unresolvedTemplate = /\{[^{}]+\}/;

export function hasUnresolvedTemplate(value: string): boolean {
  return unresolvedTemplate.test(value);
}

export function dedupeRecipients(
  channel: MessagingChannel,
  recipients: readonly string[]
): string[] {
  const seen = new Set<string>();
  return recipients.reduce<string[]>((result, raw) => {
    const trimmed = raw.trim();
    const normalized =
      channel === 'email' ? trimmed.toLowerCase() : trimmed.replace(/[\s()-]/g, '');
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(trimmed);
    }
    return result;
  }, []);
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

/** Deterministic by design: retries of the same business action reuse the same key. */
export function messagingIdempotencyKey(scope: string, identity: string, revision = 'v1'): string {
  return `${scope}:${revision}:${hash(identity)}`;
}

function failedResponse(
  total: number,
  dryRun: boolean,
  status: MessagingStatus = 'failed'
): MessagingResponse {
  return {
    jobId: null,
    status,
    total,
    accepted: 0,
    failed: status === 'failed' || status === 'unavailable' ? total : 0,
    pending: status === 'pending' ? total : 0,
    unknown: 0,
    requiresReview: status === 'requires_review',
    dryRun,
  };
}

function normalizeResponse(
  raw: unknown,
  total: number,
  requestedDryRun: boolean
): MessagingResponse | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const data = raw as Record<string, unknown>;
  const statusValue = typeof data.status === 'string' ? data.status.toLowerCase() : '';
  const normalizedStatusValue = statusValue.replace(/-/g, '_');
  const allowed: MessagingStatus[] = [
    'queued',
    'processing',
    'completed',
    'partial',
    'requires_review',
    'failed',
    'dry_run',
    'pending',
    'unavailable',
  ];
  let status: MessagingStatus;
  if (allowed.includes(normalizedStatusValue as MessagingStatus)) {
    status = normalizedStatusValue as MessagingStatus;
  } else if (normalizedStatusValue === 'partially_failed') {
    status = 'partial';
  } else if (
    normalizedStatusValue === 'sent' ||
    normalizedStatusValue === 'success' ||
    normalizedStatusValue === 'accepted'
  ) {
    status = 'completed';
  } else {
    return null;
  }

  const number = (key: string, fallback: number) =>
    typeof data[key] === 'number' && Number.isFinite(data[key])
      ? Math.max(0, Number(data[key]))
      : fallback;
  const responseTotal = number('total', total);
  const acceptedFallback = status === 'completed' ? number('sent', responseTotal) : 0;
  const pendingFallback = status === 'pending' ? Math.max(0, responseTotal - acceptedFallback) : 0;
  const failedFallback =
    status === 'failed' || status === 'unavailable' ? responseTotal : number('failed', 0);
  const accepted = Math.min(responseTotal, number('accepted', acceptedFallback));
  const failed = Math.min(responseTotal, number('failed', failedFallback));
  const pending = Math.min(responseTotal, number('pending', pendingFallback));
  const unknown = Math.min(responseTotal, number('unknown', 0));
  const requiresReview =
    typeof data.requiresReview === 'boolean' ? data.requiresReview : status === 'requires_review';
  const dryRun = typeof data.dryRun === 'boolean' ? data.dryRun : requestedDryRun;

  return {
    jobId: typeof data.jobId === 'string' ? data.jobId : null,
    status: requestedDryRun && status !== 'requires_review' ? 'dry_run' : status,
    total: responseTotal,
    accepted: requestedDryRun ? 0 : accepted,
    failed,
    pending: requestedDryRun ? 0 : pending,
    unknown,
    requiresReview,
    dryRun,
  };
}

export async function sendMessage(request: MessagingRequest): Promise<MessagingResponse> {
  const recipients = dedupeRecipients(request.channel, request.recipients);
  const dryRun = request.dryRun === true;
  if (!recipients.length) {
    return failedResponse(0, dryRun);
  }
  if (
    !request.message.trim() ||
    hasUnresolvedTemplate(request.message) ||
    (request.subject && hasUnresolvedTemplate(request.subject))
  ) {
    return failedResponse(recipients.length, dryRun);
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const endpoint = request.channel === 'sms' ? '/api/send-sms' : '/api/send-email';
    const body =
      request.channel === 'sms'
        ? {
            phones: recipients,
            recipients,
            message: request.message,
            templateType: request.templateType,
            idempotencyKey: request.idempotencyKey,
            dryRun,
          }
        : {
            emails: recipients,
            recipients,
            subject: request.subject,
            html: request.message,
            templateType: request.templateType,
            idempotencyKey: request.idempotencyKey,
            dryRun,
            recipientPrivacy: 'individual',
            queue: recipients.length > 1,
          };
    if (request.channel === 'sms' && recipients.length > 1) {
      Object.assign(body, { queue: true });
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': request.idempotencyKey,
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      return failedResponse(
        recipients.length,
        dryRun,
        response.status === 503 ? 'unavailable' : 'failed'
      );
    }
    return (
      normalizeResponse(raw, recipients.length, dryRun) ?? failedResponse(recipients.length, dryRun)
    );
  } catch (error) {
    logError('Messaging request failed', {
      source: 'messaging',
      meta: {
        channel: request.channel,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return failedResponse(recipients.length, dryRun, 'unavailable');
  }
}

export async function getProviderReadiness(): Promise<ProviderReadiness> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const response = await fetch('/api/messaging-readiness', {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const valid = (value: unknown): value is ProviderReadinessState =>
      value === 'configured' ||
      value === 'simulated' ||
      value === 'unavailable' ||
      value === 'live-ready';
    if (!raw) {
      return { sms: 'unavailable', email: 'unavailable' };
    }
    const mapState = (value: unknown): ProviderReadinessState => {
      if (valid(value)) {
        return value;
      }
      if (value === 'ready') {
        return raw.persistence === 'ready' ? 'live-ready' : 'configured';
      }
      if (value === 'simulated') {
        return 'simulated';
      }
      return raw.persistence === 'ready' ? 'simulated' : 'unavailable';
    };
    return { sms: mapState(raw.sms), email: mapState(raw.email) };
  } catch {
    return { sms: 'unavailable', email: 'unavailable' };
  }
}

export async function processMessageQueue(): Promise<{ processed: number }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const response = await fetch('/api/process-messaging-jobs', {
    method: 'POST',
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(typeof raw?.error === 'string' ? raw.error : 'Queue processing failed');
  }
  return { processed: typeof raw?.processed === 'number' ? raw.processed : 0 };
}

export async function testMessageProvider(request: {
  channel: MessagingChannel;
  recipient: string;
  dryRun: boolean;
  confirmRealSend: boolean;
  idempotencyKey: string;
  message?: string;
  subject?: string;
  html?: string;
}): Promise<MessagingResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const response = await fetch('/api/messaging-test-send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': request.idempotencyKey,
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(request),
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    return failedResponse(1, request.dryRun, response.status === 503 ? 'unavailable' : 'failed');
  }
  return normalizeResponse(raw, 1, request.dryRun) ?? failedResponse(1, request.dryRun);
}

export function formatMessagingResult(result: MessagingResponse): string {
  const summary = `Accepted ${result.accepted}, failed ${result.failed}, pending ${result.pending}, unknown ${result.unknown}`;
  const requiresReview =
    result.requiresReview || result.status.toLowerCase().replace(/-/g, '_') === 'requires_review';
  return requiresReview ? `${summary}. Warning: operator review required.` : summary;
}

export type {
  CustomAuthConfiguration,
  CustomIdempotencyConfiguration,
  CustomProviderConfiguration,
  MessagingConfigurationMetadata,
  MessagingConfigurationPutRequest,
  MessagingProviderConfiguration,
  MessagingProviderName,
  SecretAction,
} from '../../shared/messaging-schema';

import type {
  CanonicalMessageField,
  CustomProviderConfiguration,
  MessagingConfigurationMetadata,
} from '../../shared/messaging-schema';

type MessagingProviderName = import('../../shared/messaging-schema').MessagingProviderName;
type MessagingProviderConfiguration = import('../../shared/messaging-schema').MessagingProviderConfiguration;
type CustomAuthConfiguration = import('../../shared/messaging-schema').CustomAuthConfiguration;
type CustomIdempotencyConfiguration = import('../../shared/messaging-schema').CustomIdempotencyConfiguration;
type MessagingConfigurationPutRequest = import('../../shared/messaging-schema').MessagingConfigurationPutRequest;
type SecretAction = import('../../shared/messaging-schema').SecretAction;

export interface MessagingConfigEnvelope {
  configurations: MessagingConfigurationMetadata[];
}

export interface MessagingValidationIssue {
  field: string;
  message: string;
}

const BUILTIN_ENDPOINTS: Record<'mim' | 'resend', string> = {
  mim: 'https://api.mimsms.com/api/V2/SMS',
  resend: 'https://api.resend.com/emails',
};
const SECRET_KEYS = /(^|_)(api[-_]?key|secret|ciphertext|token|credential)(_|$)/i;
const FINGERPRINT_KEY = /fingerprint/i;
const SAFE_MAPPING_KEYS: Record<MessagingChannel, readonly CanonicalMessageField[]> = {
  sms: ['recipient', 'message', 'sender'],
  email: ['recipient', 'subject', 'html', 'text', 'sender'],
};

function defaultProviderName(channel: MessagingChannel): MessagingProviderName {
  return channel === 'sms' ? 'mim' : 'resend';
}

export function emptyMessagingConfiguration(
  channel: MessagingChannel
): MessagingConfigurationMetadata {
  const providerName = defaultProviderName(channel);
  return {
    channel,
    providerName,
    enabled: false,
    providerConfig:
      providerName === 'mim'
        ? { providerName: 'mim', userName: '', senderName: '' }
        : { providerName: 'resend', from: '' },
    configRevision: '',
    credentialConfigured: false,
  };
}

export function providerConfigurationFor(
  channel: MessagingChannel,
  providerName: MessagingProviderName
): MessagingProviderConfiguration {
  if (providerName === 'mim') {
    return { providerName: 'mim', userName: '', senderName: '' };
  }
  if (providerName === 'resend') {
    return { providerName: 'resend', from: '' };
  }
  return {
    providerName: 'custom',
    endpoint: '',
    method: 'POST',
    auth: { placement: 'header', name: 'Authorization', scheme: 'Bearer ' },
    idempotency: { placement: 'header', name: 'Idempotency-Key' },
    fieldMappings: {},
    acceptedStatuses: [200, 201, 202],
    providerIdPath: '',
  };
}

/** Drops secret material and full fingerprints at every depth before data reaches UI state. */
export function redactMessagingData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactMessagingData);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          !FINGERPRINT_KEY.test(key) &&
          (!SECRET_KEYS.test(key) || key === 'credentialConfigured' || key === 'credentialHint')
      )
      .map(([key, nested]) => [key, redactMessagingData(nested)])
  );
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeAuth(value: unknown): CustomAuthConfiguration | undefined {
  if (!value || typeof value !== 'object') {return undefined;}
  const auth = value as Record<string, unknown>;
  if (auth.placement === 'header') {
    const name = string(auth.name);
    return name
      ? {
          placement: 'header',
          name,
          ...(typeof auth.scheme === 'string' ? { scheme: auth.scheme } : {}),
        }
      : undefined;
  }
  if (auth.placement === 'body') {
    const path = string(auth.path);
    return path ? { placement: 'body', path } : undefined;
  }
  return undefined;
}

function normalizeIdempotency(value: unknown): CustomIdempotencyConfiguration {
  if (!value || typeof value !== 'object') {return { placement: 'none' };}
  const item = value as Record<string, unknown>;
  if (item.placement === 'header' && string(item.name))
    {return { placement: 'header', name: string(item.name) };}
  if (item.placement === 'body' && string(item.path))
    {return { placement: 'body', path: string(item.path) };}
  return { placement: 'none' };
}

function normalizeProviderConfiguration(
  channel: MessagingChannel,
  providerName: MessagingProviderName,
  value: unknown
): MessagingProviderConfiguration {
  const raw =
    value && typeof value === 'object'
      ? (redactMessagingData(value) as Record<string, unknown>)
      : {};
  if (providerName === 'mim' && channel === 'sms') {
    return {
      providerName: 'mim',
      userName: string(raw.userName),
      senderName: string(raw.senderName),
    };
  }
  if (providerName === 'resend' && channel === 'email') {
    return { providerName: 'resend', from: string(raw.from) };
  }
  if (providerName === 'custom') {
    const mappings =
      raw.fieldMappings && typeof raw.fieldMappings === 'object'
        ? Object.fromEntries(
            Object.entries(raw.fieldMappings as Record<string, unknown>).filter(
              ([key, mapped]) =>
                SAFE_MAPPING_KEYS[channel].includes(key as CanonicalMessageField) &&
                typeof mapped === 'string'
            )
          )
        : {};
    const success =
      raw.success && typeof raw.success === 'object'
        ? (raw.success as Record<string, unknown>)
        : undefined;
    const successValue = success?.value;
    const validSuccessValue =
      successValue === null || ['string', 'number', 'boolean'].includes(typeof successValue);
    return {
      providerName: 'custom',
      endpoint: string(raw.endpoint),
      method: 'POST',
      ...(normalizeAuth(raw.auth) ? { auth: normalizeAuth(raw.auth) } : {}),
      idempotency: normalizeIdempotency(raw.idempotency),
      fieldMappings: mappings,
      acceptedStatuses: Array.isArray(raw.acceptedStatuses)
        ? raw.acceptedStatuses.filter(
            (status): status is number =>
              Number.isInteger(status) && Number(status) >= 100 && Number(status) <= 599
          )
        : [],
      ...(success && string(success.path) && validSuccessValue
        ? {
            success: {
              path: string(success.path),
              value: successValue as string | number | boolean | null,
            },
          }
        : {}),
      providerIdPath: string(raw.providerIdPath),
      ...(typeof raw.senderIdentity === 'string' ? { senderIdentity: raw.senderIdentity } : {}),
    } satisfies CustomProviderConfiguration;
  }
  return providerConfigurationFor(channel, defaultProviderName(channel));
}

function normalizeConfiguration(raw: unknown): MessagingConfigurationMetadata | null {
  if (!raw || typeof raw !== 'object') {return null;}
  const safe = redactMessagingData(raw) as Record<string, unknown>;
  const channel = safe.channel;
  const providerName = safe.providerName;
  if (
    (channel !== 'sms' && channel !== 'email') ||
    (providerName !== 'mim' && providerName !== 'resend' && providerName !== 'custom')
  )
    {return null;}
  if (
    (providerName === 'mim' && channel !== 'sms') ||
    (providerName === 'resend' && channel !== 'email')
  )
    {return null;}
  return {
    channel,
    providerName,
    enabled: safe.enabled === true,
    providerConfig: normalizeProviderConfiguration(channel, providerName, safe.providerConfig),
    configRevision: string(safe.configRevision),
    credentialConfigured: safe.credentialConfigured === true,
    ...(typeof safe.credentialHint === 'string' ? { credentialHint: safe.credentialHint } : {}),
    ...(typeof safe.updatedAt === 'string' ? { updatedAt: safe.updatedAt } : {}),
  };
}

async function adminMessagingRequest(path: string, init?: RequestInit): Promise<unknown> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {throw new Error('Administrator authentication is required.');}
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers ?? {}),
    },
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    const safe = redactMessagingData(raw) as { issues?: unknown } | null;
    const error = new Error('Messaging configuration request failed.');
    Object.assign(error, { issues: Array.isArray(safe?.issues) ? safe.issues : [] });
    throw error;
  }
  return redactMessagingData(raw);
}

export async function getMessagingProviderConfigs(): Promise<MessagingConfigEnvelope> {
  const raw = (await adminMessagingRequest('/api/messaging-configuration')) as {
    configurations?: unknown;
  } | null;
  const configurations = Array.isArray(raw?.configurations)
    ? raw.configurations
        .map(normalizeConfiguration)
        .filter((item): item is MessagingConfigurationMetadata => Boolean(item))
    : [];
  return { configurations };
}

export function validateMessagingConfiguration(
  config: MessagingConfigurationMetadata
): MessagingValidationIssue[] {
  const issues: MessagingValidationIssue[] = [];
  const provider = config.providerConfig;
  if (provider.providerName !== config.providerName) {
    return [{ field: 'providerName', message: 'Provider and configuration do not match.' }];
  }
  if (provider.providerName === 'mim') {
    if (!provider.userName.trim())
      {issues.push({ field: 'userName', message: 'MIM username is required.' });}
    if (!provider.senderName.trim())
      {issues.push({ field: 'senderName', message: 'Sender name is required.' });}
  }
  if (provider.providerName === 'resend' && !provider.from.trim()) {
    issues.push({ field: 'from', message: 'From identity is required.' });
  }
  if (provider.providerName === 'custom') {
    try {
      const endpoint = new URL(provider.endpoint);
      if (
        endpoint.protocol !== 'https:' ||
        endpoint.username ||
        endpoint.password ||
        endpoint.port ||
        endpoint.search ||
        endpoint.hash ||
        /[\r\n]/.test(provider.endpoint)
      ) {
        throw new Error();
      }
    } catch {
      issues.push({ field: 'endpoint', message: 'Custom endpoint must be an exact HTTPS URL.' });
    }
    if (provider.auth?.placement === 'header' && !provider.auth.name.trim())
      {issues.push({ field: 'auth', message: 'Authentication header is required.' });}
    if (provider.auth?.placement === 'body' && !provider.auth.path.trim())
      {issues.push({ field: 'auth', message: 'Authentication body path is required.' });}
    if (provider.idempotency.placement === 'header' && !provider.idempotency.name.trim())
      {issues.push({ field: 'idempotency', message: 'Idempotency header is required.' });}
    if (provider.idempotency.placement === 'body' && !provider.idempotency.path.trim())
      {issues.push({ field: 'idempotency', message: 'Idempotency body path is required.' });}
    if (!provider.acceptedStatuses.length)
      {issues.push({
        field: 'acceptedStatuses',
        message: 'At least one accepted HTTP status is required.',
      });}
    for (const [semantic, field] of Object.entries(provider.fieldMappings)) {
      if (
        !SAFE_MAPPING_KEYS[config.channel].includes(semantic as CanonicalMessageField) ||
        !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(field ?? '')
      ) {
        issues.push({
          field: `fieldMappings.${semantic}`,
          message: 'Field mappings must use an allowed semantic and a safe field path.',
        });
      }
    }
  }
  return issues;
}

export function serializeMessagingConfigSave(
  config: MessagingConfigurationMetadata,
  secretAction: SecretAction,
  replacement = ''
): MessagingConfigurationPutRequest {
  const body: MessagingConfigurationPutRequest = {
    channel: config.channel,
    providerName: config.providerName,
    enabled: config.enabled,
    providerConfig: config.providerConfig as unknown as Record<string, unknown>,
    secretAction,
  };
  if (secretAction === 'replace') {
    body.secret =
      config.providerName === 'custom' ? { secret: replacement } : { apiKey: replacement };
  }
  return body;
}

export async function saveMessagingProviderConfig(
  config: MessagingConfigurationMetadata,
  secretAction: SecretAction,
  replacement = ''
): Promise<MessagingConfigurationMetadata> {
  const raw = await adminMessagingRequest('/api/messaging-configuration', {
    method: 'PUT',
    body: JSON.stringify(serializeMessagingConfigSave(config, secretAction, replacement)),
  });
  return (
    normalizeConfiguration(raw) ?? {
      ...config,
      credentialConfigured:
        secretAction === 'replace'
          ? true
          : secretAction === 'remove'
            ? false
            : config.credentialConfigured,
    }
  );
}

export async function deleteMessagingProviderConfig(channel: MessagingChannel): Promise<void> {
  await adminMessagingRequest('/api/messaging-configuration', {
    method: 'DELETE',
    body: JSON.stringify({ channel }),
  });
}

export async function testConfiguredMessagingProvider(request: {
  channel: MessagingChannel;
  providerName: MessagingProviderName;
  recipient: string;
  configRevision: string;
  live: boolean;
}): Promise<MessagingResponse> {
  const idempotencyKey = messagingIdempotencyKey(
    `provider-config-test-${request.channel}`,
    `${request.providerName}|${request.recipient}|${request.configRevision}|${request.live}`
  );
  const raw = await adminMessagingRequest('/api/messaging-test-send', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      channel: request.channel,
      recipient: request.recipient,
      dryRun: !request.live,
      confirmRealSend: request.live,
    }),
  });
  return normalizeResponse(raw, 1, !request.live) ?? failedResponse(1, !request.live);
}

export { BUILTIN_ENDPOINTS, SAFE_MAPPING_KEYS };
