import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { createRequire } from 'node:module';
const isolatedConfig = createRequire(import.meta.url)('./e2e/isolated-config.cjs');
import { isolatedApiPlugin } from './e2e/isolated-api-plugin';

export default defineConfig(() => {
  const root = path.resolve(import.meta.dirname);
  const config = isolatedConfig.loadIsolatedConfig({ root });
  // Hydrate server variables only; the browser receives the three explicit
  // public values below. No .env.local or inherited VITE_* secrets are loaded.
  const safeEnv = isolatedConfig.childEnvironment(config);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VITE_')) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, safeEnv);
  return {
    base: '/',
    envDir: false,
    plugins: [react(), tailwindcss(), isolatedApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(root, 'src'),
        '@assets': path.resolve(root, '..', '..', 'attached_assets'),
      },
      dedupe: ['react', 'react-dom'],
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(config.url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(config.anonKey),
      'import.meta.env.VITE_EXPECTED_SUPABASE_PROJECT_REF': JSON.stringify(
        new URL(config.url).hostname.split('.')[0]
      ),
      'import.meta.env.VITE_ENVIRONMENT_KIND': JSON.stringify('test'),
      'import.meta.env.VITE_SITE_URL': JSON.stringify(`http://127.0.0.1:${config.port}`),
    },
    root,
    server: {
      port: config.port,
      strictPort: true,
      host: '127.0.0.1',
      allowedHosts: ['localhost', '127.0.0.1'],
      fs: {
        strict: true,
        allow: [searchForWorkspaceRoot(root)],
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem,key}',
          '**/.git/**',
          '**/*creds*.json',
          '**/isolated-runtime.json',
          '**/*backup*.sql',
        ],
      },
    },
  };
});
