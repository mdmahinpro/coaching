import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  open: boolean;
  studentName: string;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}

export function SuspendModal({ open, studentName, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!reason.trim()) return;
    setLoading(true);
    await onConfirm(reason.trim());
    setLoading(false);
    setReason('');
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            className="relative card-glass w-full max-w-md z-10 p-6"
          >
            <button onClick={onCancel} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={18} />
            </button>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/20 shrink-0">
                <AlertTriangle size={22} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-inter font-semibold text-white mb-1">Suspend Student</h3>
                <p className="text-slate-400 text-sm">
                  Suspending <span className="text-white font-medium">{studentName}</span> will prevent portal login and stop future fee generation.
                </p>
              </div>
            </div>
            <div className="mb-5">
              <label className="text-xs text-slate-400 mb-1.5 block">Reason for suspension *</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="input-field"
                rows={3}
                placeholder="e.g. Non-payment of fees, disciplinary action…"
              />
              {!reason.trim() && <p className="text-xs text-slate-600 mt-1">Reason is required</p>}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={onCancel} className="btn-outline text-sm">Cancel</button>
              <button
                onClick={handle}
                disabled={!reason.trim() || loading}
                className="btn-danger"
              >
                {loading ? 'Suspending…' : 'Suspend Student'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
