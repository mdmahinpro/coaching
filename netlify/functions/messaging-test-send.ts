import { handleMessagingTestSend } from '../../server/messaging-core';
export async function handler(event: any) {
  const value = await handleMessagingTestSend(event.httpMethod, event.headers?.authorization || event.headers?.Authorization, event.body, { 'idempotency-key': event.headers?.['idempotency-key'] || event.headers?.['Idempotency-Key'] });
  return { statusCode: value.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value.body) };
}
