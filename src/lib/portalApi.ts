import { supabase } from './supabase';
import { getStudentToken, useStudentStore } from '@/store/useStudentStore';

/**
 * Token-scoped portal data access.
 *
 * Students do NOT authenticate through Supabase Auth, so RLS cannot
 * distinguish them via the anon key. Instead every call below passes the
 * student's opaque session token to a SECURITY DEFINER RPC, which resolves
 * the acting student server-side and only ever returns that student's data.
 * The anon client no longer reads students/fees/exams/mcq_* tables directly.
 */

class SessionExpiredError extends Error {
  constructor() {
    super('Session expired. Please log in again.');
    this.name = 'SessionExpiredError';
  }
}

function requireToken(): string {
  const token = getStudentToken();
  if (!token) {
    throw new SessionExpiredError();
  }
  return token;
}

/** Unwrap an RPC result, mapping an expired-session error to a forced logout. */
function unwrap<T>(data: T | null, error: { message?: string } | null): T {
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('Session expired')) {
      // Token is dead server-side; clear the local session so guards redirect.
      useStudentStore.getState().logout();
      throw new SessionExpiredError();
    }
    throw new Error(msg || 'Request failed');
  }
  return data as T;
}

export async function fetchProfile() {
  const { data, error } = await supabase.rpc('portal_get_profile', { p_token: requireToken() });
  return unwrap(data, error)?.[0] ?? null;
}

export async function fetchFees() {
  const { data, error } = await supabase.rpc('portal_get_fees', { p_token: requireToken() });
  return unwrap(data, error) ?? [];
}

export async function fetchExams() {
  const { data, error } = await supabase.rpc('portal_get_exams', { p_token: requireToken() });
  return unwrap(data, error) ?? [];
}

export async function fetchSubmissions() {
  const { data, error } = await supabase.rpc('portal_get_submissions', { p_token: requireToken() });
  return unwrap(data, error) ?? [];
}

export async function fetchNotices(type?: string) {
  const { data, error } = await supabase.rpc('portal_get_notices', {
    p_token: requireToken(),
    p_type: type ?? null,
  });
  return unwrap(data, error) ?? [];
}

export async function updatePhoto(photoUrl: string) {
  const { error } = await supabase.rpc('portal_update_photo', {
    p_token: requireToken(),
    p_photo_url: photoUrl,
  });
  unwrap(null, error);
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const { error } = await supabase.rpc('portal_change_password', {
    p_token: requireToken(),
    p_old_password: oldPassword,
    p_new_password: newPassword,
  });
  unwrap(null, error);
}

/** Answer-review breakdown (correct_option) for an already-submitted exam. */
export async function fetchReview(examId: string) {
  const { data, error } = await supabase.rpc('exam_get_review', {
    p_exam_id: examId,
    p_portal_token: requireToken(),
    p_exam_token: null,
  });
  return unwrap(data, error) ?? [];
}
