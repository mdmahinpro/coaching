// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = 'https://hjzwbicauyxffrmdhvgy.supabase.co';
const fakeKey = 'sb_secret_runtime_TEST_CANARY_123456';

describe('actual isolated Vite runtime (upstream network mocked)', () => {
  it('serves JSON handlers, preserves server env, rejects source/credential paths and keeps secrets out of browser modules', async () => {
    const before = { ...process.env };
    let server;
    const upstream = globalThis.fetch;
    const readCalls = [];
    Object.assign(process.env, {
      E2E_DISPOSABLE_SUPABASE_URL: target,
      E2E_DISPOSABLE_SUPABASE_ANON_KEY: 'sb_publishable_runtime_test_123456',
      SUPABASE_URL: target,
      SUPABASE_SERVICE_ROLE_KEY: fakeKey,
      ISOLATED_PORT: '15399',
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
      if (url.startsWith('http://127.0.0.1:15399/')) return upstream(input, options);
      throw new Error('External network forbidden during isolated test');
    };
    try {
      server = await createServer({
        root,
        configFile: path.join(root, 'vite.isolated.config.ts'),
        logLevel: 'error',
      });
      await server.listen();
      let r = await upstream('http://127.0.0.1:15399/api/__e2e/health');
      let body = await r.json();
      expect(r.status).toBe(200);
      expect(body.runtime).toBe('techely-isolated-v2');
      expect(body.serverConfigured).toBe(true);
      expect(body.projectRef).toBe('hjzwbicauyxffrmdhvgy');
      r = await upstream('http://127.0.0.1:15399/api/home-stats?probe=1');
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ students: 42 });
      expect(readCalls[0]).toMatchObject({
        approved: 'eq.true',
        status: 'eq.active',
        method: 'HEAD',
      });
      for (const endpoint of ['/api/home-stats.ts', '/api/unknown', '/api/send-email']) {
        r = await upstream('http://127.0.0.1:15399' + endpoint);
        expect(r.status).toBe(404);
        expect(r.headers.get('content-type')).toContain('application/json');
      }
      for (const endpoint of [
        '/e2e/isolated-creds.json',
        '/api/home-stats.ts',
        '/server/stats-core.ts',
        '/netlify/functions/home-stats.ts',
      ]) {
        r = await upstream('http://127.0.0.1:15399' + endpoint);
        expect([403, 404]).toContain(r.status);
        expect(await r.text()).not.toContain(fakeKey);
      }
      r = await upstream('http://127.0.0.1:15399/api/upload-avatar', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      });
      expect(r.status).toBe(401);
      r = await upstream('http://127.0.0.1:15399/src/lib/env.ts');
      const js = await r.text();
      expect(r.status).toBe(200);
      expect(js).not.toContain(fakeKey);
      expect(js).not.toContain('VITE_DANGEROUS_SECRET');
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      r = await upstream('http://127.0.0.1:15399/api/__e2e/health');
      expect(r.status).toBe(503);
      expect(await r.text()).not.toContain(fakeKey);
    } finally {
      if (server) await server.close();
      globalThis.fetch = upstream;
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    }
  }, 30000);
});
