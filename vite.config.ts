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
      rollupOptions: {
        // jsPDF's optional pdf.html() API lazily imports 'html2canvas'. We draw
        // PDFs natively on canvas (see src/lib/pdf.ts) and never call it, so
        // keep that ~200KB chunk out of the bundle entirely.
        external: ["html2canvas"],
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
