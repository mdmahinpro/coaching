import { handleMessagingTestSend } from '../server/messaging-core';
export default async function handler(req: any, res: any) {
  const value = await handleMessagingTestSend(req.method, req.headers?.authorization, req.body, { 'idempotency-key': req.headers?.['idempotency-key'] });
  res.status(value.status).json(value.body);
}
