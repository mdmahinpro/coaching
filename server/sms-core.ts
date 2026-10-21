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

export interface MessageRequestBody {
  channel?: 'sms' | 'email';
  phones?: string[];
  emails?: string[];
  message: string;
  subject?: string;
}

export interface SmsCoreResult {
  ok: boolean;
  status: number;
  body: unknown;
}

const ZENDSMS_ENDPOINT = 'https://api.zendsms.com/api/simple/send';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Basic sanity check for an email address (RFC-lite, enough for gating). */
export function isEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

/** Verify the bearer token belongs to an authenticated admin. */
async function verifyAdmin(authHeader: string | undefined): Promise<boolean> {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return false;
  }
  // Accept BOTH naming conventions: Render docs (and Vite) use the VITE_
  // prefixed names, while Supabase-style deployments use the bare ones. Only
  // setting one convention used to make every send fail with 401.
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return false;
  }
  try {
    // Check via the SECURITY DEFINER `is_admin()` RPC — the same server-side
    // roster the app's own route guard uses (`admin_users` table against
    // `auth.uid()`). Historically this checked `user_metadata.role`, but that
    // field is empty for admins created through the dashboard/fixture flow.
    const res = await fetch(`${url}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) {
      return false;
    }
    return (await res.json()) === true;
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

  let body: MessageRequestBody;
  try {
    body = (typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody) as MessageRequestBody;
  } catch {
    return { ok: false, status: 400, body: { error: 'Invalid JSON body' } };
  }

  // ── Email channel (Brevo) ────────────────────────────────────────────────
  if (body?.channel === 'email') {
    return sendEmails(body);
  }

  // ── SMS channel (ZenSMS) — default ───────────────────────────────────────
  const phones = Array.isArray(body?.phones) ? body.phones.filter(Boolean) : [];
  const message = typeof body?.message === 'string' ? body.message : '';
  if (!phones.length || !message) {
    return { ok: false, status: 400, body: { error: 'phones and message are required' } };
  }

  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID || '';

  // No key configured → treat as a no-op "pending" send (dev / demo), but say
  // so loudly: a silent no-op is indistinguishable from "SMS never arrived".
  if (!apiKey) {
    console.warn(
      '[send-sms] SMS_API_KEY is not set on this host — no SMS was sent (status: pending).'
    );
    return {
      ok: true,
      status: 200,
      body: {
        status: 'pending',
        sent: 0,
        raw: null,
        hint: 'SMS_API_KEY is not set in the server environment',
      },
    };
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

/**
 * Brevo transactional email. Up to 50 recipients per API call (Brevo's cap);
 * larger lists are chunked. Addresses are validated and de-duplicated.
 * Without BREVO_API_KEY the call no-ops as "pending" (dev/demo), mirroring
 * the SMS behaviour.
 */
async function sendEmails(body: MessageRequestBody): Promise<SmsCoreResult> {
  const emailsRaw = Array.isArray(body?.emails) ? body.emails.filter(Boolean) : [];
  const emails = [...new Set(emailsRaw.map((e) => e.trim()).filter(isEmail))];
  const message = typeof body?.message === 'string' ? body.message : '';
  const subject =
    typeof body?.subject === 'string' && body.subject.trim()
      ? body.subject.trim()
      : 'Message from your coaching center';

  if (!emails.length || !message) {
    return { ok: false, status: 400, body: { error: 'emails (valid) and message are required' } };
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@techely.com';
  const senderName = process.env.BREVO_SENDER_NAME || 'Coaching Center';

  if (!apiKey) {
    return { ok: true, status: 200, body: { status: 'pending', sent: 0, raw: null } };
  }

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;white-space:pre-wrap">${message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')}</div>`;

  const results: Array<{ email: string; ok: boolean; raw: unknown }> = [];
  try {
    for (let i = 0; i < emails.length; i += 50) {
      const chunk = emails.slice(i, i + 50);
      const res = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: chunk.map((e) => ({ email: e })),
          subject,
          htmlContent: html,
          textContent: message,
        }),
      });
      const raw = await res.json().catch(() => null);
      const ok = res.ok;
      for (const e of chunk) results.push({ email: e, ok, raw: ok ? null : raw });
    }

    const sent = results.filter((r) => r.ok).length;
    return {
      ok: true,
      status: 200,
      body: {
        status: sent === emails.length ? 'sent' : sent > 0 ? 'partial' : 'failed',
        sent,
        raw: results.some((r) => !r.ok) ? results.filter((r) => !r.ok) : null,
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
