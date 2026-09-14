import { useEffect, useState } from 'react';
import { getInitials } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { seededAvatarUrl } from '@/lib/avatars';
import { isPrivateAvatarRef, privateAvatarStudentId, resolveAvatarUrl } from '@/lib/avatarRetrieval';
import { supabase } from '@/lib/supabase';

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
  /** Authorization for the private-avatar retrieval endpoint. Pass the opaque
   *  portal token for a student, or the Supabase JWT for an admin. If the
   *  `src` is a private avatar object ref, it is resolved to a signed URL. */
  bearer?: string;
  /** Target student UUID, required for ADMIN retrieval of another student's
   *  avatar. Omit for self-owned (student) retrieval. */
  studentId?: string;
}

const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' };

/**
 * Avatar: renders the person's `src` when present; otherwise a stable seeded
 * headshot derived from their id/name (never an empty image). Pass `bearer`
 * (and `studentId` for admin) to resolve a PRIVATE avatar ref to a signed URL.
 */
export function Avatar({
  name,
  size = 'md',
  src,
  seed,
  fallbackToInitials = false,
  gender = null,
  className,
  bearer,
  studentId,
}: Props) {
  const [resolved, setResolved] = useState<string | null | undefined>(undefined);
  const imgClass = cn('rounded-full object-cover shrink-0', sizes[size], className);

  useEffect(() => {
    let active = true;
    setResolved(undefined);
    if (src && isPrivateAvatarRef(src)) {
      void (async () => {
        const token = bearer ?? (await supabase.auth.getSession()).data.session?.access_token ?? '';
        // An explicit bearer without studentId is the student's opaque portal
        // token. When using an admin session discovered here, infer the target
        // UUID from the strictly validated private reference.
        const targetId = studentId ?? (!bearer ? privateAvatarStudentId(src) ?? undefined : undefined);
        const url = await resolveAvatarUrl(src, token, targetId ? { studentId: targetId } : {});
        if (active) {setResolved(url);}
      })();
    } else if (src) {
      setResolved(src);
    }
    return () => {
      active = false;
    };
  }, [src, bearer, studentId]);

  const displaySrc = resolved !== undefined ? resolved : src;

  if (displaySrc) {
    return <img src={displaySrc} alt={name} className={imgClass} loading="lazy" />;
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
