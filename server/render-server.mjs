/**
 * Render Web Service entrypoint for mdmahinpro/coaching (branch `main`).
 *
 * Serves the built SPA from dist/ (with SPA fallback for client-side routes
 * like /exam/:id and /portal/*) and exposes POST /api/send-sms using the same
 * shared core as the Vercel (`api/send-sms.ts`) and Netlify
 * (`netlify/functions/send-sms.ts`) entrypoints, so the ZenSMS key stays
 * server-side on Render too.
 *
 * Render settings this expects:
 *   Build command:  pnpm install && pnpm run build
 *   Start command:  node server/render-server.mjs
 *   Env vars:       VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 *                   (bare SUPABASE_URL / SUPABASE_ANON_KEY also accepted)
 *                   SMS_API_KEY + SMS_SENDER_ID (optional — without them SMS
 *                   replies "pending" with a hint instead of silently no-oping)
 *
 * The .ts import relies on Node >= 22.6 native type-stripping (unflagged from
 * 23.6); sms-core.ts uses only erasable TS, per tsconfig.server.json.
 */
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleSendSms } from './sms-core.ts';

const app = express();
app.use(express.json({ limit: '64kb' }));

// POST /api/send-sms — same contract as api/send-sms.ts on Vercel.
app.post('/api/send-sms', async (req, res) => {
  const result = await handleSendSms(
    req.method,
    req.headers?.authorization,
    req.body
  );
  res.status(result.status).json(result.body);
});

// Static SPA
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// Hashed build assets are immutable — cache them hard. index.html must never be
// cached, otherwise a browser can keep an old asset map and request chunk names
// that no longer exist after a deploy.
app.use(
  '/assets',
  express.static(join(dist, 'assets'), {
    immutable: true,
    maxAge: '1y',
    fallthrough: true,
  })
);

app.use(
  express.static(dist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      }
    },
  })
);

// A missing /assets/* file is a 404, never the SPA shell: answering with
// index.html made the browser parse HTML as a JS module and surface the opaque
// "Failed to fetch dynamically imported module" error.
app.get(/^\/assets\//, (_req, res) => {
  res.status(404).type('text/plain').send('Asset not found');
});

// SPA fallback: non-API, non-asset GETs serve index.html
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(join(dist, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`coaching server listening on :${PORT}`);
});
