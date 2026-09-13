import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';
import { sanitize } from '@/utils/sanitize';
import { handleSupabaseError } from '@/utils/errorHandler';
import { clearAllExamDrafts } from '@/lib/examRecovery';

export interface StudentSession {
  id: string;
  name: string;
  student_id: string;
  phone: string;
  email?: string;
  class_level?: string;
  batch_id?: string;
  batch_name?: string;
  photo_url?: string;
  status: string;
  is_approved: boolean;
  /** Opaque server-side session token; every portal RPC resolves identity from it. */
  token?: string;
}

/** Read the current student's session token (used by portal/exam RPCs). */
export function getStudentToken(): string | null {
  return useStudentStore.getState().student?.token ?? null;
}

/**
 * Monotonic generation for in-flight validations. Every identity change
 * (login, logout, register, setStudent) or newer validation bumps it so stale
 * responses can be detected and ignored.
 */
let validationGeneration = 0;

/** The live session a request belongs to, or null if the request is already stale. */
function currentSessionFor(gen: number, token: string): StudentSession | null {
  if (gen !== validationGeneration) {
    return null;
  }
  const current = useStudentStore.getState().student;
  if (!current || current.token !== token) {
    return null;
  }
  return current;
}

/**
 * Apply a validation outcome in a single atomic update, after re-confirming
 * the request is still the freshest one for the same identity. Stale requests
 * are dropped without touching loading state or the student.
 */
function commitValidation(
  gen: number,
  token: string,
  build: (current: StudentSession) => Partial<StudentState>
): boolean {
  const current = currentSessionFor(gen, token);
  if (!current) {
    return false;
  }
  useStudentStore.setState(build(current) as Partial<StudentState>);
  return true;
}

/**
 * Transient failure (rejected promise, RPC error, or malformed response):
 * the session is unresolved, not invalid. Never marks the session valid and
 * never clears the stored identity or exam drafts.
 */
function failValidationTransient(gen: number, token: string): false {
  commitValidation(gen, token, () => ({
    sessionChecking: false,
    sessionValid: false,
    sessionError: true,
  }));
  return false;
}

interface ValidationRow {
  id?: unknown;
  name?: unknown;
  student_id?: unknown;
  phone?: unknown;
  email?: unknown;
  class_level?: unknown;
  batch_id?: unknown;
  photo_url?: unknown;
  status?: unknown;
  is_approved?: unknown;
}

/** The RPC returns the validated student's own row; require it to match. */
function rowMatchesSession(row: ValidationRow, current: StudentSession): boolean {
  if (typeof row.id !== 'string' || row.id !== current.id) {
    return false;
  }
  if (
    typeof row.student_id === 'string' &&
    current.student_id &&
    row.student_id !== current.student_id
  ) {
    return false;
  }
  return true;
}

function studentFromRow(row: ValidationRow, current: StudentSession): StudentSession {
  return {
    ...current,
    name: sanitize(typeof row.name === 'string' ? row.name : current.name),
    email: typeof row.email === 'string' ? row.email : undefined,
    class_level: typeof row.class_level === 'string' ? row.class_level : undefined,
    batch_id: typeof row.batch_id === 'string' ? row.batch_id : undefined,
    photo_url: typeof row.photo_url === 'string' ? row.photo_url : undefined,
    status: typeof row.status === 'string' ? row.status : current.status,
    is_approved: typeof row.is_approved === 'boolean' ? row.is_approved : current.is_approved,
  };
}

interface StudentState {
  student: StudentSession | null;
  setStudent: (s: StudentSession | null) => void;
  logout: () => void;
  login: (phone: string, password: string) => Promise<StudentSession>;
  /** True only after the current identity's token was confirmed valid. */
  sessionValid: boolean;
  /** True when the last validation attempt failed transiently (retryable). */
  sessionError: boolean;
  register: (data: {
    name: string;
    phone: string;
    student_id: string;
    password: string;
    email?: string;
    guardian_name?: string;
    guardian_phone?: string;
    address?: string;
    class_level?: string;
    gender?: string;
    batch_id?: string;
    status?: string;
    is_approved?: boolean;
    photo_url?: string;
  }) => Promise<StudentSession>;
  validateSession: () => Promise<boolean>;
  sessionChecking: boolean;
}

