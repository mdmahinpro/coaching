import nodeProcess from 'node:process';

export const SERVER_ENVIRONMENT_KINDS = ['development', 'test', 'staging', 'production'] as const;
export type ServerEnvironmentKind = (typeof SERVER_ENVIRONMENT_KINDS)[number];

export interface ServerEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  expectedSupabaseProjectRef: string;
  environmentKind: ServerEnvironmentKind;
}

export type ServerEnvironmentResult =
  | { ok: true; environment: ServerEnvironment }
  | { ok: false; response: { status: 503; body: { error: string; code: string; missing?: string[] } } };

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) {return null;}
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function isPublicAnonKey(key: string): boolean {
  return /^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key) || jwtRole(key) === 'anon';
}

/** Validate server identity before any authentication, database, storage, or provider I/O. */
export function guardServerEnvironment(): ServerEnvironmentResult {
  const values = {
    SUPABASE_URL: nodeProcess.env.SUPABASE_URL?.trim(),
    SUPABASE_ANON_KEY: nodeProcess.env.SUPABASE_ANON_KEY?.trim(),
    EXPECTED_SUPABASE_PROJECT_REF: nodeProcess.env.EXPECTED_SUPABASE_PROJECT_REF?.trim(),
    ENVIRONMENT_KIND: nodeProcess.env.ENVIRONMENT_KIND?.trim(),
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    return {
      ok: false,
      response: {
        status: 503,
        body: { error: 'Server environment is not configured', code: 'SERVER_ENV_MISSING', missing },
      },
    };
  }

  const projectRef = values.EXPECTED_SUPABASE_PROJECT_REF!;
  const kind = values.ENVIRONMENT_KIND!;
  const url = values.SUPABASE_URL!;
  const anonKey = values.SUPABASE_ANON_KEY!;
  if (!SERVER_ENVIRONMENT_KINDS.includes(kind as ServerEnvironmentKind)) {
    return invalid();
  }
  if (!PROJECT_REF_RE.test(projectRef) || url !== `https://${projectRef}.supabase.co`) {
    return invalid();
  }
  if (!isPublicAnonKey(anonKey)) {
    return invalid();
  }

  return {
    ok: true,
    environment: {
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      expectedSupabaseProjectRef: projectRef,
      environmentKind: kind as ServerEnvironmentKind,
    },
  };
}

function invalid(): ServerEnvironmentResult {
  return {
    ok: false,
    response: {
      status: 503,
      body: { error: 'Server environment identity check failed', code: 'SERVER_ENV_INVALID' },
    },
  };
}
