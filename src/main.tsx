import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initErrorTracking } from '@/utils/logger';

// Fire-and-forget: enables Sentry only when VITE_SENTRY_DSN is set in prod.
void initErrorTracking();

createRoot(document.getElementById('root')!).render(<App />);
