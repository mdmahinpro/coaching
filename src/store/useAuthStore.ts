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
  teardown: () => void;
  setRole: (role: Role) => void;
}

// Module-scoped handle to the single active auth subscription. Kept outside
// the store state so it never triggers re-renders and can be torn down cleanly.
let authSubscription: Subscription | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  role: null,
  loading: false,
  initialized: false,

  initialize: async () => {
    if (get().initialized) {
      return;
    }

    set({ loading: true });
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      const role = (session.user.user_metadata?.role as Role) ?? null;
      set({ user: session.user, session, role, loading: false, initialized: true });
    } else {
      set({ user: null, session: null, role: null, loading: false, initialized: true });
    }

    // Tear down any previous listener before creating a new one (idempotent).
    if (authSubscription) {
      authSubscription.unsubscribe();
      authSubscription = null;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const role = (session.user.user_metadata?.role as Role) ?? null;
        set({ user: session.user, session, role });
      } else {
        set({ user: null, session: null, role: null });
      }
    });

    authSubscription = data.subscription;
  },

  // Call from a root-level effect cleanup if you ever unmount the app tree.
  teardown: () => {
    if (authSubscription) {
      authSubscription.unsubscribe();
      authSubscription = null;
    }
    set({ initialized: false });
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ loading: false });
      return { error: error.message };
    }
    const role = (data.user?.user_metadata?.role as Role) ?? null;
    set({ user: data.user, session: data.session, role, loading: false });
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, role: null });
  },

  setRole: (role: Role) => set({ role }),
}));
