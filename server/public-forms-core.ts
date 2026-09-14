import { createClient } from '@supabase/supabase-js';
import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import nodeProcess from 'node:process';
import {
  admissionFormSchema,
  contactFormSchema,
  PUBLIC_FORM_LIMITS,
  type AdmissionFormData,
  type ContactFormData,
} from '../shared/public-form-schemas';
import { guardServerEnvironment } from './environment-guard';

export type PublicFormKind = 'admission' | 'contact';
export type HostingPlatform = 'netlify' | 'vercel';
export type HeaderValues = Record<string, string | string[] | undefined>;

export interface PublicFormResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

function header(headers: HeaderValues, name: string): string {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

/** Only consume headers set and sanitized by the selected hosting platform. */
export function extractTrustedClientIp(platform: HostingPlatform, headers: HeaderValues): string | null {
  const raw = platform === 'netlify'
    ? header(headers, 'x-nf-client-connection-ip')
    : header(headers, 'x-vercel-forwarded-for');
  const candidate = raw.split(',')[0]?.trim().replace(/^\[|\]$/g, '') ?? '';
  return isIP(candidate) ? candidate : null;
}

function bodyByteLength(body: unknown): number {
  try {
    return Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body) ?? '', 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') {return body;}
  return JSON.parse(body);
}

export function generateAdmissionReference(): string {
  return `APP-${randomBytes(9).toString('base64url').toUpperCase()}`;
}

function validationFailure(): PublicFormResult {
  return { status: 400, body: { error: 'Invalid form submission', code: 'FORM_INVALID' } };
}

export async function handlePublicForm(
  kind: PublicFormKind,
  method: string | undefined,
  headers: HeaderValues,
  rawBody: unknown,
  platform: HostingPlatform,
): Promise<PublicFormResult> {
  if (method?.toUpperCase() !== 'POST') {
    return { status: 405, body: { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, headers: { Allow: 'POST' } };
  }

  const contentLength = Number(header(headers, 'content-length'));
  if (
    (Number.isFinite(contentLength) && contentLength > PUBLIC_FORM_LIMITS.bodyBytes) ||
    bodyByteLength(rawBody) > PUBLIC_FORM_LIMITS.bodyBytes
  ) {
    return { status: 413, body: { error: 'Request body too large', code: 'BODY_TOO_LARGE' } };
  }

  if (!/^application\/json(?:\s*;|$)/i.test(header(headers, 'content-type'))) {
    return { status: 415, body: { error: 'Content-Type must be application/json', code: 'UNSUPPORTED_MEDIA_TYPE' } };
  }

  let parsed: unknown;
  try {
    parsed = parseBody(rawBody);
  } catch {
    return validationFailure();
  }
  const validation = kind === 'admission'
    ? admissionFormSchema.safeParse(parsed)
    : contactFormSchema.safeParse(parsed);
  if (!validation.success) {return validationFailure();}

  const ip = extractTrustedClientIp(platform, headers);
  if (!ip) {
    return { status: 400, body: { error: 'Client address unavailable', code: 'CLIENT_IP_UNAVAILABLE' } };
  }

  const environment = guardServerEnvironment();
  if (!environment.ok) {return environment.response;}
  const serviceKey = nodeProcess.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) {
    return {
      status: 503,
      body: { error: 'Public form service is not configured', code: 'PUBLIC_FORM_CONFIG_MISSING', missing: ['SUPABASE_SERVICE_ROLE_KEY'] },
    };
  }

  const data = validation.data as AdmissionFormData | ContactFormData;
  const reference = kind === 'admission' ? generateAdmissionReference() : null;

  // Honeypots deliberately return a normal-looking response without touching the database.
  if (data.website) {
    return kind === 'admission'
      ? { status: 201, body: { ok: true, reference } }
      : { status: 201, body: { ok: true } };
  }

  const { website: _website, ...payload } = data;
  try {
    const client = createClient(environment.environment.supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: rpcData, error } = await client.rpc('submit_public_form', {
      p_form_type: kind,
      p_client_ip: ip,
      p_payload: payload,
      p_reference_no: reference,
    });
    if (error) {
      const details = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
      if (details.includes('rate_limited')) {
        return { status: 429, body: { error: 'Too many submissions. Please try again later.', code: 'RATE_LIMITED' }, headers: { 'Retry-After': '3600' } };
      }
      return { status: 502, body: { error: 'Submission failed', code: 'SUBMISSION_FAILED' } };
    }
    if (!rpcData || typeof rpcData !== 'object') {
      return { status: 502, body: { error: 'Submission failed', code: 'SUBMISSION_FAILED' } };
    }
    return kind === 'admission'
      ? { status: 201, body: { ok: true, reference } }
      : { status: 201, body: { ok: true } };
  } catch {
    return { status: 502, body: { error: 'Submission failed', code: 'SUBMISSION_FAILED' } };
  }
}
