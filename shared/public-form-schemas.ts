import { z } from 'zod';

export const PUBLIC_FORM_LIMITS = {
  bodyBytes: 16 * 1024,
  name: 120,
  email: 254,
  phone: 32,
  address: 500,
  classLevel: 80,
  message: 2_000,
  honeypot: 200,
} as const;

const trimmed = (minimum: number, maximum: number, message: string) =>
  z.string().trim().min(minimum, message).max(maximum, `Must be at most ${maximum} characters`);

const optionalTrimmed = (maximum: number) =>
  z.string().trim().max(maximum, `Must be at most ${maximum} characters`).optional().default('');

const phone = (required: boolean) => {
  const value = z
    .string()
    .trim()
    .max(PUBLIC_FORM_LIMITS.phone)
    .refine((input) => !input || /^\+?[0-9][0-9 ()-]{7,30}$/.test(input), 'সঠিক ফোন নম্বর দিন');
  return required ? value.refine((input) => input.replace(/\D/g, '').length >= 10, 'সঠিক ফোন নম্বর দিন') : value.optional().default('');
};

const honeypot = z.string().max(PUBLIC_FORM_LIMITS.honeypot).optional().default('');

export const admissionFormSchema = z
  .object({
    name: trimmed(2, PUBLIC_FORM_LIMITS.name, 'নাম কমপক্ষে ২ অক্ষর হতে হবে'),
    email: z.string().trim().email('সঠিক ইমেইল দিন').max(PUBLIC_FORM_LIMITS.email),
    phone: phone(true),
    guardian_name: trimmed(2, PUBLIC_FORM_LIMITS.name, 'অভিভাবকের নাম দিন'),
    guardian_phone: phone(true),
    address: optionalTrimmed(PUBLIC_FORM_LIMITS.address),
    class_level: optionalTrimmed(PUBLIC_FORM_LIMITS.classLevel),
    gender: z.enum(['male', 'female', 'other']).or(z.literal('')).optional().default(''),
    batch_id: z.string().uuid('একটি বৈধ ব্যাচ বেছে নিন'),
    message: optionalTrimmed(PUBLIC_FORM_LIMITS.message),
    website: honeypot,
  })
  .strict();

export const contactFormSchema = z
  .object({
    name: trimmed(2, PUBLIC_FORM_LIMITS.name, 'নাম কমপক্ষে ২ অক্ষর হতে হবে'),
    email: z.string().trim().email('সঠিক ইমেইল দিন').max(PUBLIC_FORM_LIMITS.email),
    phone: phone(false),
    message: trimmed(10, PUBLIC_FORM_LIMITS.message, 'বার্তা কমপক্ষে ১০ অক্ষর হতে হবে'),
    website: honeypot,
  })
  .strict();

export type AdmissionFormInput = z.input<typeof admissionFormSchema>;
export type AdmissionFormData = z.output<typeof admissionFormSchema>;
export type ContactFormInput = z.input<typeof contactFormSchema>;
export type ContactFormData = z.output<typeof contactFormSchema>;
