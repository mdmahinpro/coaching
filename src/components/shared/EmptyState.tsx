import { cn } from '@/lib/utils';
import { Inbox } from 'lucide-react';

interface Props {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title = 'No data found',
  description = 'There is nothing here yet.',
  icon,
  action,
  className,
}: Props) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      <div className="mb-4 text-slate-500">
        {icon ?? <Inbox size={48} strokeWidth={1.2} />}
      </div>
      <p className="text-lg font-semibold text-slate-400 mb-1">{title}</p>
      <p className="text-sm text-slate-500 mb-4">{description}</p>
      {action}
    </div>
  );
}
