import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptMessagingCredential,
  encryptMessagingCredential,
  getScalarAtPath,
  parseMessagingKeyring,
  setAtPath,
  validateProviderConfiguration,
} from './messaging-configuration';

const key = randomBytes(32).toString('base64');
const oldKey = randomBytes(32).toString('base64');
const ring = JSON.stringify({ current: 'v2', keys: { v1: oldKey, v2: key } });
const revision = '11111111-1111-4111-8111-111111111111';
const nextRevision = '22222222-2222-4222-8222-222222222222';
afterEach(() => vi.unstubAllEnvs());

describe('messaging AES-256-GCM keyring', () => {
  it('strictly accepts canonical 32-byte keys and rejects malformed rings', () => {
    expect(parseMessagingKeyring(ring).current).toBe('v2');
    for (const value of ['', '{}', JSON.stringify({ current: 'v1', keys: { v1: randomBytes(31).toString('base64') } }), JSON.stringify({ current: 'missing', keys: { v1: key } }), JSON.stringify({ current: 'v1', keys: { v1: key }, extra: true })]) expect(() => parseMessagingKeyring(value)).toThrow();
  });
  it('binds canonical-base64 ciphertext to channel, provider, and UUID revision', () => {
    const keyring = parseMessagingKeyring(ring);
    const one = encryptMessagingCredential({ apiKey: 'never-return-me' }, 'email', 'resend', revision, keyring);
    const two = encryptMessagingCredential({ apiKey: 'never-return-me' }, 'email', 'resend', revision, keyring);
    expect(Buffer.from(one.iv, 'base64')).toHaveLength(12);
    expect(one.iv).not.toBe(two.iv);
    expect(decryptMessagingCredential(one, 'email', 'resend', revision, keyring)).toEqual({ apiKey: 'never-return-me' });
    expect(() => decryptMessagingCredential(one, 'sms', 'resend', revision, keyring)).toThrow();
    expect(() => decryptMessagingCredential(one, 'email', 'resend', nextRevision, keyring)).toThrow();
  });
  it('decrypts retired keys and re-encrypts under a new UUID revision', () => {
    const first = parseMessagingKeyring(JSON.stringify({ current: 'v1', keys: { v1: oldKey } }));
    const encrypted = encryptMessagingCredential({ secret: 'old' }, 'sms', 'custom', revision, first);
    const decrypted = decryptMessagingCredential(encrypted, 'sms', 'custom', revision, parseMessagingKeyring(ring));
    const replaced = encryptMessagingCredential(decrypted, 'sms', 'custom', nextRevision, parseMessagingKeyring(ring));
    expect(replaced.key_id).toBe('v2');
    expect(decryptMessagingCredential(replaced, 'sms', 'custom', nextRevision, parseMessagingKeyring(ring))).toEqual({ secret: 'old' });
  });
});

describe('provider configuration security', () => {
  const valid = {
    endpoint: 'https://notify.example.com/v1/send', method: 'POST',
    auth: { placement: 'header', name: 'X-Provider-Auth', scheme: 'Bearer ' },
    idempotency: { placement: 'header', name: 'Idempotency-Key' },
    fieldMappings: { recipient: 'destination', message: 'payload.message', sender: 'sender' },
    acceptedStatuses: [200, 202], success: { path: 'result.ok', value: true }, providerIdPath: 'result.id', senderIdentity: 'Coach',
  };
  it('accepts authoritative built-in shapes', () => {
    expect(validateProviderConfiguration('sms', 'mim', { providerName: 'mim', userName: 'account', senderName: 'COACH' })).toMatchObject({ userName: 'account' });
    expect(validateProviderConfiguration('email', 'resend', { providerName: 'resend', from: 'Coach <coach@example.com>' })).toMatchObject({ providerName: 'resend' });
  });
  it('accepts restricted custom mappings and rejects unsafe metadata', () => {
    vi.stubEnv('MESSAGING_CUSTOM_ENDPOINT_ALLOWLIST', valid.endpoint);
    expect(validateProviderConfiguration('sms', 'custom', valid)).toMatchObject({ providerName: 'custom', method: 'POST' });
    for (const unsafe of [
      { ...valid, endpoint: `${valid.endpoint}?token=x` },
      { ...valid, endpoint: 'https://user:pass@notify.example.com/v1/send' },
      { ...valid, endpoint: 'https://notify.example.com:8443/v1/send' },
      { ...valid, headers: { X: 'static' } }, { ...valid, body: { to: '{{recipient}}' } },
      { ...valid, auth: { placement: 'header', name: 'Cookie' } },
      { ...valid, fieldMappings: { recipient: '__proto__.polluted' } },
      { ...valid, fieldMappings: { arbitrary: 'value' } },
      { ...valid, providerIdPath: 'result.secret' },
      { ...valid, senderIdentity: 'x\r\nInjected: yes' },
    ]) expect(() => validateProviderConfiguration('sms', 'custom', unsafe)).toThrow();
  });
  it('sets and reads safe paths without prototype traversal', () => {
    expect(getScalarAtPath({ result: { id: 'p-1' } }, 'result.id')).toBe('p-1');
    const target: Record<string, unknown> = {};
    setAtPath(target, 'payload.message', 'hello');
    expect(target).toEqual({ payload: { message: 'hello' } });
    expect(() => setAtPath(target, '__proto__.polluted', true)).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
