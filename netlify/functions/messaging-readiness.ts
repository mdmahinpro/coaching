import { handleMessagingReadiness } from '../../server/messaging-core';
export async function handler(event: any) {
  const value = await handleMessagingReadiness(event.httpMethod, event.headers?.authorization || event.headers?.Authorization);
  return { statusCode: value.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value.body) };
}
