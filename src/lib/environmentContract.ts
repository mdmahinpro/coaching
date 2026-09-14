import { assertPublicSupabaseClientKey } from './supabaseKey';

export const ENVIRONMENT_KINDS = ['development', 'test', 'staging', 'production'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export interface BrowserEnvironmentInput {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_EXPECTED_SUPABASE_PROJECT_REF?: string;
  VITE_ENVIRONMENT_KIND?: string;
}

export interface BrowserEnvironment {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  VITE_EXPECTED_SUPABASE_PROJECT_REF: string;
  VITE_ENVIRONMENT_KIND: EnvironmentKind;
}

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

export function expectedSupabaseUrl(projectRef: string): string {
  return `https://${projectRef}.supabase.co`;
}

export function validateBrowserEnvironment(input: BrowserEnvironmentInput): BrowserEnvironment {
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_EXPECTED_SUPABASE_PROJECT_REF',
    'VITE_ENVIRONMENT_KIND',
  ] as const;
  const missing = required.filter((name) => !input[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing required browser environment variables: ${missing.join(', ')}`);
  }

  const url = input.VITE_SUPABASE_URL!.trim();
  const anonKey = input.VITE_SUPABASE_ANON_KEY!.trim();
  const projectRef = input.VITE_EXPECTED_SUPABASE_PROJECT_REF!.trim();
  const kind = input.VITE_ENVIRONMENT_KIND!.trim();

  if (!ENVIRONMENT_KINDS.includes(kind as EnvironmentKind)) {
    throw new Error(`Unsupported VITE_ENVIRONMENT_KIND: ${kind}`);
  }
  if (!PROJECT_REF_RE.test(projectRef)) {
    throw new Error('VITE_EXPECTED_SUPABASE_PROJECT_REF must be exactly 20 lowercase letters or digits.');
  }
  if (url !== expectedSupabaseUrl(projectRef)) {
    throw new Error('VITE_SUPABASE_URL does not exactly match VITE_EXPECTED_SUPABASE_PROJECT_REF.');
  }
  assertPublicSupabaseClientKey(anonKey);

  return {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: anonKey,
    VITE_EXPECTED_SUPABASE_PROJECT_REF: projectRef,
    VITE_ENVIRONMENT_KIND: kind as EnvironmentKind,
  };
}
