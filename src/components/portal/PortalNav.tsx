import { Link, useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap, LogOut, User, LayoutDashboard, Banknote, ClipboardList, Trophy, Bell } from 'lucide-react';
import { useStudentStore } from '@/store/useStudentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Avatar } from '@/components/shared/Avatar';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { to: '/portal/dashboard', label: 'হোম', icon: LayoutDashboard },
  { to: '/portal/fees', label: 'ফি', icon: Banknote },
  { to: '/portal/exams', label: 'পরীক্ষা', icon: ClipboardList },
  { to: '/portal/results', label: 'ফলাফল', icon: Trophy },
  { to: '/portal/notices', label: 'নোটিশ', icon: Bell },
];

export function PortalNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { student, logout } = useStudentStore();
  const { settings } = useSettingsStore();

  const handleLogout = () => { logout(); navigate('/portal/login', { replace: true }); };

  return (
    <>
      {/* Top navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-navy-800/90 backdrop-blur-md border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to="/portal/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center">
              <GraduationCap size={14} className="text-white" />
            </div>
            <span className="font-inter font-bold text-white text-sm hidden sm:block">{settings.centerName}</span>
            <span className="badge-violet text-xs ml-0.5 hidden sm:inline">Portal</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-0.5">
            {NAV_LINKS.map(l => (
              <Link key={l.to} to={l.to}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  location.pathname === l.to ? 'text-violet-400 bg-violet-400/10' : 'text-slate-400 hover:text-white hover:bg-white/5')}>
                {l.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {student && (
              <div className="hidden sm:flex flex-col items-end leading-none">
                <span className="text-white text-xs font-medium">{student.name}</span>
                <span className="font-mono text-sky-400 text-[10px]">{student.student_id}</span>
              </div>
            )}
            <Link to="/portal/profile">
              <Avatar name={student?.name ?? 'S'} size="sm" src={student?.photo_url} />
            </Link>
            <Link to="/portal/profile" className="p-1.5 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 transition-all" title="Profile">
              <User size={15} />
            </Link>
            <button onClick={handleLogout} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Logout">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <div className="fixed bottom-0 inset-x-0 z-50 md:hidden bg-navy-800/95 backdrop-blur-md border-t border-white/5">
        <div className="flex">
          {NAV_LINKS.map(l => {
            const active = location.pathname === l.to;
            return (
              <Link key={l.to} to={l.to} className={cn('flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors', active ? 'text-violet-400' : 'text-slate-500')}>
                <l.icon size={18} />
                <span className="text-[9px] font-medium">{l.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
