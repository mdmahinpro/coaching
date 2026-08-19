import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStudentStore } from './useStudentStore';

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

describe('useStudentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state before each test
    useStudentStore.setState({
      student: null,
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
});
