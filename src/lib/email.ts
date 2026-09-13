import { supabase } from './supabase';

export async function sendEmail(
  emails: string | string[],
  subject: string,
  html: string,
  templateType = 'custom'
) {
  const list = Array.isArray(emails) ? emails : [emails];
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch('/api/send-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ emails: list, subject, html, templateType }),
  });
  const result = await response.json() as { status: string; sent: number; failed?: number; raw?: unknown };
  await supabase.from('email_logs').insert(list.map((email) => ({
    email,
    subject,
    template_type: templateType,
    status: result.status,
    response: result.raw ?? null,
  })));
  return result;
}

export function emailTemplate(title: string, body: string, institute: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;background:#0f172a;color:#e2e8f0;padding:28px;border-radius:16px"><h2 style="color:#38bdf8;margin-top:0">${institute}</h2><h3 style="color:#fff">${title}</h3><p style="white-space:pre-line;line-height:1.7">${body}</p><hr style="border:0;border-top:1px solid #334155"/><p style="color:#94a3b8;font-size:12px">এই বার্তাটি স্বয়ংক্রিয়ভাবে পাঠানো হয়েছে।</p></div>`;
}

export const EMAIL_TEMPLATES = {
  FEE_REMINDER: {
    label: 'Fee reminder',
    subject: '{মাস} মাসের ফি পরিশোধের অনুরোধ — {ইনস্টিটিউট}',
    body: 'প্রিয় {নাম},\n\nআশা করি ভালো আছেন। আপনার {মাস} মাসের ৳{পরিমাণ} ফি এখনো বাকি রয়েছে। অনুগ্রহ করে সুবিধামতো সময়ে ফি পরিশোধ করুন। কোনো সহায়তা লাগলে আমাদের সঙ্গে যোগাযোগ করুন।\n\nধন্যবাদান্তে,\n{ইনস্টিটিউট}',
  },
  FEE_PAID: {
    label: 'Fee receipt',
    subject: 'ফি গ্রহণের নিশ্চয়তা — {ইনস্টিটিউট}',
    body: 'প্রিয় {নাম},\n\nআপনার ৳{পরিমাণ} ফি সফলভাবে গ্রহণ করা হয়েছে। রশিদ নম্বর: {রশিদ_নং}।\n\nসহযোগিতার জন্য ধন্যবাদ।\n{ইনস্টিটিউট}',
  },
  NOTICE: {
    label: 'Notice',
    subject: '{শিরোনাম} — {ইনস্টিটিউট}',
    body: 'প্রিয় শিক্ষার্থী,\n\n{বার্তা}\n\nধন্যবাদান্তে,\n{ইনস্টিটিউট}',
  },
} as const;
