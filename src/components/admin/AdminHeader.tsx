import { useState, useEffect, useRef } from 'react';
import { Bell, Search, Menu, LogOut, X, Hash } from 'lucide-react';
import { Avatar } from '@/components/shared/Avatar';
import { useAuthStore } from '@/store/useAuthStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  onMenuToggle?: () => void;
}

interface SearchResult {
  id: string;
  name: string;
  student_id: string;
  class_level?: string;
  photo_url?: string;
}

export function AdminHeader({ title, onMenuToggle }: Props) {
  const { user, signOut } = useAuthStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const name = user?.user_metadata?.name ?? user?.email?.split('@')[0] ?? 'Admin';
  const navigate = useNavigate();
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogout = async () => {
    await signOut();
    navigate('/admin/login');
  };

  const handleSearch = (q: string) => {
    setSearchQ(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('students')
        .select('id, name, student_id, class_level, photo_url')
        .or(`name.ilike.%${q.trim()}%,student_id.ilike.%${q.trim()}%`)
        .limit(6);
      setSearchResults((data ?? []) as SearchResult[]);
      setSearchLoading(false);
    }, 280);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQ('');
    setSearchResults([]);
  };

  // Clear pending debounce on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="h-14 bg-navy-800/80 backdrop-blur-md border-b border-navy-700/50 flex items-center px-4 md:px-6 gap-2 sticky top-0 z-30">
      {/* Hamburger */}
      <button
        onClick={onMenuToggle}
        className="md:hidden w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors shrink-0"
        aria-label="Toggle menu"
      >
        <Menu size={20} />
      </button>

      {/* Page title */}
      <h1 className="font-inter font-bold text-white text-base flex-1 truncate">{title}</h1>

      {/* Global Search */}
      <div ref={searchRef} className="relative flex items-center gap-1">
        <AnimatePresence>
          {searchOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 220, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 z-10" />
                <input
                  autoFocus
                  value={searchQ}
                  onChange={e => handleSearch(e.target.value)}
                  className="input-field pl-8 py-2 text-sm h-9 pr-3"
                  placeholder="ছাত্র খুঁজুন…"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => { if (searchOpen) { closeSearch(); } else { setSearchOpen(true); } }}
          className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors shrink-0"
        >
          {searchOpen ? <X size={16} /> : <Search size={16} />}
        </button>

        {/* Search results dropdown */}
        <AnimatePresence>
          {searchOpen && (searchResults.length > 0 || (searchLoading && searchQ.length >= 2)) && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-72 card-glass border border-navy-700/60 rounded-xl overflow-hidden z-50 shadow-2xl"
            >
              {searchLoading ? (
                <div className="px-4 py-3 text-slate-500 text-xs text-center">খুঁজছে…</div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-3 text-slate-500 text-xs text-center">কোনো ফলাফল পাওয়া যায়নি</div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b border-white/5">
                    <p className="text-slate-500 text-[10px] font-semibold tracking-wider">STUDENTS</p>
                  </div>
                  {searchResults.map(s => (
                    <Link
                      key={s.id}
                      to="/admin/students"
                      onClick={closeSearch}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-sky-400/15 flex items-center justify-center shrink-0">
                        {s.photo_url ? (
                          <img src={s.photo_url} alt={s.name} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <span className="text-sky-400 text-xs font-bold">{s.name[0]}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate font-hind">{s.name}</p>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sky-400 text-[10px]">{s.student_id}</span>
                          {s.class_level && <span className="text-slate-500 text-[10px]">{s.class_level}</span>}
                        </div>
                      </div>
                      <Hash size={11} className="text-slate-600 shrink-0" />
                    </Link>
                  ))}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bell */}
      <button className="relative w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors shrink-0">
        <Bell size={16} />
        <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-sky-400 rounded-full" />
      </button>

      {/* Avatar + dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(s => !s)}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
        >
          <Avatar name={name} size="sm" />
          <span className="hidden sm:block text-sm font-medium text-white max-w-[100px] truncate">{name}</span>
        </button>

        <AnimatePresence>
          {showDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-52 card-glass border border-navy-700/60 rounded-xl overflow-hidden z-50 shadow-2xl"
              >
                <div className="px-4 py-3 border-b border-white/5">
                  <p className="text-white text-sm font-medium truncate">{name}</p>
                  <p className="text-slate-500 text-xs truncate">{user?.email}</p>
                </div>
                <Link
                  to="/admin/settings"
                  onClick={() => setShowDropdown(false)}
                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Settings
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
