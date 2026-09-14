import { handleRetrieveAvatar } from '../../server/avatar-core';

export async function handler(event: any) {
  const q = event.queryStringParameters ?? {};
  const studentId = typeof q.student_id === 'string' && q.student_id ? q.student_id : undefined;
  const request: import('../../server/avatar-core').RetrieveAvatarRequest = studentId ? { studentId } : {};
  const result = await handleRetrieveAvatar(
    event.httpMethod,
    event.headers?.authorization || event.headers?.Authorization,
    request,
  );
  return {
    statusCode: result.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
}
