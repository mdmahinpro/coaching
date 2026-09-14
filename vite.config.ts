import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";
import { validateBrowserEnvironment } from "./src/lib/environmentContract";

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
  const analyzeBundle = (process.env.ANALYZE_BUNDLE ?? loadedEnv.ANALYZE_BUNDLE) === "1";

  if (mode !== "test") {
    validateBrowserEnvironment({
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? loadedEnv.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY:
        process.env.VITE_SUPABASE_ANON_KEY ?? loadedEnv.VITE_SUPABASE_ANON_KEY,
      VITE_EXPECTED_SUPABASE_PROJECT_REF:
        process.env.VITE_EXPECTED_SUPABASE_PROJECT_REF ??
        loadedEnv.VITE_EXPECTED_SUPABASE_PROJECT_REF,
      VITE_ENVIRONMENT_KIND:
        process.env.VITE_ENVIRONMENT_KIND ?? loadedEnv.VITE_ENVIRONMENT_KIND,
    });
  }

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      ...(analyzeBundle
        ? [
            visualizer({
              open: false,
              filename: path.resolve(root, "analysis", "bundle", "stats.html"),
            }),
          ]
        : []),
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
            if (id.includes('jspdf')) {
              return 'vendor-pdf';
            }
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) {
              return 'vendor-charts';
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            return undefined;
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
      exclude: ["**/node_modules/**", "**/.git/**", "**/.kilo/**", "**/dist/**"],
      setupFiles: ["./tests/setup.ts"],
      env: {
        VITE_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
        VITE_SUPABASE_ANON_KEY: "sb_publishable_test_key_for_unit_tests_only",
        VITE_EXPECTED_SUPABASE_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa",
        VITE_ENVIRONMENT_KIND: "test",
      },
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
  };
});
