import { toast } from 'react-hot-toast';
import { logError } from '@/utils/logger';

export interface SupabaseError {
  message: string;
  details?: string;
  hint?: string;
  code?: string;
}

export function handleSupabaseError(error: unknown): void {
  if (!error) return;

  let message = 'Something went wrong. Please try again.';

  if (typeof error === 'object' && error !== null) {
    const err = error as SupabaseError;
    if (err.message) {
      message = err.message;
    }
    if (err.details && err.details !== err.message) {
      message += `\nDetails: ${err.details}`;
    }
    if (err.hint) {
      message += `\nHint: ${err.hint}`;
    }
  } else if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  }

  logError('Supabase error occurred', {
    source: 'errorHandler',
    meta: { message, originalError: error instanceof Error ? error.message : String(error) },
  });
  toast.error(message, { duration: 4000 });
}