export const useStudentStore = create<StudentState>()(
  persist(
    (set) => ({
      student: null,
      sessionChecking: false,
      sessionValid: false,
      sessionError: false,
      setStudent: (student) => {
        const prev = useStudentStore.getState().student;
        const identityChanged =
          (prev?.token ?? null) !== (student?.token ?? null) ||
          (prev?.id ?? null) !== (student?.id ?? null);
        if (identityChanged) {
          // Identity change: invalidate in-flight validations and require revalidation.
          validationGeneration += 1;
          useStudentStore.setState({
            student,
            sessionChecking: false,
            sessionValid: false,
            sessionError: false,
          });
          return;
        }
        // Same identity (e.g. profile refresh): keep the confirmed validation state.
        useStudentStore.setState({ student });
      },
      validateSession: async () => {
        const token = getStudentToken();
        if (!token) {
          validationGeneration += 1;
          useStudentStore.setState({
            student: null,
            sessionValid: false,
            sessionError: false,
            sessionChecking: false,
          });
          return false;
        }
        const gen = (validationGeneration += 1);
        useStudentStore.setState({
          sessionChecking: true,
          sessionValid: false,
          sessionError: false,
        });
        let data: unknown;
        let error: unknown;
        try {
          const result = await supabase.rpc('portal_validate_session', { p_token: token });
          data = result.data;
          error = result.error;
        } catch {
          // Rejected promise: transient failure, never a success.
          return failValidationTransient(gen, token);
        }
        if (error) {
          // Contract note: portal_validate_session signals an invalid/expired
          // session with an EMPTY RESULT SET, not an RPC error. A returned
          // error is therefore a transport/transient failure and must never be
          // treated as an expired session or as a successful validation.
          return failValidationTransient(gen, token);
        }
        // Documented invalid/expired/revoked response: an empty portal row set.
        if (Array.isArray(data) && data.length === 0) {
          const applied = commitValidation(gen, token, () => ({
            student: null,
            sessionChecking: false,
            sessionValid: false,
            sessionError: false,
          }));
          if (applied) {
            clearAllExamDrafts();
          }
          return false;
        }
        // Any other non-conforming shape is malformed, not proof of expiry.
        if (
          !Array.isArray(data) ||
          data.length !== 1 ||
          typeof data[0] !== 'object' ||
          data[0] === null
        ) {
          return failValidationTransient(gen, token);
        }
        const row = data[0] as ValidationRow;
        // Confirm the row belongs to the captured identity before accepting it.
        const current = currentSessionFor(gen, token);
        if (current && !rowMatchesSession(row, current)) {
          return failValidationTransient(gen, token);
        }
        // Apply freshness check, profile data, and flags in one atomic update.
        const applied = commitValidation(gen, token, (session) => ({
          student: studentFromRow(row, session),
          sessionChecking: false,
          sessionValid: true,
          sessionError: false,
        }));
        return applied;
      },
      logout: () => {
        // Invalidate every in-flight validation before clearing identity.
        validationGeneration += 1;
        const token = useStudentStore.getState().student?.token;
        if (token) {
          // Revoke server-side session; ignore failures (best-effort).
          supabase.rpc('logout_student_session', { p_token: token }).then(
            () => {},
            () => {}
          );
        }
        set({ student: null, sessionChecking: false, sessionValid: false, sessionError: false });
        clearAllExamDrafts();
      },

      login: async (phone: string, password: string) => {
        try {
          const { data, error } = await supabase.rpc('verify_student_login', {
            p_phone: phone.trim(),
            p_password: password,
          });
          if (error) {
            const msg = error.message || 'Login failed';
            // Preserve rate-limit and other specific errors; only mask generic auth errors
            if (msg.includes('Invalid') || msg.includes('Too many failed')) {
              throw new Error(msg);
            }
            throw new Error('ফোন নম্বর বা পাসওয়ার্ড ভুল।');
          }
          const row = (data as any[])[0];
          if (!row) {
            throw new Error('ফোন নম্বর বা পাসওয়ার্ড ভুল।');
          }
          if (!row.is_approved) {
            throw new Error('আপনার অ্যাকাউন্ট এখনো অনুমোদিত হয়নি।');
          }
          if (row.status === 'suspended') {
            throw new Error('আপনার অ্যাকাউন্ট সাময়িকভাবে স্থগিত করা হয়েছে।');
          }
          const session: StudentSession = {
            id: row.id,
            name: sanitize(row.name ?? ''),
            student_id: row.student_id,
            phone: row.phone,
            email: row.email ?? undefined,
            class_level: row.class_level ?? undefined,
            batch_id: row.batch_id ?? undefined,
            photo_url: row.photo_url ?? undefined,
            status: row.status,
            is_approved: row.is_approved,
            token: row.session_token ?? undefined,
          };
          // A new account must never inherit another account's local exam
          // drafts, even when the browser session is switched without logout.
          clearAllExamDrafts();
          validationGeneration += 1;
          set({
            student: session,
            sessionChecking: false,
            sessionValid: false,
            sessionError: false,
          });
          return session;
        } catch (err) {
          handleSupabaseError(err);
          throw err;
        }
      },

      register: async (data) => {
        try {
          const { data: row, error } = await supabase.rpc('register_student', {
            p_name: data.name,
            p_phone: data.phone,
            p_student_id: data.student_id,
            p_password: data.password,
            p_email: data.email ?? null,
            p_guardian_name: data.guardian_name ?? null,
            p_guardian_phone: data.guardian_phone ?? null,
            p_address: data.address ?? null,
            p_class_level: data.class_level ?? null,
            p_gender: data.gender ?? null,
            p_batch_id: data.batch_id ?? null,
            p_status: data.status ?? 'active',
            p_is_approved: data.is_approved ?? false,
            p_photo_url: data.photo_url ?? null,
          });
          if (error) {
            throw new Error(error.message || 'Registration failed');
          }
          const r = (row as any[])[0];
          const session: StudentSession = {
            id: r.id,
            name: sanitize(r.name ?? ''),
            student_id: r.student_id,
            phone: r.phone,
            email: r.email,
            class_level: r.class_level,
            batch_id: r.batch_id,
            photo_url: r.photo_url,
            status: r.status,
            is_approved: r.is_approved,
          };
          validationGeneration += 1;
          set({
            student: session,
            sessionChecking: false,
            sessionValid: false,
            sessionError: false,
          });
          return session;
        } catch (err) {
          handleSupabaseError(err);
          throw err;
        }
      },
    }),
    {
      name: 'student-session',
      storage: createJSONStorage(() => sessionStorage),
      // Persist only the identity snapshot. Validation flags must never be
      // restored, or the guard could render protected content without a
      // fresh server check after a reload.
      partialize: (state) => ({ student: state.student }),
      // Hydration restores only the allowed student snapshot and always resets
      // validation flags, even if stored data is tampered with.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as { student?: unknown };
        const student =
          stored.student && typeof stored.student === 'object'
            ? (stored.student as StudentSession)
            : null;
        return {
          ...current,
          student,
          sessionChecking: false,
          sessionValid: false,
          sessionError: false,
        };
      },
    }
  )
);
