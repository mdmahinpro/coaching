import { handleRetrieveAvatar, type RetrieveAvatarRequest } from '../server/avatar-core';

export default async function handler(req: any, res: any) {
  const studentId = typeof req.query?.student_id === 'string' ? req.query.student_id : undefined;
  const request: RetrieveAvatarRequest = studentId ? { studentId } : {};
  const result = await handleRetrieveAvatar(req.method, req.headers?.authorization, request);
  res.status(result.status).json(result.body);
}
