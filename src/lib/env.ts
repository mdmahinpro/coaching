import { validateBrowserEnvironment } from './environmentContract';

export const env = validateBrowserEnvironment({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_EXPECTED_SUPABASE_PROJECT_REF: import.meta.env.VITE_EXPECTED_SUPABASE_PROJECT_REF,
  VITE_ENVIRONMENT_KIND: import.meta.env.VITE_ENVIRONMENT_KIND,
});
