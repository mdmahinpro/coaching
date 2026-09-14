import { handleRetrieveAvatar } from '../server/avatar-core';

export default async function handler(req: any, res: any) {
  const studentId = typeof req.query?.student_id === 'string' ? req.query.student_id : undefined;
  const request: import('../server/avatar-core').RetrieveAvatarRequest = studentId ? { studentId } : {};
  const result = await handleRetrieveAvatar(req.method, req.headers?.authorization, request);
  res.status(result.status).json(result.body);
}
