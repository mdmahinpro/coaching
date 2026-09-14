/* eslint-disable no-unused-vars -- exported type signatures are not visible to the base rule */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
// Type-only imports are consumed by exported signatures; base ESLint cannot see them.
// eslint-disable-next-line no-unused-vars
import type {
  CanonicalMessageField,
  CustomProviderConfiguration,
  MessagingChannel,
  MessagingProviderConfiguration,
  MessagingProviderName,
} from '../shared/messaging-schema';

export type MessagingKeyring = { current: string; keys: ReadonlyMap<string, Buffer> };
export type EncryptedCredential = { ciphertext: string; iv: string; auth_tag: string; key_id: string };
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const SECRET_SHAPED = /^(?:password|passwd|secret|token|api_?key|apikey|credential|authorization|cookie|private_?key)$/i;
const KEY_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const CANONICAL_FIELDS = new Set<CanonicalMessageField>(['recipient', 'message', 'subject', 'html', 'text', 'sender']);
const SENSITIVE_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'host', 'content-length', 'connection',
  'transfer-encoding', 'te', 'trailer', 'upgrade', 'keep-alive', 'proxy-authenticate', 'proxy-connection',
]);

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function keysAllowed(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): boolean {
  return Object.keys(value).every((key) => allowed.includes(key) && !FORBIDDEN.has(key)) && required.every((key) => key in value);
}
function canonicalBase64(value: unknown, bytes?: number): Buffer | null {
  if (typeof value !== 'string' || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {return null;}
  const decoded = Buffer.from(value, 'base64');
  return (bytes === undefined || decoded.length === bytes) && decoded.toString('base64') === value ? decoded : null;
}

export function parseMessagingKeyring(raw = process.env.MESSAGING_ENCRYPTION_KEYS_JSON): MessagingKeyring {
  if (!raw) {throw new Error('Messaging encryption keyring is not configured');}
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Invalid messaging encryption keyring'); }
  if (!plainObject(parsed) || !keysAllowed(parsed, ['current', 'keys']) || typeof parsed.current !== 'string' || !KEY_ID_RE.test(parsed.current) || !plainObject(parsed.keys)) {throw new Error('Invalid messaging encryption keyring');}
  const entries = Object.entries(parsed.keys);
  if (!entries.length || entries.some(([id]) => !KEY_ID_RE.test(id) || FORBIDDEN.has(id))) {throw new Error('Invalid messaging encryption keyring');}
  const keys = new Map<string, Buffer>();
  for (const [id, encoded] of entries) {
    const key = canonicalBase64(encoded, 32);
    if (!key) {throw new Error('Invalid messaging encryption keyring');}
    keys.set(id, key);
  }
  if (!keys.has(parsed.current)) {throw new Error('Invalid messaging encryption keyring');}
  return { current: parsed.current, keys };
}

function aad(channel: MessagingChannel, provider: MessagingProviderName, revision: string): Buffer {
  if (!UUID_RE.test(revision)) {throw new Error('Invalid messaging credential revision');}
  return Buffer.from(`${channel}\u0000${provider}\u0000${revision.toLowerCase()}`, 'utf8');
}
function constantTimeIdEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}
function keyForId(keyring: MessagingKeyring, id: string): Buffer | null {
  let selected: Buffer | null = null;
  for (const [candidate, key] of keyring.keys) {if (constantTimeIdEqual(candidate, id)) {selected = key;}}
  return selected;
}

export function encryptMessagingCredential(value: unknown, channel: MessagingChannel, provider: MessagingProviderName, revision: string, keyring = parseMessagingKeyring()): EncryptedCredential {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  if (plaintext.length > 65_536) {throw new Error('Provider secret is too large');}
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyring.keys.get(keyring.current)!, iv);
  cipher.setAAD(aad(channel, provider, revision));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), auth_tag: cipher.getAuthTag().toString('base64'), key_id: keyring.current };
}

export function decryptMessagingCredential(row: EncryptedCredential, channel: MessagingChannel, provider: MessagingProviderName, revision: string, keyring = parseMessagingKeyring()): unknown {
  const key = keyForId(keyring, row.key_id);
  const iv = canonicalBase64(row.iv, 12);
  const tag = canonicalBase64(row.auth_tag, 16);
  const ciphertext = canonicalBase64(row.ciphertext);
  if (!key || !iv || !tag || !ciphertext || ciphertext.length > 65_536) {throw new Error('Messaging credential cannot be decrypted');}
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad(channel, provider, revision));
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  } catch { throw new Error('Messaging credential cannot be decrypted'); }
}

