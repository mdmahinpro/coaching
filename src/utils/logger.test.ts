import { describe, it, expect, vi, beforeEach } from 'vitest';

// errorHandler.test.ts mocks '@/utils/logger' at module level.
// That mock persists in the module registry — we must reset the
// module cache and re-import the real logger for these tests.
vi.resetModules();
vi.unmock('@/utils/logger');

import { logError, logWarning, logInfo } from '@/utils/logger';

describe('logger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  describe('logError', () => {
    it('calls console.error with [Error] prefix, message, and empty meta', () => {
      logError('Something went wrong');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [prefix, message, meta] = errorSpy.mock.calls[0];
      expect(prefix).toBe('[Error]');
      expect(message).toBe('Something went wrong');
      expect(meta).toBe('');
    });

    it('includes source in prefix when context provided', () => {
      logError('DB failed', { source: 'students' });
      const [prefix, message] = errorSpy.mock.calls[0];
      expect(prefix).toBe('[Error] [students]');
      expect(message).toBe('DB failed');
    });

    it('passes meta object as third argument', () => {
      logError('API error', { meta: { code: 500 } });
      const [, , meta] = errorSpy.mock.calls[0];
      expect(meta).toEqual({ code: 500 });
    });

    it('passes empty string for meta when none provided', () => {
      logError('Plain error');
      const [, , meta] = errorSpy.mock.calls[0];
      expect(meta).toBe('');
    });
  });

  describe('logWarning', () => {
    it('calls console.warn with [Warning] prefix, message, and empty meta', () => {
      logWarning('Disk space low');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [prefix, message, meta] = warnSpy.mock.calls[0];
      expect(prefix).toBe('[Warning]');
      expect(message).toBe('Disk space low');
      expect(meta).toBe('');
    });

    it('includes source in prefix', () => {
      logWarning('Slow query', { source: 'fees' });
      const [prefix] = warnSpy.mock.calls[0];
      expect(prefix).toBe('[Warning] [fees]');
    });
  });

  describe('logInfo', () => {
    it('calls console.info with [Info] prefix, message, and empty meta', () => {
      logInfo('Backup started');
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const [prefix, message, meta] = infoSpy.mock.calls[0];
      expect(prefix).toBe('[Info]');
      expect(message).toBe('Backup started');
      expect(meta).toBe('');
    });

    it('includes source and meta in payload', () => {
      logInfo('User logged in', { source: '/portal', meta: { userId: '123' } });
      const [prefix, message, meta] = infoSpy.mock.calls[0];
      expect(prefix).toBe('[Info] [/portal]');
      expect(message).toBe('User logged in');
      expect(meta).toEqual({ userId: '123' });
    });
  });
});
