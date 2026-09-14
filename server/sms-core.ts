import { handleSendSms as sharedHandleSendSms, type CoreResult } from './messaging-core';

export interface SmsRequestBody { phones: string[]; message: string; dryRun?: boolean; queue?: boolean }
export interface SmsCoreResult extends CoreResult { ok: boolean }
export const SMS_REQUEST_LIMITS = { bodyBytes: 256 * 1024, recipients: 1_000, phoneCharacters: 32, messageCharacters: 1_500 } as const;

export async function handleSendSms(method: string, authHeader: string | undefined, rawBody: unknown, headers: Record<string, string | undefined> = {}): Promise<SmsCoreResult> {
  let bytes = Number.POSITIVE_INFINITY;
  try { bytes = Buffer.byteLength(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody) ?? ''); } catch { /* invalid */ }
  if (bytes > SMS_REQUEST_LIMITS.bodyBytes) { return { ok: false, status: 413, body: { error: 'Request body too large' } }; }
  const response = await sharedHandleSendSms(method, authHeader, rawBody, headers);
  return { ...response, ok: response.status >= 200 && response.status < 300 };
}
