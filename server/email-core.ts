/** Provider-neutral transactional email adapter. API keys stay server-side. */
import { fetchProvider } from './safe-url';
export interface EmailRequestBody {
  emails: string[];
  subject: string;
  html: string;
  templateType?: string;
}

async function verifyAdmin(authHeader: string | undefined): Promise<boolean> {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return false;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return r.ok && (await r.json()) === true;
  } catch { return false; }
}

async function emailConfig(authHeader?: string) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return {};
  try {
    const r = await fetch(`${url}/rest/v1/provider_secrets?provider=eq.email&select=api_key,endpoint,from_email`, { headers: { apikey: anon, ...(authHeader ? { Authorization: authHeader } : {}) } });
    const row = (await r.json() as Array<{ api_key?: string; endpoint?: string; from_email?: string }>)[0];
    if (row) return { email_api_key: row.api_key, email_endpoint: row.endpoint, email_from: row.from_email };
    const legacy = await fetch(`${url}/rest/v1/site_settings?key=in.(email_provider,email_endpoint,email_from)&select=key,value`, { headers: { apikey: anon, ...(authHeader ? { Authorization: authHeader } : {}) } });
    const rows = await legacy.json() as Array<{ key: string; value: string }>;
    return Object.fromEntries((rows ?? []).map((item) => [item.key, item.value]));
  } catch { return {}; }
}

export async function handleSendEmail(method: string, authHeader: string | undefined, rawBody: unknown) {
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
  if (!(await verifyAdmin(authHeader))) return { status: 401, body: { error: 'Unauthorized' } };
  let body: EmailRequestBody;
  try { body = (typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody) as EmailRequestBody; }
  catch { return { status: 400, body: { error: 'Invalid JSON body' } }; }
  const emails = Array.isArray(body?.emails) ? body.emails.filter(Boolean) : [];
  if (!emails.length || !body.subject || !body.html) {
    return { status: 400, body: { error: 'emails, subject and html are required' } };
  }

  const config = await emailConfig(authHeader) as Record<string, string | undefined>;
  const provider = config.email_provider || process.env.EMAIL_PROVIDER || 'resend';
  const apiKey = config.email_api_key || process.env.EMAIL_API_KEY;
  const from = config.email_from || process.env.EMAIL_FROM;
  const endpoint = config.email_endpoint || process.env.EMAIL_ENDPOINT || 'https://api.resend.com/emails';
  if (!apiKey || !from) return { status: 200, body: { status: 'pending', sent: 0, failed: 0 } };

  try {
    let response: Response;
    if (provider === 'resend') {
      response = await fetchProvider(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: emails, subject: body.subject, html: body.html }),
      });
    } else {
      // Generic JSON provider contract: useful for Brevo, Mailgun gateways,
      // local relays, or a Bangladesh provider with an HTTP JSON API.
      response = await fetchProvider(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: emails, subject: body.subject, html: body.html }),
      });
    }
    const raw = await response.json().catch(() => null);
    return { status: 200, body: { status: response.ok ? 'sent' : 'failed', sent: response.ok ? emails.length : 0, failed: response.ok ? 0 : emails.length, raw } };
  } catch (error) {
    return { status: 502, body: { status: 'failed', sent: 0, failed: emails.length, error: String(error) } };
  }
}
