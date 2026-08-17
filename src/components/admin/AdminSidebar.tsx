import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, BookOpen, GraduationCap,
  CreditCard, UserCheck, ClipboardList, Bell,
  MessageSquare, BarChart3, Database, Settings,
  ChevronLeft, ChevronRight, LogOut, X,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/shared/Avatar';

const sections = [
  {
    label: 'OVERVIEW',
    items: [
      { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'ACADEMICS',
    items: [
      { to: '/admin/students', icon: Users, label: 'Students' },
      { to: '/admin/batches', icon: BookOpen, label: 'Batches' },
      { to: '/admin/exams', icon: GraduationCap, label: 'Exams & Results' },
    ],
  },
  {
    label: 'FINANCE',
    items: [
      { to: '/admin/fees', icon: CreditCard, label: 'Fee Management' },
    ],
  },
  {
    label: 'PEOPLE',
    items: [
      { to: '/admin/teachers', icon: UserCheck, label: 'Teachers' },
      { to: '/admin/admissions', icon: ClipboardList, label: 'Admissions' },
    ],
  },
  {
    label: 'COMMS',
    items: [
      { to: '/admin/notices', icon: Bell, label: 'Notices' },
      { to: '/admin/sms', icon: MessageSquare, label: 'SMS Center' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/admin/reports', icon: BarChart3, label: 'Reports' },
      { to: '/admin/backup', icon: Database, label: 'Backup' },
      { to: '/admin/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

function SidebarContent({
  collapsed, onToggle, onMobileClose,
}: { collapsed: boolean; onToggle: () => void; onMobileClose?: () => void }) {
  const location = useLocation();
  const { signOut, user } = useAuthStore();
  const { settings } = useSettingsStore();
  const name = user?.user_metadata?.name ?? user?.email ?? 'Admin';

  return (
    <div className="flex flex-col h-full bg-navy-800 border-r border-navy-700/50">
      {/* Logo header */}
      <div className="flex items-center justify-between px-3 h-16 border-b border-navy-700/50 shrink-0">
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex items-center gap-2.5 overflow-hidden"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-violet-500 flex items-center justify-center shrink-0 glow-blue">
                <GraduationCap size={16} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-inter font-bold text-white text-sm truncate leading-tight">{settings.centerName}</p>
                <span className="badge-blue text-[10px] py-0 px-1.5 leading-4">Admin</span>
              </div>
            </motion.div>
          )}
          {collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mx-auto w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-violet-500 flex items-center justify-center glow-blue"
            >
              <GraduationCap size={16} className="text-white" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Desktop toggle / mobile close */}
        {onMobileClose ? (
          <button onClick={onMobileClose} className="text-slate-400 hover:text-white p-1 rounded transition-colors">
            <X size={18} />
          </button>
        ) : (
          <button
            onClick={onToggle}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {sections.map(section => (
          <div key={section.label}>
            {!collapsed && (
              <p className="text-[10px] font-semibold text-slate-600 tracking-widest px-3 mb-1.5">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label }) => {
                const active = location.pathname === to || location.pathname.startsWith(to + '/');
                return (
                  <Link
                    key={to}
                    to={to}
                    title={collapsed ? label : undefined}
                    onClick={onMobileClose}
                    className={cn(
                      'flex items-center gap-3 py-2 text-sm font-medium transition-all duration-150 relative group',
                      collapsed ? 'px-2 justify-center rounded-lg' : 'px-3 rounded-r-lg',
                      active
                        ? 'bg-sky-400/10 text-sky-400 border-l-2 border-sky-400'
                        : 'text-slate-400 hover:text-white hover:bg-white/5 rounded-lg border-l-2 border-transparent'
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {/* Tooltip for collapsed */}
                    {collapsed && (
                      <div className="absolute left-full ml-2 px-2 py-1 bg-navy-700 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50 border border-navy-600">
                        {label}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: user info + sign out */}
      <div className="border-t border-navy-700/50 p-3 shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2.5 px-2 mb-3">
            <Avatar name={name} size="sm" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">{name}</p>
              <p className="text-[10px] text-sky-400">Administrator</p>
            </div>
          </div>
        )}
        <button
          onClick={() => signOut()}
          title={collapsed ? 'Sign Out' : undefined}
          className={cn(
            'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium',
            'text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut size={15} className="shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );
}

export function AdminSidebar({ collapsed, onToggle, mobileOpen = false, onMobileClose }: Props) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className={cn(
        'fixed left-0 top-0 h-screen z-40 transition-all duration-300 hidden md:block',
        collapsed ? 'w-16' : 'w-64'
      )}>
        <SidebarContent collapsed={collapsed} onToggle={onToggle} />
      </aside>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onMobileClose}
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed left-0 top-0 h-screen w-64 z-50 md:hidden"
            >
              <SidebarContent collapsed={false} onToggle={onToggle} onMobileClose={onMobileClose} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
