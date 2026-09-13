import { supabase } from './supabase';
import { handleSupabaseError } from '@/utils/errorHandler';
import { logError } from '@/utils/logger';

export interface SMSResult {
  sent: number;
  failed: number;
  raw?: unknown;
}

/**
 * Send SMS via the server-side function (`/api/send-sms`).
 *
 * The MIM SMS API key is NEVER in the client bundle — it lives only in the
 * serverless function's `SMS_API_KEY` env var. This call forwards the admin's
 * Supabase access token so the function can authorize the request.
 */
export async function sendSMS(
  phones: string | string[],
  message: string,
  type = 'custom'
): Promise<SMSResult> {
  const phoneArr = Array.isArray(phones) ? phones : [phones];
  if (!phoneArr.length) {
    return { sent: 0, failed: 0 };
  }

  let sentCount = 0;
  let failedCount = 0;
  let raw: unknown = null;
  let status: 'sent' | 'failed' | 'pending' = 'failed';

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ phones: phoneArr, message }),
    });
    raw = await res.json().catch(() => null);
    const data = raw as { status?: string; sent?: number } | null;
    if (res.ok && data?.status === 'sent') {
      sentCount = data.sent ?? phoneArr.length;
      status = 'sent';
    } else if (res.ok && data?.status === 'pending') {
      // No server key configured — treat as queued for demo/dev.
      sentCount = phoneArr.length;
      status = 'pending';
    } else {
      failedCount = phoneArr.length;
      status = 'failed';
    }
  } catch (err) {
    logError('SMS send request failed', {
      source: 'sms',
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
    failedCount = phoneArr.length;
    status = 'failed';
  }

  // Log to DB (admin is authenticated → RLS permits the insert).
  try {
    await supabase.from('sms_logs').insert(
      phoneArr.map((p) => ({
        phone: p,
        message,
        type,
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
    body: 'প্রিয় {নাম}, {মাস} মাসের ৳{পরিমাণ} ফি বাকি। অনুগ্রহ করে পরিশোধ করুন। — {ইনস্টিটিউট}',
  },
  FEE_PAID: {
    key: 'FEE_PAID',
    label: 'Fee Paid',
    body: 'প্রিয় {নাম}, ৳{পরিমাণ} ফি গ্রহণ করা হয়েছে। রশিদ: {রশিদ_নং}। ধন্যবাদ। — {ইনস্টিটিউট}',
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
    body: '📢 {শিরোনাম}: {বার্তা} - {ইনস্টিটিউট}',
  },
  APPROVED: {
    key: 'APPROVED',
    label: 'Admission Approved',
    body: '🎉 {নাম}, ভর্তি অনুমোদিত! আইডি: {আইডি}। পোর্টাল: {লিংক} - {ইনস্টিটিউট}',
  },
};
