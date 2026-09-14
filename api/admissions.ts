import { handlePublicForm } from '../server/public-forms-core';

export default async function handler(req: any, res: any) {
  const result = await handlePublicForm('admission', req.method, req.headers ?? {}, req.body, 'vercel');
  for (const [name, value] of Object.entries(result.headers ?? {})) {res.setHeader(name, value);}
  res.status(result.status).json(result.body);
}
