import { createClient } from '@supabase/supabase-js';
import nodeProcess from 'node:process';
import { guardServerEnvironment } from './environment-guard';

/**
 * Server-only, fixed homepage aggregate. Never import this module into UI code.
 * Read configuration from the real Node process; never inject a service key into
 * Vite's define/import.meta.env or return credentials to the browser.
 *
 * Success response remains { students: number }.
 * Missing-config diagnostics contain variable NAMES only, never their values.
 * This does not supply missing environment variables or certify database access.
 */
export async function handleHomeStats(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const environment = guardServerEnvironment();
  if (!environment.ok) {return environment.response;}
  const url = environment.environment.supabaseUrl;
  const serviceKey = nodeProcess.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!serviceKey) {
    return {
      status: 503,
      body: {
        error: 'Stats service is not configured',
        code: 'STATS_CONFIG_MISSING',
        missing: ['SUPABASE_SERVICE_ROLE_KEY'],
        handlerVersion: 'home-stats-config-v2',
      },
    };
  }

  try {
    const client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { count, error } = await client
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('is_approved', true)
      .eq('status', 'active');

    // A missing or malformed count is NOT a verified zero.
    if (error || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      return {
        status: 502,
        body: { error: 'Stats lookup failed', code: 'STATS_LOOKUP_FAILED' },
      };
    }
    return { status: 200, body: { students: count } };
  } catch {
    // Includes invalid client configuration; do not expose SDK error details.
    return {
      status: 502,
      body: { error: 'Stats lookup failed', code: 'STATS_LOOKUP_FAILED' },
    };
  }
}