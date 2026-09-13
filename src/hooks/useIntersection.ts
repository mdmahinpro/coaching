import { useEffect, useRef, useState } from 'react';

// Pass a conditional target's mount flag as enabled so a later mount is observed.
// Existing callers keep the same object ref and one-shot visibility behavior.
export function useIntersection(options?: IntersectionObserverInit, enabled = true) {
  const ref = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const { root = null, rootMargin = '0px', threshold = 0.1 } = options ?? {};

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || isVisible) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { root, rootMargin, threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, isVisible, root, rootMargin, threshold]);

  return { ref, isVisible };
}
