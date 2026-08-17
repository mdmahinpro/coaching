import { supabase } from './supabase';
import { handleSupabaseError } from '@/utils/errorHandler';

export interface SMSResult {
  sent: number;
  failed: number;
  raw?: unknown;
}

export async function sendSMS(
  phones: string | string[],
  message: string,
  type = 'custom',
  apiKey: string,
  senderId = 'CoachMS'
): Promise<SMSResult> {
  const phoneArr = Array.isArray(phones) ? phones : [phones];
  if (!phoneArr.length) {
    return { sent: 0, failed: 0 };
  }

  let sentCount = 0;
  let failedCount = 0;
  let raw: unknown = null;

  if (apiKey) {
    try {
      const res = await fetch('https://api.mimsms.com/smsapi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          senderid: senderId || 'CoachMS',
          type: 'text',
          scheduleat: '',
          route: 'T',
          contacts: phoneArr.join(','),
          msg: message,
        }),
      });
      raw = await res.json();
      const data = raw as { status?: string };
      if (data.status === 'success') {
        sentCount = phoneArr.length;
      } else {
        failedCount = phoneArr.length;
      }
    } catch (err) {
      console.error('[SMS API Error]', err);
      failedCount = phoneArr.length;
    }
  } else {
    // No API key — log as "pending" for demo
    sentCount = phoneArr.length;
  }

  // Log to DB
  try {
    await supabase.from('sms_logs').insert(
      phoneArr.map((p) => ({
        phone: p,
        message,
        type,
        status: apiKey ? (sentCount > 0 ? 'sent' : 'failed') : 'pending',
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
    body: '📢 {শিরোনাম}: {বার্তা} - {ইনস্টিটিউট}',
  },
  APPROVED: {
    key: 'APPROVED',
    label: 'Admission Approved',
    body: '🎉 {নাম}, ভর্তি অনুমোদিত! আইডি: {আইডি}। পোর্টাল: {লিংক} - {ইনস্টিটিউট}',
  },
};
