import { Navigate, Outlet } from 'react-router-dom';
import { useStudentStore } from '@/store/useStudentStore';

export function StudentProtectedRoute() {
  const { student } = useStudentStore();
  if (!student) return <Navigate to="/portal/login" replace />;
  return <Outlet />;
}
