export type SupabaseClientKeyKind = 'publishable' | 'anon' | 'privileged' | 'invalid';

function decodeJwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3 || typeof globalThis.atob !== 'function') {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

export function classifySupabaseClientKey(value: string): SupabaseClientKeyKind {
  const key = value.trim();

  if (/^sb_secret_/i.test(key)) {
    return 'privileged';
  }

  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) {
    return 'publishable';
  }

  const jwtRole = decodeJwtRole(key);
  if (jwtRole === 'anon') {
    return 'anon';
  }
  if (jwtRole === 'service_role') {
    return 'privileged';
  }

  return 'invalid';
}

export function isPublicSupabaseClientKey(value: string): boolean {
  const kind = classifySupabaseClientKey(value);
  return kind === 'publishable' || kind === 'anon';
}

export function assertPublicSupabaseClientKey(value: string): void {
  const kind = classifySupabaseClientKey(value);
  if (kind === 'privileged') {
    throw new Error(
      'VITE_SUPABASE_ANON_KEY contains a privileged Supabase key. Use the public anon or publishable key and rotate the exposed privileged key.'
    );
  }
  if (kind === 'invalid') {
    throw new Error(
      'VITE_SUPABASE_ANON_KEY must be a Supabase public anon JWT or sb_publishable_ key.'
    );
  }
}
