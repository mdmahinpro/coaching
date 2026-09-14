import { handleProcessMessagingJobs } from '../../server/messaging-core';
export async function handler(event: any) {
  const value = await handleProcessMessagingJobs(event.httpMethod, event.headers?.authorization || event.headers?.Authorization, event.headers?.['x-worker-secret'] || event.headers?.['X-Worker-Secret']);
  return { statusCode: value.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value.body) };
}
