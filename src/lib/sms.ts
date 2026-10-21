import { supabase } from './supabase';
import { handleSupabaseError } from '@/utils/errorHandler';

export interface SMSResult {
  sent: number;
  failed: number;
  /** `pending` means the server had no provider key — NOTHING was sent. */
  status: 'sent' | 'failed' | 'pending';
  /** Human-readable reason for a non-sent result. */
  hint?: string;
  raw?: unknown;
}

/** Channel used for a send: SMS via ZenSMS, or email via Brevo. */
export type SendChannel = 'sms' | 'email';

interface SendOptions {
  type?: string;
  channel?: SendChannel;
  /** Email channel only: the subject line. */
  subject?: string;
}

/**
 * Endpoints that can serve the messaging proxy, tried in order:
 *   1. `VITE_MSG_ENDPOINT` — pin one explicitly (e.g. the Edge Function URL).
 *   2. `/api/send-sms` — same-origin Node/Render/Vercel/Netlify route.
 *   3. `<supabase>/functions/v1/send-sms` — Supabase Edge Function, which is
 *      what allows hosting the SPA on plain static/shared hosting.
 */
function messageEndpoints(): string[] {
  const explicit = import.meta.env.VITE_MSG_ENDPOINT as string | undefined;
  const supaUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  const edge = supaUrl ? `${supaUrl.replace(/\/$/, '')}/functions/v1/send-sms` : '';
  return [explicit, '/api/send-sms', edge].filter((u): u is string => Boolean(u));
}

/**
 * POST the payload to the first endpoint that answers with JSON. A static host
 * returns its index.html for unknown paths, so a 404 or a non-JSON reply means
 * "this endpoint does not exist here" → fall through to the next one.
 */
async function postMessage(payload: unknown, accessToken?: string): Promise<Response> {
  let lastRes: Response | null = null;
  let lastErr: unknown = null;

  for (const url of messageEndpoints()) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const type = res.headers.get('content-type') ?? '';
      if (res.status === 404 || res.status === 405 || !type.includes('json')) {
        lastRes = res;
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
    }
  }

  if (lastRes) return lastRes;
  throw lastErr ?? new Error('No messaging endpoint available');
}

/**
 * Send SMS/email via a server-side function.
 *
 * The ZenSMS + Brevo API keys are NEVER in the client bundle — they live only
 * in server env (`SMS_API_KEY`, `BREVO_API_KEY`) or Supabase function secrets.
 * This call forwards the admin's Supabase access token for authorization.
 *
 * channel 'sms'   → `to` is phone numbers (01XXXXXXXXX style).
 * channel 'email' → `to` is email addresses (logged in sms_logs with
 *                   type prefixed `EMAIL:` so the log stays one table).
 */
export async function sendSMS(
  to: string | string[],
  message: string,
  type = 'custom',
  opts: SendOptions = {}
): Promise<SMSResult> {
  const channel: SendChannel = opts.channel === 'email' ? 'email' : 'sms';
  const recipients = Array.isArray(to) ? to : [to];
  if (!recipients.length) {
    return { sent: 0, failed: 0, status: 'failed', hint: 'No recipients' };
  }
  const logType = channel === 'email' ? `EMAIL:${type}` : type;

  let sentCount = 0;
  let failedCount = 0;
  let raw: unknown = null;
  let status: 'sent' | 'failed' | 'pending' = 'failed';
  let hint: string | undefined;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    const payload =
      channel === 'email'
        ? { channel, emails: recipients, message, subject: opts.subject }
        : { channel, phones: recipients, message };

    const res = await postMessage(payload, accessToken);
    raw = await res.json().catch(() => null);
    const data = raw as { status?: string; sent?: number; hint?: string; error?: string } | null;
    if (res.ok && (data?.status === 'sent' || data?.status === 'partial')) {
      sentCount = data.sent ?? recipients.length;
      status = 'sent';
    } else if (res.ok && data?.status === 'pending') {
      // No provider key on the server — nothing left this device.
      sentCount = 0;
      status = 'pending';
      hint = data?.hint ?? 'No provider key configured on the server';
    } else {
      failedCount = recipients.length;
      status = 'failed';
      hint =
        data?.hint ??
        data?.error ??
        (res.ok ? 'Unexpected response from the messaging server' : `HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('[SMS API Error]', err);
    failedCount = recipients.length;
    status = 'failed';
    hint = err instanceof Error ? err.message : 'Network error reaching the messaging server';
  }

  // Log to DB (admin is authenticated → RLS permits the insert).
  // Each row carries only its own number's gateway reply, so a per-number
  // failure (e.g. 2101 Invalid recipient) is readable in the log.
  try {
    const last10 = (s: string) => String(s ?? '').replace(/\D/g, '').slice(-10);
    const entries: any[] = Array.isArray((raw as any)?.raw) ? (raw as any).raw : [];
    await supabase.from('sms_logs').insert(
      recipients.map((p) => {
        const entry = entries.find((e) => last10(e?.phone) === last10(p));
        return {
          phone: p,
          message,
          type: logType,
          status: entry ? (entry.ok ? 'sent' : 'failed') : status,
          response: entry ?? raw,
        };
      })
    );
  } catch (err) {
    handleSupabaseError(err);
  }

  return { sent: sentCount, failed: failedCount, status, hint, raw };
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, k) => vars[k] ?? vars[k.trim()] ?? `{${k}}`);
}

/** True when the body contains `{placeholder}` tokens that need per-recipient data. */
export function hasPlaceholders(template: string): boolean {
  return /\{[^}]+\}/.test(template);
}

export const SMS_TEMPLATES: Record<string, { label: string; key: string; body: string }> = {
  FEE_REMINDER: {
    key: 'FEE_REMINDER',
    label: 'Fee Reminder',
    body: 'প্রিয় {নাম}, {মাস} মাসের ৳{পরিমাণ} ফি বাকি। পরিশোধ করুন। - {ইনস্টিটিউট}',
  },
  FEE_PAID: {
    key: 'FEE_PAID',
    label: 'Fee Paid',
    body: 'প্রিয় {নাম}, ৳{পরিমাণ} ফি গ্রহণ। রশিদ: {রশিদ_নং}। ধন্যবাদ। - {ইনস্টিটিউট}',
  },
  EXAM_NOTICE: {
    key: 'EXAM_NOTICE',
    label: 'Exam Notice',
    body: 'পরীক্ষা: {শিরোনাম} — তারিখ: {তারিখ}, সময়: {সময়}। লিংক: {লিংক} - {ইনস্টিটিউট}',
  },
  RESULT_OUT: {
    key: 'RESULT_OUT',
    label: 'Result Published',
    body: '{পরীক্ষা} ফলাফল প্রকাশিত। পোর্টালে লগইন করুন। - {ইনস্টিটিউট}',
  },
  NOTICE: {
    key: 'NOTICE',
    label: 'General Notice',
    body: '{শিরোনাম}: {বার্তা} - {ইনস্টিটিউট}',
  },
  APPROVED: {
    key: 'APPROVED',
    label: 'Admission Approved',
    body: '{নাম}, ভর্তি অনুমোদিত! আইডি: {আইডি}। পোর্টাল: {লিংক} - {ইনস্টিটিউট}',
  },
};
