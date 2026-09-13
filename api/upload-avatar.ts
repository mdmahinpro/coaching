import { handleUploadAvatar } from '../server/avatar-core';

export const config = { api: { bodyParser: { sizeLimit: '7mb' } } };

export default async function handler(req: any, res: any) {
  const result = await handleUploadAvatar(req.method, req.headers?.authorization, req.body);
  res.status(result.status).json(result.body);
}
