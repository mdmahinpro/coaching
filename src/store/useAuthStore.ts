import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { User, Session, Subscription } from '@supabase/supabase-js';

type Role = 'admin' | 'student' | null;

interface AuthState {
  user: User | null;
  session: Session | null;
  role: Role;
  loading: boolean;
  initialized: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
  setRole: (role: Role) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  role: null,
  loading: false,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;

    set({ loading: true });
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const role = session.user.user_metadata?.role as Role ?? null;
      set({ user: session.user, session, role, loading: false, initialized: true });
    } else {
      set({ user: null, session: null, role: null, loading: false, initialized: true });
    }

    // Unsubscribe any previous listener before creating a new one
    const prev = (get() as any)._authUnsubscribe as (() => void) | undefined;
    if (prev) prev();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const role = session.user.user_metadata?.role as Role ?? null;
        set({ user: session.user, session, role });
      } else {
        set({ user: null, session: null, role: null });
      }
    });

    // Store the unsubscribe function on the store itself
    (get() as any)._authUnsubscribe = () => {
      (data.subscription as Subscription).unsubscribe();
    };

    // Clean up on page unload to prevent memory leaks
    const handler = () => { (data.subscription as Subscription).unsubscribe(); };
    window.addEventListener('beforeunload', handler);
    // One-shot cleanup after a short delay (listener stays alive via beforeunload above)
    setTimeout(() => window.removeEventListener('beforeunload', handler), 0);
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ loading: false });
      return { error: error.message };
    }
    const role = data.user?.user_metadata?.role as Role ?? null;
    set({ user: data.user, session: data.session, role, loading: false });
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, role: null });
  },

  setRole: (role: Role) => set({ role }),
}));
