import { messagingIdempotencyKey, sendMessage, type MessagingResponse } from './messaging';

export type SMSResult = MessagingResponse;

export async function sendSMS(
  phones: string | string[],
  message: string,
  type = 'custom',
  options: { idempotencyKey?: string; dryRun?: boolean } = {}
): Promise<SMSResult> {
  const recipients = Array.isArray(phones) ? phones : [phones];
  return sendMessage({
    channel: 'sms', recipients, message, templateType: type,
    idempotencyKey: options.idempotencyKey ?? messagingIdempotencyKey(`sms:${type}`, `${recipients.join('|')}|${message}`),
    dryRun: options.dryRun,
  });
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, k) => vars[k] ?? vars[k.trim()] ?? `{${k}}`);
}

export const SMS_TEMPLATES: Record<string, { label: string; key: string; body: string }> = {
  FEE_REMINDER: { key: 'FEE_REMINDER', label: 'Fee Reminder', body: 'প্রিয় {নাম}, {মাস} মাসের ৳{পরিমাণ} ফি বাকি। অনুগ্রহ করে পরিশোধ করুন। — {ইনস্টিটিউট}' },
  FEE_PAID: { key: 'FEE_PAID', label: 'Fee Paid', body: 'প্রিয় {নাম}, ৳{পরিমাণ} ফি গ্রহণ করা হয়েছে। রশিদ: {রশিদ_নং}। ধন্যবাদ। — {ইনস্টিটিউট}' },
  EXAM_NOTICE: { key: 'EXAM_NOTICE', label: 'Exam Notice', body: 'পরীক্ষা: {শিরোনাম} — তারিখ: {তারিখ}, সময়: {সময়}। লিংক: {লিংক} - {ইনস্টিটিউট}' },
  RESULT_OUT: { key: 'RESULT_OUT', label: 'Result Published', body: '{পরীক্ষা} ফলাফল প্রকাশিত। পোর্টালে লগইন করুন। - {ইনস্টিটিউট}' },
  NOTICE: { key: 'NOTICE', label: 'General Notice', body: '📢 {শিরোনাম}: {বার্তা} - {ইনস্টিটিউট}' },
  APPROVED: { key: 'APPROVED', label: 'Admission Approved', body: '🎉 {নাম}, ভর্তি অনুমোদিত! আইডি: {আইডি}। আপনার আগে সংরক্ষিত ভর্তি রেফারেন্স ব্যবহার করে পোর্টালে লগইন করুন: {লিংক} - {ইনস্টিটিউট}' },
};
