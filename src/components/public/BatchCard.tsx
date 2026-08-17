import { Clock, Users, BookOpen, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

interface Batch {
  id: string;
  name: string;
  subject: string;
  schedule: string;
  capacity: number;
  enrolled: number;
  fee: number;
  teacher?: string;
  is_active?: boolean;
}

interface Props {
  batch: Batch;
  index?: number;
}

export function BatchCard({ batch, index = 0 }: Props) {
  const pct = Math.min(100, Math.round((batch.enrolled / batch.capacity) * 100));
  const available = batch.capacity - batch.enrolled;
  const isFull = available <= 0;
  const isAlmostFull = available > 0 && available <= 5;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.5 }}
      className="group card p-5 hover:border-sky-400/30 hover:shadow-sky-500/10 hover:shadow-xl transition-all duration-300 border-l-2 border-l-sky-500/40 hover:border-l-sky-400 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0 pr-2">
          <h3 className="font-inter font-semibold text-white text-base leading-snug">{batch.name}</h3>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="badge-blue text-xs">{batch.subject}</span>
          </div>
        </div>
        <span className={isFull ? 'badge-red' : isAlmostFull ? 'badge-yellow' : 'badge-green'}>
          {isFull ? 'Full' : `${available} seats`}
        </span>
      </div>

      {/* Details */}
      <div className="space-y-2 text-sm text-slate-400 mb-4 flex-1">
        <div className="flex items-center gap-2">
          <Clock size={13} className="text-slate-500 shrink-0" />
          <span>{batch.schedule}</span>
        </div>
        <div className="flex items-center gap-2">
          <Users size={13} className="text-slate-500 shrink-0" />
          <span>{batch.enrolled}/{batch.capacity} enrolled</span>
        </div>
        {batch.teacher && (
          <div className="flex items-center gap-2">
            <BookOpen size={13} className="text-slate-500 shrink-0" />
            <span className="truncate">{batch.teacher}</span>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-slate-500 mb-1.5">
          <span>Capacity</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ delay: index * 0.08 + 0.3, duration: 0.8, ease: 'easeOut' }}
            className={`h-full rounded-full ${
              isFull ? 'bg-red-400' : isAlmostFull
                ? 'bg-gradient-to-r from-amber-400 to-orange-400'
                : 'bg-gradient-to-r from-sky-500 to-violet-500'
            }`}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <div>
          <span className="font-inter font-black text-white text-lg">৳{batch.fee.toLocaleString()}</span>
          <span className="text-slate-500 text-xs">/month</span>
        </div>
        <Link
          to="/admission"
          className="btn-primary text-xs py-2 px-4 group-hover:shadow-sky-500/30 group-hover:shadow-lg"
        >
          Enroll <ChevronRight size={13} />
        </Link>
      </div>
    </motion.div>
  );
}
