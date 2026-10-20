/**
 * Server-side SMS core — shared by the Render (`server/render-server.mjs`),
 * Vercel (`api/send-sms.ts`) and Netlify (`netlify/functions/send-sms.ts`)
 * entrypoints.
 *
 * The ZenSMS API key lives ONLY here, sourced from the `SMS_API_KEY` server
 * env var. It is never shipped to the browser bundle.
 *
 * Every request must carry a valid Supabase admin JWT
 * (Authorization: Bearer <token>). The token is verified against Supabase,
 * and the caller must have user_metadata.role === 'admin'.
 */

export interface SmsRequestBody {
  phones: string[];
  message: string;
}

export interface SmsCoreResult {
  ok: boolean;
  status: number;
  body: unknown;
}

const ZENDSMS_ENDPOINT = 'https://api.zendsms.com/api/simple/send';

/** Verify the bearer token belongs to an authenticated admin. */
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
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return false;
    }
    const user = (await res.json()) as { user_metadata?: { role?: string } };
    return user?.user_metadata?.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Normalise a Bangladeshi mobile number to the 8801XXXXXXXXX format ZenSMS
 * expects. Accepts 01XXXXXXXXX, 8801XXXXXXXXX and +8801XXXXXXXXX.
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  if (digits.startsWith('8801')) return digits;
  if (digits.startsWith('01')) return `880${digits}`;
  return digits;
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

  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID || '';

  // No key configured → treat as a no-op "pending" send (dev / demo).
  if (!apiKey) {
    return { ok: true, status: 200, body: { status: 'pending', sent: 0, raw: null } };
  }

  // ZenSMS simple API: one GET per recipient. Send sequentially so a long
  // recipient list cannot trip rate limits; collect per-number results.
  const results: Array<{ phone: string; ok: boolean; raw: unknown }> = [];
  try {
    for (const rawPhone of phones) {
      const to = normalisePhone(rawPhone);
      const url =
        `${ZENDSMS_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}` +
        `&to=${encodeURIComponent(to)}` +
        `&sender_id=${encodeURIComponent(senderId)}` +
        `&message=${encodeURIComponent(message)}`;
      const res = await fetch(url);
      const raw = await res.json().catch(() => null);
      const success =
        res.ok && (raw as { success?: boolean } | null)?.success === true;
      results.push({ phone: to, ok: success, raw });
    }

    const sent = results.filter((r) => r.ok).length;
    return {
      ok: true,
      status: 200,
      body: {
        status: sent === phones.length ? 'sent' : sent > 0 ? 'partial' : 'failed',
        sent,
        raw: results,
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
