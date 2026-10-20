import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { Loader2, Plus, Trash2, Youtube, FileText, Eye, EyeOff, PlayCircle } from 'lucide-react';
import { handleSupabaseError } from '@/utils/errorHandler';

interface Batch {
  id: string;
  name: string;
}

interface Resource {
  id: string;
  kind: 'video' | 'document';
  batch_id: string | null;
  title: string;
  caption: string;
  url: string;
  order_index: number;
  is_published: boolean;
}

/** Extract the YouTube video id from any common YouTube URL shape. */
export function extractYouTubeId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1).split('/')[0] || null;
    }
    if (url.searchParams.get('v')) {
      return url.searchParams.get('v');
    }
    // /shorts/<id>, /embed/<id>, /live/<id>
    const m = url.pathname.match(/\/(shorts|embed|live)\/([^/?]+)/);
    if (m) return m[2];
    return null;
  } catch {
    return null;
  }
}

const emptyForm = {
  kind: 'video' as 'video' | 'document',
  batchId: 'all',
  title: '',
  caption: '',
  url: '',
};

export default function ClassesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [kindTab, setKindTab] = useState<'video' | 'document'>('video');
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    const [r, b] = await Promise.all([
      supabase
        .from('class_resources')
        .select('*')
        .order('kind')
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: false }),
      supabase.from('batches').select('id,name').order('name'),
    ]);
    if (r.error) handleSupabaseError(r.error);
    if (b.error) handleSupabaseError(b.error);
    setResources((r.data ?? []) as Resource[]);
    setBatches((b.data ?? []) as Batch[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const list = useMemo(() => resources.filter((r) => r.kind === kindTab), [resources, kindTab]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.url.trim()) {
      toast.error('Title and link are required');
      return;
    }
    if (form.kind === 'video' && !extractYouTubeId(form.url.trim())) {
      toast.error('Not a recognisable YouTube link');
      return;
    }
    setSaving(true);
    const maxOrder = list.reduce((m, r) => Math.max(m, r.order_index ?? 0), 0);
    const { error } = await supabase.from('class_resources').insert({
      kind: form.kind,
      batch_id: form.batchId === 'all' ? null : form.batchId,
      title: form.title.trim(),
      caption: form.caption.trim(),
      url: form.url.trim(),
      youtube_id: form.kind === 'video' ? extractYouTubeId(form.url.trim()) : null,
      order_index: maxOrder + 1,
      is_published: true,
    });
    setSaving(false);
    if (error) {
      handleSupabaseError(error);
      return;
    }
    toast.success(form.kind === 'video' ? 'Class added' : 'Document added');
    setForm({ ...emptyForm, kind: form.kind });
    load();
  };

  const togglePublish = async (r: Resource) => {
    const { error } = await supabase
      .from('class_resources')
      .update({ is_published: !r.is_published })
      .eq('id', r.id);
    if (error) {
      handleSupabaseError(error);
      return;
    }
    load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('class_resources').delete().eq('id', id);
    if (error) {
      handleSupabaseError(error);
      return;
    }
    toast.success('Removed');
    load();
  };

  const batchName = (id: string | null) =>
    id ? (batches.find((b) => b.id === id)?.name ?? 'Unknown batch') : 'All students';

  return (
    <AdminLayout title="ক্লাস ও ম্যাটেরিয়ালস (Classes & Materials)">
      <div className="max-w-5xl space-y-5">
        {/* Add form */}
        <form onSubmit={handleAdd} className="card p-5 space-y-3">
          <h3 className="font-inter font-semibold text-white">Add new</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Type</label>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as 'video' | 'document' })}
                className="input-field"
              >
                <option value="video">Live class (YouTube)</option>
                <option value="document">Document (Drive link)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Batch</label>
              <select
                value={form.batchId}
                onChange={(e) => setForm({ ...form, batchId: e.target.value })}
                className="input-field"
              >
                <option value="all">All students</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 mb-1.5 block">
                {form.kind === 'video' ? 'YouTube link' : 'Google Drive link'}
              </label>
              <input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder={
                  form.kind === 'video'
                    ? 'https://www.youtube.com/watch?v=… or youtu.be/…'
                    : 'https://drive.google.com/…'
                }
                className="input-field"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Class 1 — Algebra basics"
                className="input-field"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 mb-1.5 block">Caption (optional)</label>
              <input
                value={form.caption}
                onChange={(e) => setForm({ ...form, caption: e.target.value })}
                placeholder="Watch before Saturday's quiz"
                className="input-field"
              />
            </div>
          </div>
          <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Add {form.kind === 'video' ? 'class' : 'document'}
          </button>
        </form>

        {/* Tabs + list */}
        <div className="flex gap-2">
          {([['video', 'Live Classes', Youtube], ['document', 'Materials', FileText]] as const).map(
            ([k, label, Icon]) => (
              <button
                key={k}
                onClick={() => setKindTab(k)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                  kindTab === k ? 'bg-sky-500/15 text-sky-300 border border-sky-500/40' : 'text-slate-400 border border-transparent hover:text-slate-200'
                }`}
              >
                <Icon size={15} /> {label}
              </button>
            )
          )}
        </div>

        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="animate-spin text-slate-400" />
            </div>
          ) : list.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Nothing here yet. Add your first {kindTab === 'video' ? 'class' : 'document'} above.
            </div>
          ) : (
            <div className="divide-y divide-navy-700/40">
              {list.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-4">
                  <div className="w-10 h-10 rounded-lg bg-navy-800 flex items-center justify-center shrink-0">
                    {r.kind === 'video' ? (
                      <PlayCircle size={18} className="text-rose-400" />
                    ) : (
                      <FileText size={18} className="text-emerald-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{r.title}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {batchName(r.batch_id)}
                      {r.caption ? ` · ${r.caption}` : ''}
                    </div>
                  </div>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap"
                  >
                    Open
                  </a>
                  <button
                    onClick={() => togglePublish(r)}
                    className="p-2 text-slate-500 hover:text-amber-300 transition-colors"
                    title={r.is_published ? 'Hide from students' : 'Show to students'}
                  >
                    {r.is_published ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="p-2 text-slate-500 hover:text-rose-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
