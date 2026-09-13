import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const {
  ORIGINAL_PROJECT_REF,
  DISPOSABLE_PROJECT_REF,
  projectRefFromUrl,
  evaluateDisposableTarget,
} = require('./disposable-guard.cjs');

const disposableUrl = `https://${DISPOSABLE_PROJECT_REF}.supabase.co`;
const originalUrl = `https://${ORIGINAL_PROJECT_REF}.supabase.co`;
const key = 'sb_publishable_test-public-key';

describe('projectRefFromUrl', () => {
  it('extracts the project ref', () => {
    expect(projectRefFromUrl(disposableUrl)).toBe(DISPOSABLE_PROJECT_REF);
    expect(projectRefFromUrl(originalUrl)).toBe(ORIGINAL_PROJECT_REF);
  });

  it('returns null for unparseable input', () => {
    expect(projectRefFromUrl('')).toBeNull();
    expect(projectRefFromUrl('not a url')).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
  });
});

describe('evaluateDisposableTarget', () => {
  it('accepts the approved disposable project', () => {
    const decision = evaluateDisposableTarget(disposableUrl, key);
    expect(decision.ok).toBe(true);
    expect(decision.ref).toBe(DISPOSABLE_PROJECT_REF);
  });

  it('refuses missing configuration', () => {
    expect(evaluateDisposableTarget(undefined, key).ok).toBe(false);
    expect(evaluateDisposableTarget(disposableUrl, undefined).ok).toBe(false);
    expect(evaluateDisposableTarget('', '').ok).toBe(false);
  });

  it('refuses the original/customer project', () => {
    const decision = evaluateDisposableTarget(originalUrl, key);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain(ORIGINAL_PROJECT_REF);
  });

  it('refuses any other project', () => {
    const decision = evaluateDisposableTarget('https://abcdefghijklmnopqrst.supabase.co', key);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('abcdefghijklmnopqrst');
  });

  it('refuses an unparseable URL', () => {
    expect(evaluateDisposableTarget('not-a-url', key).ok).toBe(false);
  });
});

describe('run-isolated launcher', () => {
  const run = (env) =>
    spawnSync(process.execPath, [path.join(here, 'run-isolated.cjs'), '--check'], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });

  it('passes --check for the disposable project and never reads .env.local', () => {
    const result = run({
      E2E_DISPOSABLE_SUPABASE_URL: disposableUrl,
      E2E_DISPOSABLE_SUPABASE_ANON_KEY: key,
      SUPABASE_URL: disposableUrl,
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture_server_test_123456',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('isolated-config-ok');
    expect(result.stdout).toContain(DISPOSABLE_PROJECT_REF);
  });

  it('exits 2 when configuration is missing', () => {
    const result = run({
      E2E_DISPOSABLE_SUPABASE_URL: '',
      E2E_DISPOSABLE_SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      E2E_ISOLATED_CONFIG_FILE: path.join(here, 'definitely-not-an-allowed-key-location.json'),
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('BLOCKED');
  });

  it('exits 2 for the original project URL', () => {
    const result = run({
      E2E_DISPOSABLE_SUPABASE_URL: originalUrl,
      E2E_DISPOSABLE_SUPABASE_ANON_KEY: key,
      SUPABASE_URL: originalUrl,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Only the exact HTTPS temporary project');
  });

  it('exits 2 when the server runtime points at the original project', () => {
    const result = run({
      E2E_DISPOSABLE_SUPABASE_URL: disposableUrl,
      E2E_DISPOSABLE_SUPABASE_ANON_KEY: key,
      SUPABASE_URL: originalUrl,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('SUPABASE_URL');
  });
});
