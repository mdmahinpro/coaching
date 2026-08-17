import { describe, it, expect, vi } from 'vitest';

// ── Module mocks (auto-mocked by vitest — no factory needed) ──
// These must be declared BEFORE the import of errorHandler.ts so vitest
// intercepts the `import { logError }` and `import { toast }` inside it.
vi.mock('@/utils/logger');
vi.mock('react-hot-toast');

// ── Import AFTER mocks are registered ──
import { handleSupabaseError } from '@/utils/errorHandler';
import { logError } from '@/utils/logger';
import { toast } from 'react-hot-toast';

describe('handleSupabaseError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early on null', () => {
    handleSupabaseError(null);
    expect(logError).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('returns early on undefined', () => {
    handleSupabaseError(undefined);
    expect(logError).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('extracts message, details, and hint from SupabaseError object', () => {
    const err = { message: 'Row not found', details: 'id missing', hint: 'check id' };
    handleSupabaseError(err);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toBe('Row not found\nDetails: id missing\nHint: check id');
  });

  it('uses default message when object has no message field', () => {
    const err = { code: 'PGRST116' };
    handleSupabaseError(err);
    expect(toast.error.mock.calls[0][0]).toBe('Something went wrong. Please try again.');
  });

  it('handles plain string errors', () => {
    handleSupabaseError('Network timeout');
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toBe('Network timeout');
  });

  it('handles Error instances', () => {
    handleSupabaseError(new Error('Connection refused'));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toBe('Connection refused');
  });

  it('omits details when it duplicates the message', () => {
    const err = { message: 'Duplicate key', details: 'Duplicate key' };
    handleSupabaseError(err);
    expect(toast.error.mock.calls[0][0]).toBe('Duplicate key');
  });

  it('calls logError with "Supabase error occurred" and original error in meta', () => {
    const err = new Error('DB down');
    handleSupabaseError(err);
    expect(logError).toHaveBeenCalledTimes(1);
    const [logMsg, logCtx] = logError.mock.calls[0];
    expect(logMsg).toBe('Supabase error occurred');
    expect(logCtx.source).toBe('errorHandler');
    expect(logCtx.meta.originalError).toBe('DB down');
  });

  it('passes duration: 4000 to toast.error', () => {
    handleSupabaseError('Oops');
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][1]).toEqual({ duration: 4000 });
  });
});
