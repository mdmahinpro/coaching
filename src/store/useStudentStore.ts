import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';
import { sanitize } from '@/utils/sanitize';
import { handleSupabaseError } from '@/utils/errorHandler';

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
}

interface StudentState {
  student: StudentSession | null;
  setStudent: (s: StudentSession | null) => void;
  logout: () => void;
  login: (phone: string, password: string) => Promise<StudentSession>;
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
}

export const useStudentStore = create<StudentState>()(
  persist(
    (set) => ({
      student: null,
      setStudent: (student) => set({ student }),
      logout: () => set({ student: null }),

      login: async (phone: string, password: string) => {
        try {
          const { data, error } = await supabase.rpc('verify_student_login', {
            phone: phone.trim(),
            password,
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
          };
          set({ student: session });
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
          set({ student: session });
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
    }
  )
);
