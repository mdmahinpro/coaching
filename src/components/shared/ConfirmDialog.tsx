import { useEffect, useId } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  danger = true,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {return undefined;}
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {onCancel();}
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="relative card-glass p-5 sm:p-6 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain z-10"
          >
            <button
              onClick={onCancel}
              aria-label="Close confirmation dialog"
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white"
            >
              <X size={18} />
            </button>
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg bg-red-500/15 shrink-0">
                <AlertTriangle size={22} className="text-red-400" />
              </div>
              <div>
                <h3 id={titleId} className="font-semibold text-white mb-1 pr-6 break-words">{title}</h3>
                <p id={descriptionId} className="text-sm text-slate-400 break-words">{message}</p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-3 justify-end mt-6">
              <button onClick={onCancel} className="btn-outline text-sm">
                Cancel
              </button>
              <button onClick={onConfirm} className={danger ? 'btn-danger' : 'btn-primary'}>
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
