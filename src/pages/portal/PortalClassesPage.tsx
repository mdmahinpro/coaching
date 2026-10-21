import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Youtube, FileText, PlayCircle, ExternalLink, X } from 'lucide-react';
import { fetchResources } from '@/lib/portalApi';

export interface PortalResource {
  id: string;
  kind: 'video' | 'document';
  batch_id: string | null;
  batch_name: string | null;
  title: string;
  caption: string;
  url: string;
  youtube_id: string | null;
  order_index: number;
  created_at: string;
}

export default function PortalClassesPage() {
  const [items, setItems] = useState<PortalResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<PortalResource | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setItems((await fetchResources()) as PortalResource[]);
      } catch {
        // session-expired is handled inside portalApi (forces logout)
      }
      setLoading(false);
    })();
  }, []);

  const videos = useMemo(() => items.filter((i) => i.kind === 'video'), [items]);
  const documents = useMemo(() => items.filter((i) => i.kind === 'document'), [items]);

  // Lock body scroll while the fullscreen player is open
  useEffect(() => {
    if (playing) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [playing]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <h1 className="text-xl font-bold text-white">ক্লাস ও ম্যাটেরিয়ালস</h1>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="animate-spin text-slate-400" size={28} />
        </div>
      ) : videos.length === 0 && documents.length === 0 ? (
        <div className="card p-8 text-center text-slate-500 text-sm">
          এখনো কোনো ক্লাস বা ম্যাটেরিয়াল শেয়ার করা হয়নি।
        </div>
      ) : (
        <>
          {/* ── Live classes — YouTube-style thumbnail grid ── */}
          {videos.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Youtube size={16} className="text-rose-400" /> লাইভ ক্লাস ({videos.length})
              </h2>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {videos.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setPlaying(v)}
                    className="text-left group"
                  >
                    <div className="relative rounded-xl overflow-hidden bg-navy-800 aspect-video">
                      {v.youtube_id ? (
                        <img
                          src={`https://i.ytimg.com/vi/${v.youtube_id}/mqdefault.jpg`}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <PlayCircle size={36} className="text-slate-500" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                      <PlayCircle
                        size={34}
                        className="absolute inset-0 m-auto text-white/90 drop-shadow group-hover:scale-110 transition-transform"
                      />
                    </div>
                    <div className="mt-1.5 min-w-0">
                      <div className="text-[13px] font-medium text-white leading-snug line-clamp-2">
                        {v.title}
                      </div>
                      {v.caption && (
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">{v.caption}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ── Documents ── */}
          {documents.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <FileText size={16} className="text-emerald-400" /> ম্যাটেরিয়ালস ({documents.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {documents.map((d) => (
                  <a
                    key={d.id}
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="card p-4 flex items-center gap-3 hover:border-sky-500/40 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <FileText size={18} className="text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate">{d.title}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {d.caption || d.batch_name || 'সব শিক্ষার্থী'}
                      </div>
                    </div>
                    <ExternalLink size={14} className="text-slate-500 shrink-0" />
                  </a>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ── Fullscreen player overlay (takes the whole window) ── */}
      {playing && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2.5 shrink-0">
            <div className="min-w-0 pr-3">
              <div className="text-sm font-semibold text-white truncate">{playing.title}</div>
              {playing.caption && (
                <div className="text-xs text-slate-400 truncate">{playing.caption}</div>
              )}
            </div>
            <button
              onClick={() => setPlaying(null)}
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0 active:bg-white/20"
              aria-label="বন্ধ করুন"
            >
              <X size={18} className="text-white" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center min-h-0 px-1 pb-1">
            <div className="w-full max-h-full aspect-video max-w-[calc((100dvh-56px)*16/9)]">
              <iframe
                key={playing.id}
                src={`https://www.youtube.com/embed/${playing.youtube_id}?rel=0&autoplay=1`}
                title={playing.title}
                className="w-full h-full rounded-lg"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
          <div className="shrink-0 px-4 pb-2 text-center">
            <a
              href={playing.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
            >
              YouTube-এ দেখুন <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </motion.div>
  );
}
