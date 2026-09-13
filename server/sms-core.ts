/**
 * Server-side SMS core — shared by the Vercel (`api/send-sms.ts`) and
 * Netlify (`netlify/functions/send-sms.ts`) entrypoints.
 *
 * The MIM SMS API key lives ONLY here, sourced from the `SMS_API_KEY`
 * server env var. It is never shipped to the browser bundle.
 *
 * Every request must carry a valid Supabase admin JWT
 * (Authorization: Bearer <access_token>). Authorization is decided by the
 * server-side `is_admin()` RPC, which reads the `admin_users` roster — not by
 * `user_metadata`, which the browser can rewrite via `auth.updateUser()`.
 */
import { fetchProvider } from './safe-url';

export interface SmsRequestBody {
  phones: string[];
  message: string;
}

export interface SmsCoreResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function providerConfig(authHeader?: string) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return {};
  try {
    const r = await fetch(`${url}/rest/v1/provider_secrets?provider=eq.sms&select=api_key,endpoint,sender_id`, { headers: { apikey: anon, ...(authHeader ? { Authorization: authHeader } : {}) } });
    const row = (await r.json() as Array<{ api_key?: string; endpoint?: string; sender_id?: string }>)[0];
    if (row) return { sms_api_key: row.api_key, sms_endpoint: row.endpoint, sms_sender_id: row.sender_id };
    const legacy = await fetch(`${url}/rest/v1/site_settings?key=in.(sms_provider,sms_endpoint,sms_sender_id)&select=key,value`, { headers: { apikey: anon, ...(authHeader ? { Authorization: authHeader } : {}) } });
    const rows = await legacy.json() as Array<{ key: string; value: string }>;
    return Object.fromEntries((rows ?? []).map((item) => [item.key, item.value]));
  } catch { return {}; }
}

/**
 * Verify the bearer token belongs to an authenticated admin.
 *
 * `is_admin()` is a SECURITY DEFINER function that resolves `auth.uid()` from
 * the presented JWT and looks it up in the server-only `admin_users` table.
 * Calling it with the caller's own token (not a privileged key) means an
 * invalid or expired token yields a non-2xx response, and a valid non-admin
 * token yields `false`. The roster is not writable from the browser, so a
 * self-declared `user_metadata.role` grants nothing here.
 */
async function verifyAdmin(authHeader: string | undefined): Promise<boolean> {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return false;
  }
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return false;
  }
  try {
    const res = await fetch(`${url}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) {
      return false;
    }
    // The RPC returns a bare JSON boolean.
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

/**
 * Core handler independent of the host framework.
 * Returns a plain result the entrypoint serializes to its response type.
 */
export async function handleSendSms(
  method: string,
  authHeader: string | undefined,
  rawBody: unknown
): Promise<SmsCoreResult> {
  if (method !== 'POST') {
    return { ok: false, status: 405, body: { error: 'Method not allowed' } };
  }

  const isAdmin = await verifyAdmin(authHeader);
  if (!isAdmin) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } };
  }

  let body: SmsRequestBody;
  try {
    body = (typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody) as SmsRequestBody;
  } catch {
    return { ok: false, status: 400, body: { error: 'Invalid JSON body' } };
  }

  const phones = Array.isArray(body?.phones) ? body.phones.filter(Boolean) : [];
  const message = typeof body?.message === 'string' ? body.message : '';
  if (!phones.length || !message) {
    return { ok: false, status: 400, body: { error: 'phones and message are required' } };
  }

  const config = await providerConfig(authHeader) as Record<string, string | undefined>;
  const apiKey = config.sms_api_key || process.env.SMS_API_KEY;
  const senderId = config.sms_sender_id || process.env.SMS_SENDER_ID || 'CoachMS';
  const endpoint = config.sms_endpoint || process.env.SMS_ENDPOINT || 'https://api.mimsms.com/smsapi';

  // No key configured → treat as a no-op "pending" send (dev / demo).
  if (!apiKey) {
    return { ok: true, status: 200, body: { status: 'pending', sent: 0, raw: null } };
  }

  try {
    const provider = String(config.sms_provider || process.env.SMS_PROVIDER || 'mimsms').toLowerCase();
    const requestBody = provider === 'mimsms'
      ? {
          api_key: apiKey,
          senderid: senderId,
          type: 'text',
          scheduleat: '',
          route: 'T',
          contacts: phones.join(','),
          msg: message,
        }
      : {
          api_key: apiKey,
          sender: senderId,
          to: phones,
          message,
        };
    const res = await fetchProvider(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const raw = await res.json().catch(() => null);
    const status = (raw as { status?: string } | null)?.status;
    return {
      ok: true,
      status: 200,
      body: {
        status: status === 'success' ? 'sent' : 'failed',
        sent: status === 'success' ? phones.length : 0,
        raw,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: { status: 'failed', sent: 0, error: String(err) },
    };
  }
}
