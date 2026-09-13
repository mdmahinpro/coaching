import { handleHomeStats } from '../../server/stats-core';

export async function handler() {
  const result = await handleHomeStats();
  return {
    statusCode: result.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
}
