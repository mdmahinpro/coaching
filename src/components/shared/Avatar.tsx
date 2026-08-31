import { getInitials } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { seededAvatarUrl } from '@/lib/avatars';

interface Props {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  src?: string;
  /** Deterministic identity so a person without an explicit src keeps a stable
   *  seeded headshot (never an empty initials monogram). Falls back to `name`. */
  seed?: string;
  /** Pass null to force the initials monogram instead of a seeded headshot. */
  fallbackToInitials?: boolean;
  gender?: 'male' | 'female' | null;
  className?: string;
}

const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' };

/**
 * Avatar: renders the person's `src` when present; otherwise a stable seeded
 * headshot derived from their id/name (never an empty image). Pass
 * `fallbackToInitials` for cases that should keep the monogram (e.g. canned
 * testimonials that aren't real people).
 */
export function Avatar({
  name,
  size = 'md',
  src,
  seed,
  fallbackToInitials = false,
  gender = null,
  className,
}: Props) {
  const imgClass = cn('rounded-full object-cover shrink-0', sizes[size], className);
  if (src) {
    return <img src={src} alt={name} className={imgClass} />;
  }
  if (!fallbackToInitials) {
    return (
      <img
        src={seededAvatarUrl(seed ?? name, gender)}
        alt={name}
        className={imgClass}
        loading="lazy"
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
