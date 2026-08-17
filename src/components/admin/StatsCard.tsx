import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  color?: 'sky' | 'violet' | 'emerald' | 'amber' | 'red';
  index?: number;
}

const colors = {
  sky:     { bg: 'bg-sky-500/15',     icon: 'text-sky-400',     border: 'border-sky-500/20' },
  violet:  { bg: 'bg-violet-500/15',  icon: 'text-violet-400',  border: 'border-violet-500/20' },
  emerald: { bg: 'bg-emerald-500/15', icon: 'text-emerald-400', border: 'border-emerald-500/20' },
  amber:   { bg: 'bg-amber-500/15',   icon: 'text-amber-400',   border: 'border-amber-500/20' },
  red:     { bg: 'bg-red-500/15',     icon: 'text-red-400',     border: 'border-red-500/20' },
};

export function StatsCard({ title, value, subtitle, icon: Icon, trend, color = 'sky', index = 0 }: Props) {
  const c = colors[color];
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className="card p-5"
    >
      <div className="flex items-start justify-between mb-4">
        <div className={cn('p-2.5 rounded-xl border', c.bg, c.border)}>
          <Icon size={22} className={c.icon} />
        </div>
        {trend && (
          <span className={trend.value >= 0 ? 'badge-green' : 'badge-red'}>
            {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
          </span>
        )}
      </div>
      <p className="text-slate-400 text-sm mb-1">{title}</p>
      <p className="font-inter font-black text-3xl text-white">{value}</p>
      {subtitle && <p className="text-slate-500 text-xs mt-1">{subtitle}</p>}
    </motion.div>
  );
}
