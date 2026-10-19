import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { initErrorTracking } from '@/utils/logger';

// Fire-and-forget: enables Sentry only when VITE_SENTRY_DSN is set in prod.
void initErrorTracking();

// Shared cache for all server state. staleTime keeps dashboard/portal pages from
// refetching on every mount; retry:1 avoids hammering a flaky connection.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
