import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { Loader2, Plus, Trash2, TrendingDown, Wallet, CalendarDays } from 'lucide-react';
import { handleSupabaseError } from '@/utils/errorHandler';

interface Expense {
  id: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
}

const CATEGORIES = [
  'rent',
  'salary',
  'utilities',
  'supplies',
  'marketing',
  'other',
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent',
  salary: 'Salary',
  utilities: 'Utilities',
  supplies: 'Supplies',
  marketing: 'Marketing',
  other: 'Other',
};

const fmt = (n: number) => `৳${n.toLocaleString('en-US')}`;

export default function ExpensesPage() {
  const [rows, setRows] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [monthFilter, setMonthFilter] = useState(() => new Date().toISOString().slice(0, 7));

  // form
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>('other');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');

  const { user } = useAuthStore();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) handleSupabaseError(error);
    setRows((data ?? []) as Expense[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const monthRows = useMemo(
    () => rows.filter((r) => (r.expense_date || '').startsWith(monthFilter)),
    [rows, monthFilter]
  );

  const monthTotal = useMemo(
    () => monthRows.reduce((s, r) => s + Number(r.amount || 0), 0),
    [monthRows]
  );

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of monthRows) {
      m.set(r.category, (m.get(r.category) ?? 0) + Number(r.amount || 0));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthRows]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!date || !amt || amt <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('expenses').insert({
      expense_date: date,
      category,
      description: description.trim(),
      amount: amt,
      created_by: user?.email ?? null,
    });
    setSaving(false);
    if (error) {
      handleSupabaseError(error);
      return;
    }
    toast.success('Expense added');
    setDescription('');
    setAmount('');
    load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) {
      handleSupabaseError(error);
      return;
    }
    toast.success('Expense removed');
    load();
  };

  return (
    <AdminLayout title="খরচ (Expenses)">
      <div className="max-w-5xl space-y-5">
        {/* Add form */}
        <form onSubmit={handleAdd} className="card p-5 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400 mb-1.5 block">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="October house rent…"
              className="input-field"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-slate-400 mb-1.5 block">Amount (৳)</label>
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="input-field"
              />
            </div>
            <button type="submit" disabled={saving} className="btn-primary h-[42px] px-3 self-end">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            </button>
          </div>
        </form>

        {/* Month summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <CalendarDays size={14} /> Month
            </div>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="input-field mt-1"
            />
          </div>
          <div className="card p-5">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <TrendingDown size={14} /> Total spent (month)
            </div>
            <div className="text-2xl font-bold text-rose-400">{fmt(monthTotal)}</div>
          </div>
          <div className="card p-5">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Wallet size={14} /> By category
            </div>
            {byCategory.length === 0 ? (
              <div className="text-sm text-slate-500 mt-2">No expenses this month</div>
            ) : (
              <div className="space-y-1 mt-1">
                {byCategory.map(([c, v]) => (
                  <div key={c} className="flex justify-between text-sm">
                    <span className="text-slate-300">{CATEGORY_LABELS[c] ?? c}</span>
                    <span className="text-slate-400">{fmt(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* List */}
        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="animate-spin text-slate-400" />
            </div>
          ) : monthRows.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">No expenses recorded for this month.</div>
          ) : (
            <div className="divide-y divide-navy-700/40">
              {monthRows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">
                      {r.description || CATEGORY_LABELS[r.category] || r.category}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.expense_date} · {CATEGORY_LABELS[r.category] ?? r.category}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-rose-400 whitespace-nowrap">
                    {fmt(Number(r.amount))}
                  </div>
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
