import { createRequire } from 'node:module';
const isolatedConfig = createRequire(import.meta.url)('./isolated-config.cjs');

const ROUTES: Record<string, string> = {
  // Mirrors netlify.toml so every serverless endpoint the app calls is
  // exercised by the isolated combined admin+student audit, not just the
  // avatar/stats subset that predated the full netlify redirect set.
  '/api/admissions': '/netlify/functions/admissions.ts',
  '/api/contact': '/netlify/functions/contact.ts',
  '/api/send-sms': '/netlify/functions/send-sms.ts',
  '/api/send-email': '/netlify/functions/send-email.ts',
  '/api/messaging-readiness': '/netlify/functions/messaging-readiness.ts',
  '/api/messaging-configuration': '/netlify/functions/messaging-configuration.ts',
  '/api/messaging-test-send': '/netlify/functions/messaging-test-send.ts',
  '/api/process-messaging-jobs': '/netlify/functions/process-messaging-jobs.ts',
  '/api/resend-webhook': '/netlify/functions/resend-webhook.ts',
  '/api/mim-dlr-sync': '/netlify/functions/mim-dlr-sync.ts',
  '/api/upload-avatar': '/netlify/functions/upload-avatar.ts',
  '/api/upload-public-asset': '/netlify/functions/upload-public-asset.ts',
  '/api/retrieve-avatar': '/netlify/functions/retrieve-avatar.ts',
  '/api/home-stats': '/netlify/functions/home-stats.ts',
};
const MAX_BODY_BYTES = 4 * 1024 * 1024; // enough for a base64-encoded 2 MiB image

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}
function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        if (!tooLarge) {
          reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        }
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (!tooLarge) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', reject);
  });
}
function headers(req: import('node:http').IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(req.headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)])
  );
}

export function isolatedApiPlugin(): import('vite').Plugin {
  return {
    name: 'isolated-api-runtime',
    enforce: 'pre',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        let pathname: string;
        let url: URL;
        try {
          url = new URL(req.url || '/', 'http://127.0.0.1');
          pathname = decodeURIComponent(url.pathname);
        } catch {
          sendJson(res, 400, { error: 'Invalid request path' });
          return;
        }
        // Never serve server code, scripts, or credential JSON as browser files.
        const normalized = pathname.replace(/\\/g, '/').toLowerCase();
        if (
          /(?:^|\/)(?:server|netlify|e2e|scripts|staging)(?:\/|$)/.test(normalized) ||
          /(?:^|\/)[^/]*creds[^/]*\.json$/.test(normalized) ||
          normalized.endsWith('/isolated-runtime.json')
        ) {
          sendJson(res, 403, { error: 'Local server file is not public' });
          return;
        }
        if (!pathname.startsWith('/api/')) {
          next();
          return;
        }
        if (pathname === '/api/__e2e/health') {
          try {
            const c = isolatedConfig.loadIsolatedConfig({ root: server.config.root });
            sendJson(res, 200, {
              status: 'ok',
              runtime: 'techely-isolated-v2',
              projectRef: c.projectRef,
              serverConfigured: true,
              configSource: process.env.TECHELY_ISOLATED_CONFIG_SOURCE || c.source,
              upstream: 'not-checked-by-health',
            });
          } catch {
            sendJson(res, 503, {
              status: 'not-ready',
              runtime: 'techely-isolated-v2',
              error: 'Isolated server configuration is incomplete or invalid',
            });
          }
          return;
        }
        const netlifyFile = ROUTES[pathname];
        if (!netlifyFile) {
          sendJson(res, 404, { error: 'API route not available in this isolated runtime' });
          return;
        }
        try {
          isolatedConfig.loadIsolatedConfig({ root: server.config.root });
          const mod = await server.ssrLoadModule(netlifyFile);
          if (typeof mod.handler !== 'function') {
            throw new Error('Handler missing');
          }
          const body = ['POST', 'PUT', 'PATCH'].includes(req.method || '')
            ? await readBody(req)
            : null;
          const query = Object.fromEntries(url.searchParams.entries());
          // Faithfully simulate Netlify: public-form functions require a
          // trusted client-IP header to derive the submitter's address.
          const hdrs = { ...headers(req), 'x-nf-client-connection-ip': '127.0.0.1' };
          const result = await mod.handler({
            httpMethod: req.method,
            headers: hdrs,
            body,
            queryStringParameters: Object.keys(query).length ? query : null,
          });
          if (!Number.isInteger(result?.statusCode) || typeof result?.body !== 'string') {
            throw new Error('Invalid handler response');
          }
          res.statusCode = result.statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end(result.body);
        } catch (error) {
          // Do not leak raw SDK messages, credentials, paths, or source text.
          sendJson(res, (error as { status?: number })?.status === 413 ? 413 : 502, {
            error:
              (error as { status?: number })?.status === 413
                ? 'Request body too large'
                : 'Isolated API runtime failed',
          });
        }
      });
    },
  };
}
