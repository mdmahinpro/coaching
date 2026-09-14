import { handlePublicForm } from '../../server/public-forms-core';

export async function handler(event: any) {
  const result = await handlePublicForm('contact', event.httpMethod, event.headers ?? {}, event.body, 'netlify');
  return {
    statusCode: result.status,
    headers: { 'Content-Type': 'application/json', ...(result.headers ?? {}) },
    body: JSON.stringify(result.body),
  };
}