export function safeDotPath(value: unknown): string[] | null {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\r\n]/.test(value)) {return null;}
  const parts = value.split('.');
  return parts.every((part) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(part) && !FORBIDDEN.has(part) && !SECRET_SHAPED.test(part)) ? parts : null;
}
export function getScalarAtPath(root: unknown, path: string): string | number | boolean | null | undefined {
  const parts = safeDotPath(path); if (!parts) {return undefined;}
  let cursor: unknown = root;
  for (const part of parts) {
    if (!plainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, part)) {return undefined;}
    cursor = cursor[part];
  }
  return cursor === null || ['string', 'number', 'boolean'].includes(typeof cursor) ? cursor as string | number | boolean | null : undefined;
}
export function setAtPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = safeDotPath(path); if (!parts) {throw new Error('Invalid provider field path');}
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const existing = cursor[parts[index]];
    if (existing === undefined) {cursor[parts[index]] = Object.create(null) as Record<string, unknown>;}
    else if (!plainObject(existing) && Object.getPrototypeOf(existing) !== null) {throw new Error('Provider field path conflicts with a scalar');}
    cursor = cursor[parts[index]] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

export function compileCustomTemplate(): never {
  throw new Error('Static custom provider templates are not supported');
}
function validHeaderName(name: unknown): name is string {
  return typeof name === 'string' && HEADER_NAME_RE.test(name) && !SENSITIVE_HEADERS.has(name.toLowerCase()) && !SECRET_SHAPED.test(name);
}
function allowedCustomEndpoints(): Set<string> {
  return new Set((process.env.MESSAGING_CUSTOM_ENDPOINT_ALLOWLIST ?? '').split(',').map((item) => item.trim()).filter(Boolean).map((item) => normalizeEndpoint(item, 'Invalid custom endpoint allowlist')));
}
function normalizeEndpoint(value: string, message: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(message); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || /[\r\n]/.test(value)) {throw new Error(message);}
  return url.toString();
}
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {return null;}
  const cleaned = value.trim();
  return cleaned && cleaned.length <= max && !/[\r\n]/.test(cleaned) && !/\{\{|\}\}|<%|eval\s*\(|function\s*\(/i.test(cleaned) ? cleaned : null;
}

export function validateProviderConfiguration(channel: MessagingChannel, providerName: MessagingProviderName, raw: unknown): MessagingProviderConfiguration {
  if (!plainObject(raw)) {throw new Error('providerConfig must be an object');}
  if ('providerName' in raw && raw.providerName !== providerName) {throw new Error('providerName does not match providerConfig');}
  const withoutName = { ...raw }; delete withoutName.providerName;
  if (providerName === 'mim') {
    if (channel !== 'sms' || !keysAllowed(withoutName, ['userName', 'senderName']) || !cleanText(withoutName.userName, 100) || typeof withoutName.senderName !== 'string' || !/^[A-Za-z0-9]{1,11}$/.test(withoutName.senderName)) {throw new Error('Invalid MIM configuration');}
    return { providerName, userName: cleanText(withoutName.userName, 100)!, senderName: withoutName.senderName };
  }
  if (providerName === 'resend') {
    const from = cleanText(withoutName.from, 320);
    if (channel !== 'email' || !keysAllowed(withoutName, ['from']) || !from) {throw new Error('Invalid Resend configuration');}
    return { providerName, from };
  }
  const allowed = ['endpoint', 'method', 'auth', 'idempotency', 'fieldMappings', 'acceptedStatuses', 'success', 'providerIdPath', 'senderIdentity'];
  if (!keysAllowed(withoutName, allowed, ['endpoint', 'method', 'idempotency', 'fieldMappings', 'acceptedStatuses', 'providerIdPath']) || typeof withoutName.endpoint !== 'string') {throw new Error('Invalid custom provider configuration');}
  const endpoint = normalizeEndpoint(withoutName.endpoint, 'Invalid custom provider endpoint');
  if (!allowedCustomEndpoints().has(endpoint)) {throw new Error('Custom provider endpoint is not exactly allowlisted');}
  if (withoutName.method !== 'POST') {throw new Error('Custom providers must use POST');}
  if (!plainObject(withoutName.fieldMappings) || !Object.keys(withoutName.fieldMappings).length || Object.entries(withoutName.fieldMappings).some(([field, path]) => !CANONICAL_FIELDS.has(field as CanonicalMessageField) || !safeDotPath(path))) {throw new Error('Invalid custom provider field mappings');}
  if (!plainObject(withoutName.idempotency) || !['header', 'body', 'none'].includes(String(withoutName.idempotency.placement))) {throw new Error('Invalid custom provider idempotency configuration');}
  if (withoutName.idempotency.placement === 'header' && (!keysAllowed(withoutName.idempotency, ['placement', 'name']) || !validHeaderName(withoutName.idempotency.name))) {throw new Error('Invalid idempotency header');}
  if (withoutName.idempotency.placement === 'body' && (!keysAllowed(withoutName.idempotency, ['placement', 'path']) || !safeDotPath(withoutName.idempotency.path))) {throw new Error('Invalid idempotency body path');}
  if (withoutName.idempotency.placement === 'none' && !keysAllowed(withoutName.idempotency, ['placement'])) {throw new Error('Invalid idempotency configuration');}
  if (!Array.isArray(withoutName.acceptedStatuses) || !withoutName.acceptedStatuses.length || withoutName.acceptedStatuses.length > 20 || withoutName.acceptedStatuses.some((status) => !Number.isInteger(status) || status < 200 || status > 599) || new Set(withoutName.acceptedStatuses).size !== withoutName.acceptedStatuses.length) {throw new Error('Invalid accepted statuses');}
  if (!safeDotPath(withoutName.providerIdPath)) {throw new Error('Invalid provider ID path');}
  if (withoutName.auth !== undefined && (!plainObject(withoutName.auth) || !['header', 'body'].includes(String(withoutName.auth.placement)) || withoutName.auth.placement === 'header' && (!keysAllowed(withoutName.auth, ['placement', 'name', 'scheme'], ['placement', 'name']) || !validHeaderName(withoutName.auth.name) || withoutName.auth.scheme !== undefined && !cleanText(withoutName.auth.scheme, 32)) || withoutName.auth.placement === 'body' && (!keysAllowed(withoutName.auth, ['placement', 'path']) || !safeDotPath(withoutName.auth.path)))) {throw new Error('Invalid custom provider auth configuration');}
  if (withoutName.success !== undefined && (!plainObject(withoutName.success) || !keysAllowed(withoutName.success, ['path', 'value']) || !safeDotPath(withoutName.success.path) || !(withoutName.success.value === null || ['string', 'number', 'boolean'].includes(typeof withoutName.success.value)))) {throw new Error('Invalid custom provider success condition');}
  const senderIdentity = withoutName.senderIdentity === undefined ? undefined : cleanText(withoutName.senderIdentity, 320);
  if (withoutName.senderIdentity !== undefined && !senderIdentity) {throw new Error('Invalid sender identity');}
  return {
    providerName, endpoint, method: 'POST', auth: withoutName.auth as CustomProviderConfiguration['auth'],
    idempotency: withoutName.idempotency as CustomProviderConfiguration['idempotency'],
    fieldMappings: withoutName.fieldMappings as CustomProviderConfiguration['fieldMappings'],
    acceptedStatuses: withoutName.acceptedStatuses as number[], success: withoutName.success as CustomProviderConfiguration['success'],
    providerIdPath: withoutName.providerIdPath as string, ...(senderIdentity ? { senderIdentity } : {}),
  };
}

export function validateProviderSecret(provider: MessagingProviderName, value: unknown): Record<string, string> {
  const parsed = typeof value === 'string' ? (provider === 'custom' ? { secret: value } : (() => { try { return JSON.parse(value); } catch { return null; } })()) : value;
  if (!plainObject(parsed)) {throw new Error('Invalid provider secret');}
  const keys = provider === 'custom' ? ['secret'] : ['apiKey'];
  if (!keysAllowed(parsed, keys) || keys.some((key) => !cleanText(parsed[key], 8192))) {throw new Error('Invalid provider secret');}
  return Object.fromEntries(keys.map((key) => [key, cleanText(parsed[key], 8192)!]));
}

export function credentialFingerprint(secret: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(secret)).digest('hex');
}
export function credentialHint(secret: Record<string, string>): string {
  const value = secret.secret ?? secret.apiKey ?? '';
  return value.length <= 4 ? '****' : `…${value.slice(-4)}`;
}
