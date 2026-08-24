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

/**
 * Resolve the caller's role from the server.
 *
 * `user_metadata.role` is NOT usable here: it is client-writable via
 * `auth.updateUser()`, so any signed-in visitor could set `role: 'admin'` and
 * unlock the admin UI. `is_admin()` is a SECURITY DEFINER RPC that checks the
 * server-only `admin_users` roster against `auth.uid()`.
 *
 * Every non-admin authenticated user is treated as a student. Failures resolve
 * to `null` (no privileges) rather than throwing, so a transient network error
 * denies access instead of granting it.
 */
async function resolveRole(): Promise<Role> {
  try {
    const { data, error } = await supabase.rpc('is_admin');
    if (error) {
      return null;
    }
    return data === true ? 'admin' : 'student';
  } catch {
    return null;
  }
}

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
      const role = await resolveRole();
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
      if (!session?.user) {
        set({ user: null, session: null, role: null });
        return;
      }

      const prev = get();
      const sameUser = prev.user?.id === session.user.id;
      set({ user: session.user, session, role: sameUser ? prev.role : null });

      // Only re-query on a genuine identity change — token refreshes fire this
      // callback too and the roster answer would not differ. Deferred out of
      // the callback because Supabase forbids awaiting its own client here.
      if (!sameUser || prev.role === null) {
        setTimeout(() => {
          void resolveRole().then((role) => {
            if (get().user?.id === session.user.id) {
              set({ role });
            }
          });
        }, 0);
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
    const role = await resolveRole();
    set({ user: data.user, session: data.session, role, loading: false });
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, role: null });
  },

  setRole: (role: Role) => set({ role }),
}));
