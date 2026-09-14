// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createServer } from 'vite';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = 'https://hjzwbicauyxffrmdhvgy.supabase.co';
const fakeKey = 'sb_secret_runtime_TEST_CANARY_123456';
const ISOLATED_ENV_PREFIXES = ['E2E_', 'SUPABASE_', 'VITE_'];
const ISOLATED_ENV_NAMES = new Set([
  'EXPECTED_SUPABASE_PROJECT_REF',
  'ENVIRONMENT_KIND',
  'ISOLATED_PORT',
  'TECHELY_ISOLATED_RUNTIME',
  'TECHELY_ISOLATED_CONFIG_SOURCE',
]);

function sanitizeIsolatedEnvironment(env) {
  for (const name of Object.keys(env)) {
    const upper = name.toUpperCase();
    if (
      ISOLATED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix)) ||
      ISOLATED_ENV_NAMES.has(upper)
    ) {
      delete env[name];
    }
  }
}

async function availableLoopbackPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error('Could not reserve a loopback port for the isolated runtime test.');
  return port;
}

describe('actual isolated Vite runtime (upstream network mocked)', () => {
  it('serves JSON handlers, preserves server env, rejects source/credential paths and keeps secrets out of browser modules', async () => {
    const before = { ...process.env };
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'techely-isolated-runtime-'));
    const missingConfigFile = path.join(tempRoot, 'nonexistent-isolated-runtime.json');
    const port = await availableLoopbackPort();
    const origin = `http://127.0.0.1:${port}`;
    let server;
    const upstream = globalThis.fetch;
    const readCalls = [];
    sanitizeIsolatedEnvironment(process.env);
    Object.assign(process.env, {
      E2E_ISOLATED_CONFIG_FILE: missingConfigFile,
      E2E_DISPOSABLE_SUPABASE_URL: target,
      E2E_DISPOSABLE_SUPABASE_ANON_KEY: 'sb_publishable_runtime_test_123456',
      SUPABASE_URL: target,
      SUPABASE_SERVICE_ROLE_KEY: fakeKey,
      ISOLATED_PORT: String(port),
      VITE_DANGEROUS_SECRET: fakeKey,
    });
    globalThis.fetch = async (input, options) => {
      const url = typeof input === 'string' ? input : input.url || String(input);
      if (url.startsWith(target)) {
        const u = new URL(url);
        if (u.pathname === '/rest/v1/students') {
          readCalls.push({
            path: u.pathname,
            approved: u.searchParams.get('is_approved'),
            status: u.searchParams.get('status'),
            method: options?.method,
          });
          return new Response(null, { status: 200, headers: { 'content-range': '*/42' } });
        }
        throw new Error('Unexpected mock upstream endpoint');
      }
      if (url.startsWith(`${origin}/`)) return upstream(input, options);
      throw new Error('External network forbidden during isolated test');
    };
    try {
      server = await createServer({
        root,
        configFile: path.join(root, 'vite.isolated.config.ts'),
        logLevel: 'error',
      });
      await server.listen();
      let r = await upstream(origin + '/api/__e2e/health');
      let body = await r.json();
      expect(r.status).toBe(200);
      expect(body.runtime).toBe('techely-isolated-v2');
      expect(body.serverConfigured).toBe(true);
      expect(body.projectRef).toBe('hjzwbicauyxffrmdhvgy');
      r = await upstream(origin + '/api/home-stats?probe=1');
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ students: 42 });
      expect(readCalls[0]).toMatchObject({
        approved: 'eq.true',
        status: 'eq.active',
        method: 'HEAD',
      });
      for (const endpoint of ['/api/home-stats.ts', '/api/unknown', '/api/send-email']) {
        r = await upstream(origin + endpoint);
        expect(r.status).toBe(404);
        expect(r.headers.get('content-type')).toContain('application/json');
      }
      for (const endpoint of [
        '/e2e/isolated-creds.json',
        '/api/home-stats.ts',
        '/server/stats-core.ts',
        '/netlify/functions/home-stats.ts',
      ]) {
        r = await upstream(origin + endpoint);
        expect([403, 404]).toContain(r.status);
        expect(await r.text()).not.toContain(fakeKey);
      }
      r = await upstream(origin + '/api/upload-avatar', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      });
      expect(r.status).toBe(401);
      r = await upstream(origin + '/src/lib/env.ts');
      const js = await r.text();
      expect(r.status).toBe(200);
      expect(js).not.toContain(fakeKey);
      expect(js).not.toContain('VITE_DANGEROUS_SECRET');
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      r = await upstream(origin + '/api/__e2e/health');
      expect(r.status).toBe(503);
      expect(await r.text()).not.toContain(fakeKey);
    } finally {
      if (server) await server.close();
      globalThis.fetch = upstream;
      fs.rmSync(tempRoot, { recursive: true, force: true });
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    }
  }, 30000);
});
