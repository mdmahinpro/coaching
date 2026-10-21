/**
 * Server-side SMS core — shared by the Render (`server/render-server.mjs`),
 * Vercel (`api/send-sms.ts`) and Netlify (`netlify/functions/send-sms.ts`)
 * entrypoints.
 *
 * The SMS gateway credentials live ONLY here: read from the admin-only
 * `sms_gateway_config` table when an admin has saved a gateway in
 * Admin → Settings → SMS, otherwise from the `SMS_API_KEY` / `SMS_SENDER_ID` /
 * `SMS_GATEWAY_URL` server env vars. They are never shipped to the browser.
 *
 * Every request must carry a valid Supabase admin JWT
 * (Authorization: Bearer *** The token is verified against Supabase via the
 * `is_admin()` RPC.
 */

import {
  buildGatewayRequest,
  gatewayReason,
  isGatewaySuccess,
  resolveGatewayConfig,
  type GatewayConfig,
  type GatewayRow,
} from './sms-gateway.ts';

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

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** The Supabase project credentials for this host (either env convention). */
function supabaseEnv(): { url: string; anon: string } | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  return url && anon ? { url, anon } : null;
}

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
  const env = supabaseEnv();
  if (!env) {
    return false;
  }
  try {
    // Check via the SECURITY DEFINER `is_admin()` RPC — the same server-side
    // roster the app's own route guard uses (`admin_users` table against
    // `auth.uid()`). Historically this checked `user_metadata.role`, but that
    // field is empty for admins created through the dashboard/fixture flow.
    const res = await fetch(`${env.url}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: {
        apikey: env.anon,
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
 * Read the gateway the admin saved in Admin → Settings → SMS. The table is
 * admin-only under RLS, so the query carries the caller's own JWT; a missing
 * table (migration not run yet) or a read error simply falls back to env vars.
 */
async function loadGatewayConfig(authHeader: string | undefined): Promise<GatewayConfig> {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  const env = supabaseEnv();
  if (!token || !env) {
    return resolveGatewayConfig(null);
  }
  try {
    const res = await fetch(
      `${env.url}/rest/v1/sms_gateway_config?select=provider,base_url,sender_id,api_key,http_method&id=eq.1&limit=1`,
      {
        headers: {
          apikey: env.anon,
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (!res.ok) {
      return resolveGatewayConfig(null);
    }
    const rows = (await res.json()) as GatewayRow[];
    return resolveGatewayConfig(rows?.[0] ?? null);
  } catch {
    return resolveGatewayConfig(null);
  }
}

/**
 * Normalise a Bangladeshi mobile number to the 8801XXXXXXXXX format ZenSMS
 * expects. Accepts 01XXXXXXXXX, 8801XXXXXXXXX and +8801XXXXXXXXX.
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  // Already international (8801…) — keep as is.
  if (digits.startsWith('8801')) return digits;
  // Local BD format (01XXXXXXXXX) — the trunk '0' MUST be dropped when
  // prefixing the country code: 01768836443 → 8801768836443, never
  // 88001768836443 (ZenSMS rejects the latter with code 2101).
  if (digits.startsWith('01')) return `880${digits.slice(1)}`;
  // Bare subscriber number without trunk prefix (1XXXXXXXXX).
  if (digits.startsWith('1') && digits.length === 10) return `880${digits}`;
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

  // ── SMS channel — gateway chosen in Settings, env fallback ───────────────
  const phones = Array.isArray(body?.phones) ? body.phones.filter(Boolean) : [];
  const message = typeof body?.message === 'string' ? body.message : '';
  if (!phones.length || !message) {
    return { ok: false, status: 400, body: { error: 'phones and message are required' } };
  }

  const config = await loadGatewayConfig(authHeader);

  // Nothing configured → treat as a no-op "pending" send (dev / demo), but say
  // so loudly: a silent no-op is indistinguishable from "SMS never arrived".
  if (!config.apiKey) {
    console.warn(
      '[send-sms] No SMS gateway configured — set one in Admin → Settings → SMS ' +
        'or SMS_API_KEY/SMS_SENDER_ID in the host env. No SMS was sent (status: pending).'
    );
    return {
      ok: true,
      status: 200,
      body: {
        status: 'pending',
        sent: 0,
        raw: null,
        hint: 'No SMS gateway configured — add one in Admin → Settings → SMS',
      },
    };
  }

  // One HTTP call per recipient, sequentially, so a long list cannot trip
  // rate limits; collect per-number results.
  const results: Array<{ phone: string; ok: boolean; raw: unknown }> = [];
  const providerLabel = config.provider === 'zendsms' ? 'ZenSMS' : 'SMS gateway';
  try {
    for (const rawPhone of phones) {
      const to = normalisePhone(rawPhone);
      const req = buildGatewayRequest(config, to, message);
      const res = await fetch(req.url, req.init);
      const raw = await res.json().catch(() => null);
      const success = isGatewaySuccess(res.ok, raw);
      results.push({ phone: to, ok: success, raw });
    }

    const sent = results.filter((r) => r.ok).length;
    if (sent < phones.length) {
      // Pass the gateway's own words through — a bare "failed" is unactionable.
      const firstFail = results.find((r) => !r.ok)?.raw;
      const reason = gatewayReason(firstFail);
      console.warn(
        `[send-sms] ${providerLabel} rejected ${phones.length - sent}/${phones.length}: ${reason}`
      );
      return {
        ok: true,
        status: 200,
        body: {
          status: sent > 0 ? 'partial' : 'failed',
          sent,
          raw: results.map((r) => ({ phone: r.phone, ok: r.ok, raw: r.raw })),
          hint: `${providerLabel}: ${reason}`,
          error: reason,
        },
      };
    }

    return {
      ok: true,
      status: 200,
      body: {
        status: 'sent',
        sent,
        source: config.source,
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
