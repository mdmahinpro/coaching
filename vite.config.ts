import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";

// Replit-only plugins (guarded so config loads fine outside Replit)
const replPlugins = process.env.REPL_ID !== undefined
  ? [
      await import("@replit/vite-plugin-runtime-error-modal").then(m => m.default()),
      await import("@replit/vite-plugin-cartographer").then(m =>
        m.cartographer({ root: path.resolve(import.meta.dirname, "..") }),
      ),
      await import("@replit/vite-plugin-dev-banner").then(m => m.devBanner()),
    ]
  : [];

// PORT: required on Replit/Vercel, fall back to 5173 for local dev
const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH: required on Replit/Vercel, default to "/" for local dev
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    ...replPlugins,
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
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
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
});
