import { handleUploadPublicAsset } from '../../server/avatar-core';

export async function handler(event: any) {
  let body: unknown = event.body;
  try { body = typeof body === 'string' ? JSON.parse(body) : body; } catch { body = null; }
  const result = await handleUploadPublicAsset(
    event.httpMethod,
    event.headers?.authorization || event.headers?.Authorization,
    body
  );
  return {
    statusCode: result.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
}
