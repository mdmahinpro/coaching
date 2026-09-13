// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import runtime from './isolated-config.cjs';
import setup from './isolated-setup.cjs';
const roots = [];
const anon = 'sb_publishable_fixture_public_12345';
const service = 'sb_secret_fixture_server_12345';
const valid = { url: runtime.PROJECT_URL, anonKey: anon, serviceKey: service };
const jwt = (role, ref) =>
  [
    'eyJhbGciOiJub25lIn0',
    Buffer.from(JSON.stringify({ role, ref })).toString('base64url'),
    'fixture',
  ].join('.');
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe('isolated runtime configuration', () => {
  it('requires server configuration before readiness', () => {
    expect(() => runtime.normalize({ ...valid, serviceKey: '' })).toThrow(
      'SUPABASE_SERVICE_ROLE_KEY'
    );
  });
  it('accepts only the exact approved HTTPS origin', () => {
    for (const url of [
      'https://flbvusudwszxdylxevfe.supabase.co',
      'http://hjzwbicauyxffrmdhvgy.supabase.co',
      'https://hjzwbicauyxffrmdhvgy.evil.test',
      'https://user:pass@hjzwbicauyxffrmdhvgy.supabase.co',
      'https://hjzwbicauyxffrmdhvgy.supabase.co/path',
    ])
      expect(() => runtime.normalize({ ...valid, url })).toThrow();
  });
  it('rejects privileged keys in public variables and wrong-project legacy keys', () => {
    expect(() => runtime.normalize({ ...valid, anonKey: service })).toThrow('wrong key type');
    expect(() => runtime.normalize({ ...valid, serviceKey: anon })).toThrow('wrong key type');
    expect(() =>
      runtime.normalize({ ...valid, anonKey: jwt('anon', runtime.ORIGINAL_REF) })
    ).toThrow('different project');
    expect(() =>
      runtime.normalize({ ...valid, serviceKey: jwt('service_role', runtime.ORIGINAL_REF) })
    ).toThrow('different project');
  });
  it('maps both server and browser public config from the same input', () => {
    const c = runtime.normalize(valid);
    const env = runtime.childEnvironment(c, {
      VITE_SECRET: service,
      SUPABASE_ANON_KEY: 'old-key',
      VITE_SUPABASE_URL: 'old-url',
    });
    expect(env.SUPABASE_ANON_KEY).toBe(anon);
    expect(env.VITE_SUPABASE_ANON_KEY).toBe(anon);
    expect(env.VITE_SECRET).toBeUndefined();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(service);
    expect(env.ISOLATED_PORT).toBe('5199');
  });
  it('does not mix partial process secrets with stored keys', () => {
    expect(() =>
      runtime.loadIsolatedConfig({ env: { E2E_DISPOSABLE_SUPABASE_ANON_KEY: anon }, root: '/repo' })
    ).toThrow('SUPABASE_SERVICE_ROLE_KEY');
  });
  it('loads a separate explicit local key file and never .env.local', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'techely-config-test-'));
    roots.push(root);
    const file = path.join(root, 'settings.json');
    setup.saveConfig(runtime.normalize(valid), file);
    const c = runtime.loadIsolatedConfig({
      env: { E2E_ISOLATED_CONFIG_FILE: file },
      root: path.join(root, 'repo'),
    });
    expect(c.source).toBe('local-file');
    expect(c.serviceKey).toBe(service);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
  it('uses a complete saved source with matching partial env, and rejects conflicting values', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'techely-config-test-'));
    roots.push(root);
    const file = path.join(root, 'settings.json');
    setup.saveConfig(runtime.normalize(valid), file);
    const env = { E2E_ISOLATED_CONFIG_FILE: file, E2E_DISPOSABLE_SUPABASE_ANON_KEY: anon };
    expect(runtime.loadIsolatedConfig({ env, root: path.join(root, 'repo') }).serviceKey).toBe(
      service
    );
    expect(() =>
      runtime.loadIsolatedConfig({
        env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_other_key_123456' },
        root: path.join(root, 'repo'),
      })
    ).toThrow('conflicts');
    expect(() =>
      runtime.loadIsolatedConfig({
        env: { ...env, SUPABASE_URL: 'https://flbvusudwszxdylxevfe.supabase.co' },
        root: path.join(root, 'repo'),
      })
    ).toThrow('conflicts');
  });
  it('rejects credential files inside the repository', () => {
    expect(() =>
      runtime.loadIsolatedConfig({
        env: { E2E_ISOLATED_CONFIG_FILE: '/repo/e2e/keys.json' },
        root: '/repo',
      })
    ).toThrow('outside');
  });
  it('never overwrites a saved file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'techely-config-test-'));
    roots.push(root);
    const file = path.join(root, 'settings.json');
    setup.saveConfig(runtime.normalize(valid), file);
    const old = fs.readFileSync(file, 'utf8');
    expect(() => setup.saveConfig(runtime.normalize(valid), file)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(old);
  });
  it('rejects conflicting server project and invalid ports', () => {
    expect(() =>
      runtime.normalize({ ...valid, serverUrl: 'https://flbvusudwszxdylxevfe.supabase.co' })
    ).toThrow('conflicts');
    for (const port of ['x', 80, 65536, 1.5])
      expect(() => runtime.normalize({ ...valid, port })).toThrow('ISOLATED_PORT');
  });
});
