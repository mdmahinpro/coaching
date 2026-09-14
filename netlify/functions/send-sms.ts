/**
 * Netlify function: POST /.netlify/functions/send-sms
 * (also reachable at /api/send-sms via the redirect in netlify.toml)
 * Delegates to the shared core; the MIM SMS key stays server-side.
 */
import { handleSendSms } from '../../server/sms-core';

export async function handler(event: any) {
  const result = await handleSendSms(
    event.httpMethod,
    event.headers?.authorization || event.headers?.Authorization,
    event.body,
    { 'idempotency-key': event.headers?.['idempotency-key'] || event.headers?.['Idempotency-Key'] }
  );
  return {
    statusCode: result.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
}
