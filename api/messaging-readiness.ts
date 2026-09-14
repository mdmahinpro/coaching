import { handleMessagingReadiness } from '../server/messaging-core';
export default async function handler(req: any, res: any) {
  const value = await handleMessagingReadiness(req.method, req.headers?.authorization);
  res.status(value.status).json(value.body);
}
