import { handleMessagingConfiguration } from '../server/messaging-core';
export default async function handler(req: any, res: any) {
  const body = req.method === 'DELETE' && (!req.body || !req.body.channel) ? { channel: req.query?.channel } : req.body;
  const value = await handleMessagingConfiguration(req.method, req.headers?.authorization, body);
  res.status(value.status).json(value.body);
}
