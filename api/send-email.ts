import { handleSendEmail } from '../server/email-core';

export default async function handler(req: any, res: any) {
  const result = await handleSendEmail(req.method, req.headers?.authorization, req.body, {
    'idempotency-key': req.headers?.['idempotency-key'],
  });
  res.status(result.status).json(result.body);
}
