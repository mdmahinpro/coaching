import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";
import { assertPublicSupabaseClientKey } from "./src/lib/supabaseKey";

// PORT: required on Vercel, fall back to 5173 for local dev
const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH: default to "/" for local dev
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig(({ mode }) => {
  const root = path.resolve(import.meta.dirname);
  const loadedEnv = loadEnv(mode, root, "");

  if (mode !== "test") {
    const supabaseUrl = process.env.VITE_SUPABASE_URL ?? loadedEnv.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY ?? loadedEnv.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl) {
      throw new Error("VITE_SUPABASE_URL is required. Check .env.local or deployment settings.");
    }
    try {
      new URL(supabaseUrl);
    } catch {
      throw new Error("VITE_SUPABASE_URL must be a valid URL.");
    }
    if (!supabaseKey) {
      throw new Error(
        "VITE_SUPABASE_ANON_KEY is required. Use the public anon or publishable key."
      );
    }
    assertPublicSupabaseClientKey(supabaseKey);
  }

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      visualizer({
        open: false,
        filename: 'stats.html',
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root,
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
      // The main entry is now ~96KB; the only >500kB files are intentional
      // vendor caches (react-dom / misc), which are long-cached and load in
      // parallel. Prefer many stable vendor chunks over one giant bundle.
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        // jsPDF's optional pdf.html() API lazily imports 'html2canvas'. We draw
        // PDFs natively on canvas (see src/lib/pdf.ts) and never call it, so
        // keep that ~200KB chunk out of the bundle entirely.
        external: ["html2canvas"],
        output: {
          // Split heavy dependency groups into their own long-cached chunks so
          // the main entry stays small and vendors load in parallel. This caps
          // single-file size and improves caching across deploys.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) {
              return undefined;
            }
            if (/react|scheduler|react-dom/.test(id)) return 'vendor-react';
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'vendor-charts';
            if (id.includes('framer-motion')) return 'vendor-motion';
            if (id.includes('jspdf')) return 'vendor-pdf';
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('react-router')) return 'vendor-router';
            if (id.includes('react-hook-form') || id.includes('zod') || id.includes('@hookform')) return 'vendor-forms';
            if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('embla') || id.includes('input-otp') || id.includes('react-day-picker') || id.includes('react-resizable') || id.includes('vaul') || id.includes('sonner') || id.includes('react-hot-toast')) return 'vendor-ui';
            if (id.includes('lucide-react')) return 'vendor-icons';
            return 'vendor-misc';
          },
        },
      },
    },
    server: {
      port,
      strictPort: true,
      host: "127.0.0.1",
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: "127.0.0.1",
      allowedHosts: true,
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./tests/setup.ts"],
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
  };
});
