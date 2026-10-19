/**
 * Render Web Service entrypoint for mdmahinpro/coaching (branch `main`).
 *
 * Serves the built SPA from dist/ (with SPA fallback for client-side routes
 * like /exam/:id and /portal/*) and exposes POST /api/send-sms using the same
 * shared core as the Vercel (`api/send-sms.ts`) and Netlify
 * (`netlify/functions/send-sms.ts`) entrypoints, so the MIM SMS key stays
 * server-side on Render too.
 *
 * Render settings this expects:
 *   Build command:  pnpm install && pnpm run build
 *   Start command:  node server/render-server.mjs
 *   Env vars:       VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 *                   (SMS_API_KEY optional — without it SMS replies "pending")
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
app.use(express.static(dist));

// SPA fallback: every non-API GET serves index.html
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(join(dist, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`coaching server listening on :${PORT}`);
});
