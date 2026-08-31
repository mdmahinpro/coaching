import { useEffect, useRef, useState } from 'react';

/** Default "realtime" cadence for the public homepage data (ms). */
export const POLL_INTERVAL = 25000;

/**
 * Poll `fetcher` immediately, then every `intervalMs`, and again when the
 * window regains focus. This is the project's "realtime" transport for the
 * public homepage + admission batch dropdowns — it needs no Supabase
 * realtime-publication setup (which is a manual README-noted step).
 *
 * Callers pass a STABLE `useCallback` fetcher that performs the query and
 * setState (or returns data). StrictMode-safe: cleanup clears the interval +
 * focus listener; a `cancelled` flag prevents set-on-unmounted; a `running`
 * ref stops overlapping in-flight ticks when focus + interval collide.
 */
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs = POLL_INTERVAL): T | null {
  const [data, setData] = useState<T | null>(null);
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (running.current) {
        return;
      }
      running.current = true;
      try {
        const next = await fetcher();
        if (!cancelled) {
          setData(next);
        }
      } finally {
        running.current = false;
      }
    };

    run();
    const id = window.setInterval(run, intervalMs);
    const onFocus = () => {
      void run();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetcher, intervalMs]);

  return data;
}