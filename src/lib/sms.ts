import { supabase } from './supabase';
import { handleSupabaseError } from '@/utils/errorHandler';

export interface SMSResult {
  sent: number;
  failed: number;
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
    return { sent: 0, failed: 0 };
  }
  const logType = channel === 'email' ? `EMAIL:${type}` : type;

  let sentCount = 0;
  let failedCount = 0;
  let raw: unknown = null;
  let status: 'sent' | 'failed' | 'pending' = 'failed';

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
    const data = raw as { status?: string; sent?: number } | null;
    if (res.ok && (data?.status === 'sent' || data?.status === 'partial')) {
      sentCount = data.sent ?? recipients.length;
      status = 'sent';
    } else if (res.ok && data?.status === 'pending') {
      // No server key configured — treat as queued for demo/dev.
      sentCount = recipients.length;
      status = 'pending';
    } else {
      failedCount = recipients.length;
      status = 'failed';
    }
  } catch (err) {
    console.error('[SMS API Error]', err);
    failedCount = recipients.length;
    status = 'failed';
  }

  // Log to DB (admin is authenticated → RLS permits the insert).
  try {
    await supabase.from('sms_logs').insert(
      recipients.map((p) => ({
        phone: p,
        message,
        type: logType,
        status,
        response: raw,
      }))
    );
  } catch (err) {
    handleSupabaseError(err);
  }

  return { sent: sentCount, failed: failedCount, raw };
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, k) => vars[k] ?? vars[k.trim()] ?? `{${k}}`);
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
