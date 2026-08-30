import { useSettingsStore } from '@/store/useSettingsStore';
import { cn } from '@/lib/utils';

/** Default in-app mark (Concept B) — matches the shipped favicon.svg. */
export const DEFAULT_LOGO = '/techely-mark.svg';

/**
 * Site logo resolved from settings (fallback: the default mark). Every brand
 * surface should render this so a configured logoUrl is used consistently —
 * and the dynamic favicon (set in useSettingsStore) follows the same value,
 * keeping logo and favicon identical.
 */
export function Logo({
  className,
  alt = 'Techely',
  draggable = false,
}: {
  className?: string;
  alt?: string;
  draggable?: boolean;
}) {
  const { settings } = useSettingsStore();
  return (
    <img
      src={settings.logoUrl || DEFAULT_LOGO}
      alt={alt}
      className={cn('shrink-0', className)}
      draggable={draggable}
    />
  );
}
