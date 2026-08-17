import { getInitials } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface Props {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  src?: string;
  className?: string;
}

const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' };

export function Avatar({ name, size = 'md', src, className }: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('rounded-full object-cover', sizes[size], className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold shrink-0',
        'bg-gradient-to-br from-sky-500 to-violet-500 text-white',
        sizes[size],
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
}
