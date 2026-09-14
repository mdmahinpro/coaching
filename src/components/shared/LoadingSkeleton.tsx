import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  rows?: number;
}

export function LoadingSkeleton({ className, rows = 3 }: Props) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading content" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 rounded-lg bg-navy-700 animate-pulse"
          style={{ opacity: 1 - i * 0.2 }}
        />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card p-5 space-y-3 animate-pulse" role="status" aria-label="Loading card" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="h-4 w-1/3 rounded bg-navy-700" />
      <div className="h-8 w-1/2 rounded bg-navy-700" />
      <div className="h-3 w-2/3 rounded bg-navy-700" />
    </div>
  );
}
