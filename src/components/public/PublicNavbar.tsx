import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, GraduationCap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '@/store/useSettingsStore';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/courses', label: 'Courses' },
  { to: '/notices', label: 'Notice Board' },
  { to: '/contact', label: 'Contact' },
  { to: '/admission', label: 'Admission' },
];

export function PublicNavbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const { settings } = useSettingsStore();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <>
      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-navy-900/95 backdrop-blur-xl shadow-lg shadow-black/20' : 'bg-navy-900/80 backdrop-blur-md'
      } border-b border-navy-700/50`}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-500 to-violet-500 flex items-center justify-center glow-blue shrink-0">
              <GraduationCap size={20} className="text-white" />
            </div>
            <span className="font-inter font-bold text-white text-sm md:text-base">{settings.centerName}</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-0.5">
            {navLinks.map(l => {
              const active = location.pathname === l.to;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className={`relative px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                    active ? 'text-sky-400' : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {l.label}
                  {active && (
                    <motion.span
                      layoutId="nav-indicator"
                      className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-sky-400"
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-2">
            <Link to="/admin/login" className="text-slate-500 hover:text-slate-300 text-xs font-medium transition-colors px-2 py-1">
              Admin
            </Link>
            <Link to="/portal/login" className="btn-primary text-sm py-2 px-4">
              Student Portal
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(v => !v)}
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Toggle menu"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      {/* Mobile overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 w-72 z-50 bg-navy-800 border-l border-navy-700/60 flex flex-col md:hidden"
            >
              <div className="flex items-center justify-between px-5 h-16 border-b border-navy-700/50">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-violet-500 flex items-center justify-center">
                    <GraduationCap size={17} className="text-white" />
                  </div>
                  <span className="font-inter font-bold text-white text-sm">{settings.centerName}</span>
                </div>
                <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white p-1">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-5 space-y-1">
                {navLinks.map((l, i) => {
                  const active = location.pathname === l.to;
                  return (
                    <motion.div
                      key={l.to}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                    >
                      <Link
                        to={l.to}
                        className={`flex items-center px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                          active
                            ? 'text-sky-400 bg-sky-400/10 border border-sky-400/20'
                            : 'text-slate-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {l.label}
                        {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sky-400" />}
                      </Link>
                    </motion.div>
                  );
                })}
              </div>

              <div className="px-4 pb-6 space-y-2 border-t border-navy-700/50 pt-4">
                <Link to="/portal/login" className="btn-primary w-full justify-center">
                  Student Portal
                </Link>
                <Link to="/admin/login" className="btn-outline w-full justify-center text-sm">
                  Admin Login
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
