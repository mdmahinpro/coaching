import { handleProcessMessagingJobs } from '../../server/messaging-core';

export const config = { schedule: '* * * * *' };

export default async function handler() {
  const value = await handleProcessMessagingJobs('POST', `Bearer ${process.env.CRON_SECRET ?? ''}`);
  return new Response(JSON.stringify(value.body), {
    status: value.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
