import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { initErrorTracking } from '@/utils/logger';

// Fire-and-forget: enables Sentry only when VITE_SENTRY_DSN is set in prod.
void initErrorTracking();

// Self-heal a stale asset map: when a deploy replaces hashed chunks, a tab still
// holding the old index.html asks for files that no longer exist and every lazy
// route dies with "Failed to fetch dynamically imported module". One guarded
// reload picks up the current build instead of leaving the user stuck.
const RELOAD_FLAG = 'cu_chunk_reload_at';
window.addEventListener('vite:preloadError', () => {
  const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
  if (Date.now() - last < 30_000) return; // already reloaded recently — don't loop
  sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  window.location.reload();
});

// Shared cache for all server state. staleTime keeps dashboard/portal pages from
// refetching on every mount; retry:1 avoids hammering a flaky connection.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Management screens must show the latest fee/payment data: refetch on
      // focus and keep the cache window short.
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
