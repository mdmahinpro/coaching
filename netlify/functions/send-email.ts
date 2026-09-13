import { handleSendEmail } from '../../server/email-core';

export async function handler(event: any) {
  const result = await handleSendEmail(event.httpMethod, event.headers?.authorization || event.headers?.Authorization, event.body);
  return { statusCode: result.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result.body) };
}
