import { handleResendWebhook } from '../server/messaging-core';
export const config = { api: { bodyParser: false } };
async function rawBody(req: any): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}
export default async function handler(req: any, res: any) {
  const body = await rawBody(req);
  const value = await handleResendWebhook(req.method, body, {
    'svix-id': req.headers?.['svix-id'],
    'svix-timestamp': req.headers?.['svix-timestamp'],
    'svix-signature': req.headers?.['svix-signature'],
  });
  res.status(value.status).json(value.body);
}
