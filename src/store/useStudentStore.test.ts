import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStudentStore, type StudentSession } from './useStudentStore';

// Mock the supabase module
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

// Mock the error handler
vi.mock('@/utils/errorHandler', () => ({
  handleSupabaseError: vi.fn(),
}));

// Mock the sanitize utility
vi.mock('@/utils/sanitize', () => ({
  sanitize: (val: string) => val,
}));

vi.mock('@/lib/examRecovery', () => ({
  clearAllExamDrafts: vi.fn(),
}));

const makeSession = (overrides: Partial<StudentSession> = {}): StudentSession => ({
  id: 'stu-1',
  name: 'Test Student',
  student_id: 'STU001',
  phone: '01700000000',
  status: 'active',
  is_approved: true,
  token: 'token-1',
  ...overrides,
});

const validRow = {
  id: 'stu-1',
  name: 'Updated Name',
  student_id: 'STU001',
  phone: '01700000000',
  email: 'a@b.com',
  class_level: 'HSC',
  batch_id: 'batch-1',
  photo_url: null,
  status: 'active',
  is_approved: true,
};

/** Deferred promise whose settlement is controlled by the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useStudentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // Reset store to initial state before each test
    useStudentStore.setState({
      student: null,
      sessionChecking: false,
      sessionValid: false,
      sessionError: false,
    });
  });

  it('initializes with no student session', () => {
    const state = useStudentStore.getState();
    expect(state.student).toBeNull();
  });

  it('setStudent updates the student', () => {
    const mockStudent = {
      id: '123',
      name: 'Test Student',
      student_id: 'STU001',
      phone: '01700000000',
      status: 'active',
      is_approved: true,
    };

    useStudentStore.getState().setStudent(mockStudent);
    expect(useStudentStore.getState().student).toEqual(mockStudent);
  });

  it('logout clears the student session', () => {
    const mockStudent = {
      id: '123',
      name: 'Test Student',
      student_id: 'STU001',
      phone: '01700000000',
      status: 'active',
      is_approved: true,
    };

    useStudentStore.getState().setStudent(mockStudent);
    expect(useStudentStore.getState().student).not.toBeNull();

    useStudentStore.getState().logout();
    expect(useStudentStore.getState().student).toBeNull();
  });

  it('login calls the RPC with SQL argument names and stores the session token', async () => {
    const { supabase } = await import('@/lib/supabase');
    const mockRow = {
      id: '123',
      name: 'Test Student',
      student_id: 'STU001',
      phone: '01700000000',
      email: null,
      class_level: null,
      batch_id: null,
      photo_url: null,
      status: 'active',
      is_approved: true,
      created_at: null,
      session_token: 'session-token-123',
    };

    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [mockRow],
      error: null,
    } as any);

    const session = await useStudentStore.getState().login(' 01700000000 ', 'password123');

    expect(supabase.rpc).toHaveBeenCalledWith('verify_student_login', {
      p_phone: '01700000000',
      p_password: 'password123',
    });
    expect(session).toEqual({
      id: '123',
      name: 'Test Student',
      student_id: 'STU001',
      phone: '01700000000',
      email: undefined,
      class_level: undefined,
      batch_id: undefined,
      photo_url: undefined,
      status: 'active',
      is_approved: true,
      token: 'session-token-123',
    });
    expect(useStudentStore.getState().student).toEqual(session);
  });

  it('login throws on unapproved account', async () => {
    const { supabase } = await import('@/lib/supabase');
    const mockRow = {
      id: '123',
      name: 'Test Student',
      student_id: 'STU001',
      phone: '01700000000',
      status: 'active',
      is_approved: false,
    };

    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [mockRow],
      error: null,
    } as any);

    await expect(useStudentStore.getState().login('01700000000', 'password123')).rejects.toThrow(
      'আপনার অ্যাকাউন্ট এখনো অনুমোদিত হয়নি।'
    );
  });

  it('login throws on suspended account', async () => {
    const { supabase } = await import('@/lib/supabase');
    const mockRow = {
      id: '123',
      name: 'Test Student',
      student_id: 'STU001',
      phone: '01700000000',
      status: 'suspended',
      is_approved: true,
    };

    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [mockRow],
      error: null,
    } as any);

    await expect(useStudentStore.getState().login('01700000000', 'password123')).rejects.toThrow(
      'আপনার অ্যাকাউন্ট সাময়িকভাবে স্থগিত করা হয়েছে।'
    );
  });

  it('login throws on invalid credentials', async () => {
    const { supabase } = await import('@/lib/supabase');

    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [],
      error: null,
    } as any);

    await expect(useStudentStore.getState().login('01700000000', 'wrongpass')).rejects.toThrow(
      'ফোন নম্বর বা পাসওয়ার্ড ভুল।'
    );
  });

  describe('validateSession', () => {
    it('applies a valid response to the matching session', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [validRow], error: null } as any);

      const ok = await useStudentStore.getState().validateSession();

      expect(ok).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith('portal_validate_session', { p_token: 'token-1' });
      const state = useStudentStore.getState();
      expect(state.sessionValid).toBe(true);
      expect(state.sessionError).toBe(false);
      expect(state.sessionChecking).toBe(false);
      expect(state.student).toMatchObject({
        token: 'token-1',
        name: 'Updated Name',
        email: 'a@b.com',
        class_level: 'HSC',
        status: 'active',
        is_approved: true,
      });
    });

    it('clears the session on an invalid/expired (empty) response', async () => {
      const { supabase } = await import('@/lib/supabase');
      const { clearAllExamDrafts } = await import('@/lib/examRecovery');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as any);

      const ok = await useStudentStore.getState().validateSession();

      expect(ok).toBe(false);
      const state = useStudentStore.getState();
      expect(state.student).toBeNull();
      expect(state.sessionValid).toBe(false);
      expect(state.sessionError).toBe(false);
      expect(state.sessionChecking).toBe(false);
      expect(clearAllExamDrafts).toHaveBeenCalled();
    });

    it('treats a returned RPC error as transient and keeps the session unresolved', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'network error' },
      } as any);

      const ok = await useStudentStore.getState().validateSession();

      expect(ok).toBe(false);
      const state = useStudentStore.getState();
      expect(state.student).not.toBeNull();
      expect(state.sessionValid).toBe(false);
      expect(state.sessionError).toBe(true);
      expect(state.sessionChecking).toBe(false);
    });

    it('treats a rejected promise as transient and clears loading state', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockRejectedValue(new Error('boom'));

      const ok = await useStudentStore.getState().validateSession();

      expect(ok).toBe(false);
      const state = useStudentStore.getState();
      expect(state.sessionValid).toBe(false);
      expect(state.sessionError).toBe(true);
      expect(state.sessionChecking).toBe(false);
    });

    it('ignores a response that resolves after logout', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession() });
      const pending = deferred<{ data: unknown; error: unknown }>();
      vi.mocked(supabase.rpc).mockReturnValue(pending.promise as any);

      const validation = useStudentStore.getState().validateSession();
      expect(useStudentStore.getState().sessionChecking).toBe(true);

      useStudentStore.getState().logout();
      expect(useStudentStore.getState().student).toBeNull();
      expect(useStudentStore.getState().sessionChecking).toBe(false);

      pending.resolve({ data: [validRow], error: null });
      const ok = await validation;

      expect(ok).toBe(false);
      const state = useStudentStore.getState();
      expect(state.student).toBeNull();
      expect(state.sessionValid).toBe(false);
      expect(state.sessionError).toBe(false);
    });

    it('ignores a response meant for the previous account after switching', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession() });
      const pending = deferred<{ data: unknown; error: unknown }>();
      vi.mocked(supabase.rpc).mockReturnValue(pending.promise as any);

      const validation = useStudentStore.getState().validateSession();

      useStudentStore.setState({
        student: makeSession({ id: 'stu-2', token: 'token-2', name: 'Second Student' }),
      });

      pending.resolve({ data: [{ ...validRow, id: 'stu-1', name: 'Old Account' }], error: null });
      const ok = await validation;

      expect(ok).toBe(false);
      const state = useStudentStore.getState();
      expect(state.student?.token).toBe('token-2');
      expect(state.student?.name).toBe('Second Student');
      expect(state.sessionValid).toBe(false);
    });

    it('lets only the newest overlapping request apply (out-of-order)', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession() });
      const first = deferred<{ data: unknown; error: unknown }>();
      const second = deferred<{ data: unknown; error: unknown }>();
      vi.mocked(supabase.rpc)
        .mockReturnValueOnce(first.promise as any)
        .mockReturnValueOnce(second.promise as any);

      const firstValidation = useStudentStore.getState().validateSession();
      const secondValidation = useStudentStore.getState().validateSession();

      // Newer (second) request resolves first with a valid row.
      second.resolve({ data: [{ ...validRow, name: 'Newer' }], error: null });
      expect(await secondValidation).toBe(true);
      expect(useStudentStore.getState().sessionValid).toBe(true);

      // Stale (first) request resolves last and must not overwrite/clear.
      first.resolve({ data: [], error: null });
      expect(await firstValidation).toBe(false);

      const state = useStudentStore.getState();
      expect(state.student).not.toBeNull();
      expect(state.student?.name).toBe('Newer');
      expect(state.sessionValid).toBe(true);
      expect(state.sessionChecking).toBe(false);
    });

    it('treats a malformed (non-array) response as transient without wiping drafts', async () => {
      const { supabase } = await import('@/lib/supabase');
      const { clearAllExamDrafts } = await import('@/lib/examRecovery');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockResolvedValue({ data: { id: 'stu-1' }, error: null } as any);

      const ok = await useStudentStore.getState().validateSession();

      expect(ok).toBe(false);
      const state = useStudentStore.getState();
      expect(state.student).not.toBeNull();
      expect(state.sessionValid).toBe(false);
      expect(state.sessionError).toBe(true);
      expect(state.sessionChecking).toBe(false);
      expect(clearAllExamDrafts).not.toHaveBeenCalled();
    });

    it('treats a multi-row response as transient without wiping drafts', async () => {
      const { supabase } = await import('@/lib/supabase');
      const { clearAllExamDrafts } = await import('@/lib/examRecovery');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: [validRow, { ...validRow, id: 'stu-2' }],
        error: null,
      } as any);

      const ok = await useStudentStore.getState().validateSession();

      expect(ok).toBe(false);
      expect(useStudentStore.getState().student).not.toBeNull();
      expect(useStudentStore.getState().sessionError).toBe(true);
      expect(clearAllExamDrafts).not.toHaveBeenCalled();
    });

    it('treats a null row element as transient without wiping drafts', async () => {
      const { supabase } = await import('@/lib/supabase');
      const { clearAllExamDrafts } = await import('@/lib/examRecovery');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [null], error: null } as any);

      const ok = await useStudentStore.getState().validateSession();

      expect(ok).toBe(false);
      expect(useStudentStore.getState().sessionError).toBe(true);
      expect(useStudentStore.getState().student).not.toBeNull();
      expect(clearAllExamDrafts).not.toHaveBeenCalled();
    });

    it('rejects a row whose id does not match the current identity', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: [{ ...validRow, id: 'stu-other' }],
        error: null,
      } as any);

      const ok = await useStudentStore.getState().validateSession();

      expect(ok).toBe(false);
      const state = useStudentStore.getState();
      expect(state.student?.id).toBe('stu-1');
      expect(state.student?.name).toBe('Test Student');
      expect(state.sessionValid).toBe(false);
      expect(state.sessionError).toBe(true);
    });

    it('rejects a row whose student_id does not match the current identity', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: [{ ...validRow, student_id: 'STU-OTHER' }],
        error: null,
      } as any);

      const ok = await useStudentStore.getState().validateSession();

      expect(ok).toBe(false);
      expect(useStudentStore.getState().sessionValid).toBe(false);
      expect(useStudentStore.getState().sessionError).toBe(true);
    });

    it('does not wipe drafts on a returned RPC error', async () => {
      const { supabase } = await import('@/lib/supabase');
      const { clearAllExamDrafts } = await import('@/lib/examRecovery');
      useStudentStore.setState({ student: makeSession() });
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'gateway timeout' },
      } as any);

      await useStudentStore.getState().validateSession();

      expect(clearAllExamDrafts).not.toHaveBeenCalled();
    });

    it('drops a stale failure while a newer request remains pending', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession() });
      const first = deferred<{ data: unknown; error: unknown }>();
      const second = deferred<{ data: unknown; error: unknown }>();
      vi.mocked(supabase.rpc)
        .mockReturnValueOnce(first.promise as any)
        .mockReturnValueOnce(second.promise as any);

      const firstValidation = useStudentStore.getState().validateSession();
      const secondValidation = useStudentStore.getState().validateSession();

      // Older request rejects while the newer one is still unresolved.
      first.reject(new Error('stale network error'));
      expect(await firstValidation).toBe(false);

      let state = useStudentStore.getState();
      expect(state.sessionValid).toBe(false);
      expect(state.sessionError).toBe(false);
      expect(state.sessionChecking).toBe(true);
      expect(state.student).not.toBeNull();

      // Newer request then confirms the session.
      second.resolve({ data: [validRow], error: null });
      expect(await secondValidation).toBe(true);
      state = useStudentStore.getState();
      expect(state.sessionValid).toBe(true);
      expect(state.sessionError).toBe(false);
      expect(state.sessionChecking).toBe(false);
    });
  });

  describe('setStudent action', () => {
    it('resets validation flags and invalidates in-flight requests on identity change', async () => {
      const { supabase } = await import('@/lib/supabase');
      useStudentStore.setState({ student: makeSession(), sessionValid: true });
      const pending = deferred<{ data: unknown; error: unknown }>();
      vi.mocked(supabase.rpc).mockReturnValue(pending.promise as any);

      const validation = useStudentStore.getState().validateSession();

      const next = makeSession({ id: 'stu-2', token: 'token-2', name: 'Second Student' });
      useStudentStore.getState().setStudent(next);

      const state = useStudentStore.getState();
      expect(state.student).toEqual(next);
      expect(state.sessionValid).toBe(false);
      expect(state.sessionError).toBe(false);
      expect(state.sessionChecking).toBe(false);

      pending.resolve({ data: [{ ...validRow, id: 'stu-1' }], error: null });
      expect(await validation).toBe(false);
      expect(useStudentStore.getState().student?.token).toBe('token-2');
      expect(useStudentStore.getState().sessionValid).toBe(false);
    });

    it('preserves confirmed validation state for a same-identity refresh', () => {
      useStudentStore.setState({ student: makeSession(), sessionValid: true });
      useStudentStore.getState().setStudent(makeSession({ name: 'Refreshed Name' }));

      const state = useStudentStore.getState();
      expect(state.student?.name).toBe('Refreshed Name');
      expect(state.sessionValid).toBe(true);
    });
  });

  describe('hydration', () => {
    it('restores only the student snapshot and never trusts persisted validation flags', async () => {
      sessionStorage.setItem(
        'student-session',
        JSON.stringify({
          state: {
            student: makeSession({ name: 'Persisted Student' }),
            sessionChecking: true,
            sessionValid: true,
            sessionError: true,
          },
          version: 0,
        })
      );

      await useStudentStore.persist.rehydrate();

      const state = useStudentStore.getState();
      expect(state.student?.token).toBe('token-1');
      expect(state.student?.name).toBe('Persisted Student');
      expect(state.sessionValid).toBe(false);
      expect(state.sessionChecking).toBe(false);
      expect(state.sessionError).toBe(false);
    });

    it('hydrates a missing student as null with flags reset', async () => {
      sessionStorage.setItem(
        'student-session',
        JSON.stringify({ state: { student: null, sessionValid: true }, version: 0 })
      );

      await useStudentStore.persist.rehydrate();

      const state = useStudentStore.getState();
      expect(state.student).toBeNull();
      expect(state.sessionValid).toBe(false);
    });

    it('persists only the allowed student snapshot', async () => {
      useStudentStore.setState({
        student: makeSession({ name: 'Stored Name' }),
        sessionValid: true,
        sessionChecking: true,
        sessionError: true,
      });

      const raw = sessionStorage.getItem('student-session');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw as string);
      expect(parsed.state).toEqual({ student: makeSession({ name: 'Stored Name' }) });
      expect(parsed.state.sessionValid).toBeUndefined();
    });
  });
});
