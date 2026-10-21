// Supabase Edge Function — messaging proxy (SMS via ZenSMS, email via Brevo).
//
// Why this exists: it replaces the Node `/api/send-sms` endpoint so the app can
// be hosted on plain static hosting (shared hosting, Netlify, Vercel, GitHub
// Pages) without a server, and without a VPS.
//
// Deploy:
//   npx supabase functions deploy send-sms --project-ref <ref> --no-verify-jwt
// Secrets (never in the client bundle):
//   npx supabase secrets set SMS_API_KEY=… SMS_SENDER_ID=8809612781000 \
//     BREVO_API_KEY=… BREVO_SENDER_EMAIL=… BREVO_SENDER_NAME="…" \
//     --project-ref <ref>
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by Supabase.
//
// Security: every request must carry an admin Supabase JWT in
// `Authorization: Bearer <access_token>`; it is verified against GoTrue and the
// caller must have user_metadata.role === 'admin'.

const ZENDSMS_ENDPOINT = 'https://api.zendsms.com/api/simple/send';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

interface MessageBody {
  channel?: 'sms' | 'email';
  phones?: string[];
  emails?: string[];
  message?: string;
  subject?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

/** Basic email sanity check (RFC-lite). */
function isEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

/** Normalise a BD mobile number to 8801XXXXXXXXX as ZenSMS expects. */
function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  if (digits.startsWith('8801')) return digits;
  if (digits.startsWith('01')) return `880${digits}`;
  return digits;
}

/** Verify the bearer token belongs to an authenticated admin. */
async function verifyAdmin(authHeader: string | undefined): Promise<boolean> {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return false;

  try {
    // Check via the SECURITY DEFINER `is_admin()` RPC — the same server-side
    // roster the app's own route guard uses. (user_metadata.role is empty for
    // admins created via the dashboard/fixture flow, so it is not reliable.)
    const res = await fetch(`${url}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

/** Email channel — Brevo transactional API, 50 recipients per call. */
async function sendEmails(body: MessageBody): Promise<Response> {
  const rawList = Array.isArray(body.emails) ? body.emails.filter(Boolean) : [];
  const emails = [...new Set(rawList.map((e) => e.trim()).filter(isEmail))];
  const message = typeof body.message === 'string' ? body.message : '';
  const subject =
    typeof body.subject === 'string' && body.subject.trim()
      ? body.subject.trim()
      : 'Message from your coaching center';

  if (!emails.length || !message) {
    return json(400, { error: 'emails (valid) and message are required' });
  }

  const apiKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL') || 'no-reply@techely.com';
  const senderName = Deno.env.get('BREVO_SENDER_NAME') || 'Coaching Center';

  // No key configured → no-op "pending", same as SMS.
  if (!apiKey) {
    return json(200, { status: 'pending', sent: 0, raw: null });
  }

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;white-space:pre-wrap">${
    message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>')
  }</div>`;

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
    return json(200, {
      status: sent === emails.length ? 'sent' : sent > 0 ? 'partial' : 'failed',
      sent,
      raw: results.some((r) => !r.ok) ? results.filter((r) => !r.ok) : null,
    });
  } catch (err) {
    return json(502, { status: 'failed', sent: 0, error: String(err) });
  }
}

/** SMS channel — ZenSMS simple API, one request per recipient, sequential. */
async function sendSms(body: MessageBody): Promise<Response> {
  const phones = Array.isArray(body.phones) ? body.phones.filter(Boolean) : [];
  const message = typeof body.message === 'string' ? body.message : '';
  if (!phones.length || !message) {
    return json(400, { error: 'phones and message are required' });
  }

  const apiKey = Deno.env.get('SMS_API_KEY');
  const senderId = Deno.env.get('SMS_SENDER_ID') || '';

  if (!apiKey) {
    return json(200, { status: 'pending', sent: 0, raw: null });
  }

  const results: Array<{ phone: string; ok: boolean; raw: unknown }> = [];
  try {
    for (const rawPhone of phones) {
      const to = normalisePhone(rawPhone);
      const url = `${ZENDSMS_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}` +
        `&to=${encodeURIComponent(to)}` +
        `&sender_id=${encodeURIComponent(senderId)}` +
        `&message=${encodeURIComponent(message)}`;
      const res = await fetch(url);
      const raw = await res.json().catch(() => null);
      const success = res.ok && (raw as { success?: boolean } | null)?.success === true;
      results.push({ phone: to, ok: success, raw });
    }

    const sent = results.filter((r) => r.ok).length;
    if (sent < phones.length) {
      // Pass the gateway's own words through — a bare "failed" is unactionable.
      const firstFail = results.find((r) => !r.ok)?.raw as
        | { message?: string; error?: string; description?: string }
        | null;
      const reason =
        firstFail?.message ||
        firstFail?.error ||
        firstFail?.description ||
        (firstFail ? JSON.stringify(firstFail).slice(0, 200) : 'no response from gateway');
      console.warn(`[send-sms] ZenSMS rejected: ${reason}`);
      return json(200, {
        status: sent > 0 ? 'partial' : 'failed',
        sent,
        raw: results,
        hint: `ZenSMS: ${reason}`,
        error: reason,
      });
    }
    return json(200, {
      status: 'sent',
      sent,
      raw: results,
    });
  } catch (err) {
    return json(502, { status: 'failed', sent: 0, error: String(err) });
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight from a static-hosted SPA.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!(await verifyAdmin(req.headers.get('authorization') ?? undefined))) {
    return json(401, { error: 'Unauthorized' });
  }

  let body: MessageBody;
  try {
    body = (await req.json()) as MessageBody;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  return body?.channel === 'email' ? sendEmails(body) : sendSms(body);
});
