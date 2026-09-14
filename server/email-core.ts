import { handleSendEmail as sharedHandleSendEmail } from './messaging-core';

export interface EmailRequestBody { emails: string[]; subject: string; html: string; templateType?: string; dryRun?: boolean; queue?: boolean }
export const EMAIL_REQUEST_LIMITS = { bodyBytes: 1024 * 1024, recipients: 1_000, emailCharacters: 320, subjectCharacters: 200, htmlBytes: 512 * 1024 } as const;

export async function handleSendEmail(method: string, authHeader: string | undefined, rawBody: unknown, headers: Record<string, string | undefined> = {}) {
  let bytes = Number.POSITIVE_INFINITY;
  try { bytes = Buffer.byteLength(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody) ?? ''); } catch { /* invalid */ }
  if (bytes > EMAIL_REQUEST_LIMITS.bodyBytes) { return { status: 413, body: { error: 'Request body too large' } }; }
  return sharedHandleSendEmail(method, authHeader, rawBody, headers);
}
