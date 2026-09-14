import { handleMimDlrSync } from '../../server/messaging-core';

export const config = { schedule: '*/5 * * * *' };

export default async function handler() {
  const value = await handleMimDlrSync('POST', `Bearer ${process.env.CRON_SECRET ?? ''}`);
  return new Response(JSON.stringify(value.body), {
    status: value.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
