import { handleHomeStats } from '../server/stats-core';

export default async function handler(_req: any, res: any) {
  const result = await handleHomeStats();
  res.status(result.status).json(result.body);
}
