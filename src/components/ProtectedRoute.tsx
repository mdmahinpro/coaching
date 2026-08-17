import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';

interface Props {
  role: 'admin' | 'student';
}

export function ProtectedRoute({ role }: Props) {
  const { user, role: userRole, initialized } = useAuthStore();

  if (!initialized) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={role === 'admin' ? '/admin/login' : '/portal/login'} replace />;
  }

  if (userRole !== role) {
    return <Navigate to={role === 'admin' ? '/admin/login' : '/portal/login'} replace />;
  }

  return <Outlet />;
}
