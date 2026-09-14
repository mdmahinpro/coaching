import { handleMessagingConfiguration } from '../../server/messaging-core';
export async function handler(event: any) {
  const body = event.httpMethod === 'DELETE' && (!event.body || event.body === '{}') ? { channel: event.queryStringParameters?.channel } : event.body;
  const value = await handleMessagingConfiguration(event.httpMethod, event.headers?.authorization || event.headers?.Authorization, body);
  return { statusCode: value.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value.body) };
}
