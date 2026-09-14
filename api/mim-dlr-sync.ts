import { handleMimDlrSync } from '../server/messaging-core';
export default async function handler(req: any, res: any) {
  const value = await handleMimDlrSync(req.method, req.headers?.authorization, req.headers?.['x-worker-secret']);
  res.status(value.status).json(value.body);
}
