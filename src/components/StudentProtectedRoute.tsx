import { Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useStudentStore } from '@/store/useStudentStore';

export function StudentProtectedRoute() {
  const { student, sessionChecking, sessionValid, sessionError, validateSession } =
    useStudentStore();
  const token = student?.token;

  useEffect(() => {
    // Revalidate only when the identity changes; a same-identity profile
    // refresh keeps the confirmed validation state.
    if (token && !useStudentStore.getState().sessionValid) {
      void validateSession();
    }
  }, [token, validateSession]);

  // No identity (or no token to resolve one server-side): never render protected content.
  if (!student || !token) {
    return <Navigate to="/portal/login" replace />;
  }

  // Validation unresolved: show loading, or a retry affordance for a transient failure.
  if (!sessionValid) {
    if (sessionError && !sessionChecking) {
      return (
        <div className="min-h-screen bg-navy-900 flex flex-col items-center justify-center gap-4">
          <p className="text-slate-300">Could not verify your session.</p>
          <button
            type="button"
            onClick={() => void validateSession()}
            className="px-4 py-2 rounded-md bg-sky-500 text-white hover:bg-sky-400"
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin" />
      </div>
    );
  }

  return <Outlet />;
}
