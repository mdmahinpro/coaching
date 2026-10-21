/**
 * Configurable SMS gateway.
 *
 * The centre can point the app at any HTTP SMS gateway (ZenSMS, a local
 * Bangladeshi reseller, or anything ZenSMS-compatible) by setting a base URL,
 * sender ID and API key in Admin → Settings → SMS. Those live in the
 * admin-only `sms_gateway_config` table; the environment variables remain the
 * fallback so an existing deploy keeps working without touching the DB.
 *
 * Supported request shapes:
 *   GET  — query params: api_key, sender_id, to, message
 *   POST — JSON body with the same four keys
 */

export type GatewayProvider = 'zendsms' | 'custom';
export type GatewayMethod = 'GET' | 'POST';

export interface GatewayConfig {
  provider: GatewayProvider;
  baseUrl: string;
  senderId: string;
  apiKey: string;
  method: GatewayMethod;
  /** Where the values came from — surfaced to the admin UI. */
  source: 'database' | 'env' | 'none';
}

export const DEFAULT_ZENDSMS_URL = 'https://api.zendsms.com/api/simple/send';

export interface GatewayRow {
  provider?: string | null;
  base_url?: string | null;
  sender_id?: string | null;
  api_key?: string | null;
  http_method?: string | null;
}

const asMethod = (v: unknown): GatewayMethod =>
  String(v ?? '').toUpperCase() === 'POST' ? 'POST' : 'GET';

/**
 * DB row wins when it carries a key; otherwise fall back to the env pair.
 * Anything incomplete degrades to `source: 'none'` so the caller can report
 * "not configured" instead of silently dropping messages.
 */
export function resolveGatewayConfig(
  row: GatewayRow | null | undefined,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): GatewayConfig {
  const dbKey = (row?.api_key ?? '').trim();
  const dbUrl = (row?.base_url ?? '').trim();
  const provider: GatewayProvider =
    String(row?.provider ?? '').toLowerCase() === 'custom' ? 'custom' : 'zendsms';

  if (dbKey) {
    return {
      provider,
      baseUrl: dbUrl || DEFAULT_ZENDSMS_URL,
      senderId: (row?.sender_id ?? '').trim(),
      apiKey: dbKey,
      method: asMethod(row?.http_method),
      source: 'database',
    };
  }

  const envKey = (env.SMS_API_KEY ?? '').trim();
  if (envKey) {
    return {
      provider: 'zendsms',
      baseUrl: (env.SMS_GATEWAY_URL ?? '').trim() || DEFAULT_ZENDSMS_URL,
      senderId: (env.SMS_SENDER_ID ?? '').trim(),
      apiKey: envKey,
      method: asMethod(env.SMS_GATEWAY_METHOD),
      source: 'env',
    };
  }

  return {
    provider,
    baseUrl: dbUrl || (env.SMS_GATEWAY_URL ?? '').trim() || DEFAULT_ZENDSMS_URL,
    senderId: (row?.sender_id ?? env.SMS_SENDER_ID ?? '').trim(),
    apiKey: '',
    method: asMethod(row?.http_method ?? env.SMS_GATEWAY_METHOD),
    source: 'none',
  };
}

export interface GatewayRequest {
  url: string;
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string };
}

/** Build the actual HTTP call for one recipient. */
export function buildGatewayRequest(
  config: GatewayConfig,
  to: string,
  message: string
): GatewayRequest {
  const params = {
    api_key: config.apiKey,
    sender_id: config.senderId,
    to,
    message,
  };

  if (config.method === 'POST') {
    return {
      url: config.baseUrl,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: config.apiKey },
        body: JSON.stringify(params),
      },
    };
  }

  const qs = new URLSearchParams(params).toString();
  const joiner = config.baseUrl.includes('?') ? '&' : '?';
  return { url: `${config.baseUrl}${joiner}${qs}`, init: { method: 'GET' } };
}

/**
 * Provider-agnostic success test. Gateways disagree wildly on the payload, so
 * a 2xx with no explicit failure marker counts as accepted — but any of
 * `success:false`, an error code outside the known-good set, or
 * `status: failed/error` is a rejection.
 */
export function isGatewaySuccess(httpOk: boolean, raw: unknown): boolean {
  if (!httpOk) return false;
  if (!raw || typeof raw !== 'object') return true;

  const r = raw as Record<string, unknown>;
  if (r.success === false || r.ok === false) return false;

  const status = String(r.status ?? '').toLowerCase();
  if (status === 'failed' || status === 'error' || status === 'rejected') return false;

  const code = r.code ?? r.status_code;
  if (typeof code === 'number' && ![0, 200, 1000].includes(code)) return false;
  if (typeof code === 'string' && /^\d+$/.test(code) && ![0, 200, 1000].includes(Number(code))) {
    return false;
  }

  return true;
}

/** Pull the gateway's own explanation out of whatever shape it replied with. */
export function gatewayReason(raw: unknown): string {
  if (raw == null) return 'no response from gateway';
  if (typeof raw === 'string') return raw.slice(0, 200);
  const r = raw as Record<string, unknown>;
  for (const key of ['message', 'error', 'description', 'detail', 'statusMessage']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  if (r.error && typeof r.error === 'object') {
    const nested = (r.error as Record<string, unknown>).message;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return JSON.stringify(raw).slice(0, 200);
}
