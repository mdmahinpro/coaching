import { handleResendWebhook } from '../../server/messaging-core';
export async function handler(event: any) {
  const value = await handleResendWebhook(event.httpMethod, event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '', {
    'svix-id': event.headers?.['svix-id'] || event.headers?.['Svix-Id'],
    'svix-timestamp': event.headers?.['svix-timestamp'] || event.headers?.['Svix-Timestamp'],
    'svix-signature': event.headers?.['svix-signature'] || event.headers?.['Svix-Signature'],
  });
  return { statusCode: value.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value.body) };
}
