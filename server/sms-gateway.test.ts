import { describe, expect, it } from 'vitest';
import {
  buildGatewayRequest,
  gatewayReason,
  isGatewaySuccess,
  resolveGatewayConfig,
} from './sms-gateway';

const DB_ROW = {
  provider: 'custom',
  base_url: 'https://sms.example.com/api/send',
  sender_id: '8809612781000',
  api_key: 'db-key',
  http_method: 'GET',
};

describe('resolveGatewayConfig', () => {
  it('prefers the saved DB row over env vars', () => {
    const cfg = resolveGatewayConfig(DB_ROW, { SMS_API_KEY: 'env-key', SMS_SENDER_ID: 'env-sid' });
    expect(cfg).toMatchObject({
      provider: 'custom',
      baseUrl: 'https://sms.example.com/api/send',
      senderId: '8809612781000',
      apiKey: 'db-key',
      source: 'database',
    });
  });

  it('falls back to env vars when the table is empty', () => {
    const cfg = resolveGatewayConfig(null, {
      SMS_API_KEY: 'env-key',
      SMS_SENDER_ID: '8809612781000',
    });
    expect(cfg).toMatchObject({
      provider: 'zendsms',
      baseUrl: 'https://api.zendsms.com/api/simple/send',
      apiKey: 'env-key',
      senderId: '8809612781000',
      source: 'env',
    });
  });

  it('treats a blank saved key as "not configured" so env still works', () => {
    const cfg = resolveGatewayConfig(
      { ...DB_ROW, api_key: '   ' },
      { SMS_API_KEY: 'env-key', SMS_SENDER_ID: 'env-sid' }
    );
    expect(cfg.apiKey).toBe('env-key');
    expect(cfg.source).toBe('env');
  });

  it('reports no key at all rather than inventing one', () => {
    const cfg = resolveGatewayConfig(null, {});
    expect(cfg.apiKey).toBe('');
    expect(cfg.source).toBe('none');
  });
});

describe('buildGatewayRequest', () => {
  it('builds a GET URL with the four standard params', () => {
    const cfg = resolveGatewayConfig(DB_ROW, {});
    const { url, init } = buildGatewayRequest(cfg, '8801768836443', 'ফি বাকি');
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://sms.example.com/api/send');
    expect(parsed.searchParams.get('api_key')).toBe('db-key');
    expect(parsed.searchParams.get('sender_id')).toBe('8809612781000');
    expect(parsed.searchParams.get('to')).toBe('8801768836443');
    expect(parsed.searchParams.get('message')).toBe('ফি বাকি');
    expect(init.method).toBe('GET');
  });

  it('builds a POST with a JSON body and bearer auth', () => {
    const cfg = resolveGatewayConfig({ ...DB_ROW, http_method: 'POST' }, {});
    const { init } = buildGatewayRequest(cfg, '8801768836443', 'hello');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      api_key: 'db-key',
      sender_id: '8809612781000',
      to: '8801768836443',
      message: 'hello',
    });
    expect((init.headers as Record<string, string>).Authorization).toContain('db-key');
  });

  it('keeps an existing query string on the base URL', () => {
    const cfg = resolveGatewayConfig({ ...DB_ROW, base_url: 'https://x.test/send?type=unicode' }, {});
    const { url } = buildGatewayRequest(cfg, '8801768836443', 'hi');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('type')).toBe('unicode');
    expect(parsed.searchParams.get('to')).toBe('8801768836443');
  });
});

describe('isGatewaySuccess / gatewayReason', () => {
  it('accepts ZenSMS style success', () => {
    expect(isGatewaySuccess(true, { success: true, code: 1000, message: 'SMS accepted' })).toBe(true);
  });

  it('rejects HTTP errors and explicit failures', () => {
    expect(isGatewaySuccess(false, { success: true })).toBe(false);
    expect(isGatewaySuccess(true, { success: false, code: 2101, message: 'Invalid recipient' })).toBe(
      false
    );
    expect(isGatewaySuccess(true, { status: 'failed', error: 'Insufficient balance' })).toBe(false);
  });

  it('accepts a bare 2xx with a non-JSON body', () => {
    expect(isGatewaySuccess(true, null)).toBe(true);
  });

  it('surfaces the gateway words', () => {
    expect(gatewayReason({ success: false, message: 'Invalid recipient' })).toBe('Invalid recipient');
    expect(gatewayReason({ error: 'Insufficient balance' })).toBe('Insufficient balance');
    expect(gatewayReason(null)).toBe('no response from gateway');
  });
});
