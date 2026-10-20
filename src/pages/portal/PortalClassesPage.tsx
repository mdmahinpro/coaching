import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Youtube, FileText, PlayCircle, ExternalLink } from 'lucide-react';
import { useStudentStore } from '@/store/useStudentStore';
import { fetchResources } from '@/lib/portalApi';
import { supabase } from '@/lib/supabase';

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
  const [activeVideo, setActiveVideo] = useState<PortalResource | null>(null);

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

  useEffect(() => {
    if (!activeVideo && videos.length) {
      setActiveVideo(videos[0]);
    }
  }, [videos, activeVideo]);

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
          {/* ── Live classes: player + playlist ── */}
          {videos.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Youtube size={16} className="text-rose-400" /> লাইভ ক্লাস ({videos.length})
              </h2>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                {/* Player */}
                <div className="space-y-3">
                  {activeVideo && (
                    <>
                      <div className="rounded-xl overflow-hidden bg-black aspect-video">
                        <iframe
                          key={activeVideo.id}
                          src={`https://www.youtube.com/embed/${activeVideo.youtube_id}?rel=0`}
                          title={activeVideo.title}
                          className="w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{activeVideo.title}</div>
                        {activeVideo.caption && (
                          <div className="text-xs text-slate-400 mt-0.5">{activeVideo.caption}</div>
                        )}
                        <a
                          href={activeVideo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 mt-1"
                        >
                          YouTube-এ দেখুন <ExternalLink size={11} />
                        </a>
                      </div>
                    </>
                  )}
                </div>

                {/* Playlist — class by class */}
                <div className="card p-2 max-h-[420px] overflow-y-auto">
                  {videos.map((v, idx) => (
                    <button
                      key={v.id}
                      onClick={() => setActiveVideo(v)}
                      className={`w-full text-left flex items-center gap-3 p-3 rounded-lg transition-colors ${
                        activeVideo?.id === v.id
                          ? 'bg-sky-500/15 text-sky-200'
                          : 'hover:bg-navy-800/70 text-slate-300'
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full bg-navy-800 flex items-center justify-center text-xs shrink-0">
                        {idx + 1}
                      </span>
                      {v.youtube_id ? (
                        <img
                          src={`https://i.ytimg.com/vi/${v.youtube_id}/default.jpg`}
                          alt=""
                          className="w-16 h-9 rounded object-cover shrink-0 bg-navy-800"
                        />
                      ) : (
                        <PlayCircle size={30} className="shrink-0 text-slate-500" />
                      )}
                      <span className="min-w-0">
                        <span className="block text-sm truncate">{v.title}</span>
                        {v.caption && (
                          <span className="block text-xs text-slate-500 truncate">{v.caption}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
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
    </motion.div>
  );
}
