import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from '@/store/useAuthStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAdminNotifications } from '@/hooks/useAdminNotifications';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { StudentProtectedRoute } from '@/components/StudentProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// ── Public pages — eager (small, needed on any direct URL) ────────────────────
import HomePage from '@/pages/public/HomePage';
import CoursesPage from '@/pages/public/CoursesPage';
import AdmissionPage from '@/pages/public/AdmissionPage';
import NoticeBoardPage from '@/pages/public/NoticeBoardPage';
import ContactPage from '@/pages/public/ContactPage';

// ── Auth pages — eager (shown before any lazy chunk resolves) ─────────────────
import AdminLoginPage from '@/pages/admin/LoginPage';
import PortalLoginPage from '@/pages/portal/PortalLoginPage';
import PortalSignupPage from '@/pages/portal/PortalSignupPage';

// ── Admin pages — lazy (only needed after admin login) ────────────────────────
const DashboardPage = lazy(() => import('@/pages/admin/DashboardPage'));
const StudentsPage = lazy(() => import('@/pages/admin/StudentsPage'));
const BatchesPage = lazy(() => import('@/pages/admin/BatchesPage'));
const TeachersPage = lazy(() => import('@/pages/admin/TeachersPage'));
const FeesPage = lazy(() => import('@/pages/admin/FeesPage'));
const ExamsPage = lazy(() => import('@/pages/admin/ExamsPage'));
const ResultsPage = lazy(() => import('@/pages/admin/ResultsPage'));
const NoticesPage = lazy(() => import('@/pages/admin/NoticesPage'));
const AdmissionsPage = lazy(() => import('@/pages/admin/AdmissionsPage'));
const SMSPage = lazy(() => import('@/pages/admin/SMSPage'));
const ReportsPage = lazy(() => import('@/pages/admin/ReportsPage'));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage'));
const BackupPage = lazy(() => import('@/pages/admin/BackupPage'));

// ── Portal pages — lazy (only needed after student login) ─────────────────────
const PortalDashboardPage = lazy(() => import('@/pages/portal/PortalDashboardPage'));
const PortalFeesPage = lazy(() => import('@/pages/portal/PortalFeesPage'));
const PortalExamsPage = lazy(() => import('@/pages/portal/PortalExamsPage'));
const PortalResultsPage = lazy(() => import('@/pages/portal/PortalResultsPage'));
const PortalNoticePage = lazy(() => import('@/pages/portal/PortalNoticePage'));
const PortalProfilePage = lazy(() => import('@/pages/portal/PortalProfilePage'));

// ── Exam page — lazy (only needed for /exam/:id links) ───────────────────────
const ExamPage = lazy(() => import('@/pages/ExamPage'));

function PageLoader() {
  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin" />
    </div>
  );
}

function LazyWrapper({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

/** Single always-mounted notification engine for admins (bell in AdminHeader). */
function AdminNotificationMount() {
  const { user, role, initialized } = useAuthStore();
  const email = role === 'admin' && user ? user.email ?? null : null;
  useAdminNotifications(initialized ? email : null);
  return null;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public */}
        <Route path="/" element={<HomePage />} />
        <Route path="/courses" element={<CoursesPage />} />
        <Route path="/admission" element={<AdmissionPage />} />
        <Route path="/notices" element={<NoticeBoardPage />} />
        <Route path="/contact" element={<ContactPage />} />

        {/* Admin login */}
        <Route path="/admin/login" element={<AdminLoginPage />} />

        {/* Admin protected (Supabase Auth) */}
        <Route element={<ProtectedRoute role="admin" />}>
          <Route
            path="/admin/dashboard"
            element={
              <LazyWrapper>
                <DashboardPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/students"
            element={
              <LazyWrapper>
                <StudentsPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/batches"
            element={
              <LazyWrapper>
                <BatchesPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/teachers"
            element={
              <LazyWrapper>
                <TeachersPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/fees"
            element={
              <LazyWrapper>
                <FeesPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/exams"
            element={
              <LazyWrapper>
                <ExamsPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/results"
            element={
              <LazyWrapper>
                <ResultsPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/notices"
            element={
              <LazyWrapper>
                <NoticesPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/admissions"
            element={
              <LazyWrapper>
                <AdmissionsPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/sms"
            element={
              <LazyWrapper>
                <SMSPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <LazyWrapper>
                <ReportsPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <LazyWrapper>
                <SettingsPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/backup"
            element={
              <LazyWrapper>
                <BackupPage />
              </LazyWrapper>
            }
          />
        </Route>

        {/* Portal login + signup (public) */}
        <Route path="/portal/login" element={<PortalLoginPage />} />
        <Route path="/portal/signup" element={<PortalSignupPage />} />

        {/* Portal protected (student sessionStorage auth) */}
        <Route element={<StudentProtectedRoute />}>
          <Route
            path="/portal/dashboard"
            element={
              <LazyWrapper>
                <PortalDashboardPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/portal/fees"
            element={
              <LazyWrapper>
                <PortalFeesPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/portal/exams"
            element={
              <LazyWrapper>
                <PortalExamsPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/portal/results"
            element={
              <LazyWrapper>
                <PortalResultsPage />
              </LazyWrapper>
            }
          />
          <Route
            path="/portal/notices"
            element={
              <LazyWrapper>
                <PortalNoticePage />
              </LazyWrapper>
            }
          />
          <Route
            path="/portal/profile"
            element={
              <LazyWrapper>
                <PortalProfilePage />
              </LazyWrapper>
            }
          />
        </Route>

        {/* Public exam page */}
        <Route
          path="/exam/:examId"
          element={
            <LazyWrapper>
              <ExamPage />
            </LazyWrapper>
          }
        />

        {/* Redirects */}
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/portal" element={<Navigate to="/portal/dashboard" replace />} />

        {/* 404 */}
        <Route
          path="*"
          element={
            <div className="min-h-screen bg-navy-900 flex items-center justify-center text-center px-4">
              <div>
                <h1 className="font-inter font-black text-6xl text-sky-400 mb-4">404</h1>
                <p className="text-white text-xl font-semibold mb-2">Page not found</p>
                <p className="text-slate-400 mb-6">
                  The page you&apos;re looking for doesn&apos;t exist.
                </p>
                <a href="/" className="btn-primary">
                  Go Home
                </a>
              </div>
            </div>
          }
        />
      </Routes>
    </Suspense>
  );
}

function App() {
  const { initialize, teardown } = useAuthStore();
  const { loadFromDB } = useSettingsStore();
  useEffect(() => {
    initialize();
    loadFromDB();
    return () => teardown();
  }, []);
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return (
    <ErrorBoundary>
      <BrowserRouter basename={base}>
        <AppRoutes />
        <AdminNotificationMount />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#0f172a',
              color: '#f8fafc',
              border: '1px solid #1e293b',
              borderRadius: '10px',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#34d399', secondary: '#0f172a' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#0f172a' } },
          }}
        />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
