/**
 * Vercel serverless function: POST /api/send-sms
 * Delegates to the shared core; the ZenSMS key stays server-side.
 */
import { handleSendSms } from '../server/sms-core';

export default async function handler(req: any, res: any) {
  const result = await handleSendSms(
    req.method,
    req.headers?.authorization,
    req.body
  );
  res.status(result.status).json(result.body);
}
