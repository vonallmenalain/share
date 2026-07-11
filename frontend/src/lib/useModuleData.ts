import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Lädt Moduldaten und hält sie aktuell: erneutes Laden bei window.focus und
 * beim Zurückkehren in den sichtbaren Tab sowie leichtes Polling (nur wenn das
 * Dokument sichtbar ist). Requests werden beim Unmount / erneuten Laden sauber
 * abgebrochen.
 */
export function useModuleData<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  opts: { intervalMs?: number; enabled?: boolean } = {},
) {
  const { intervalMs = 0, enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(
    async (signal: AbortSignal, background = false) => {
      if (!background) setLoading(true);
      try {
        const result = await loadRef.current(signal);
        if (!signal.aborted) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!signal.aborted && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen.');
        }
      } finally {
        if (!signal.aborted && !background) setLoading(false);
      }
    },
    [],
  );

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void run(controller.signal);

    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        const c = new AbortController();
        void run(c.signal, true);
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (intervalMs > 0) {
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') {
          const c = new AbortController();
          void run(c.signal, true);
        }
      }, intervalMs);
    }

    return () => {
      controller.abort();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, reloadKey, ...deps]);

  return { data, loading, error, reload, setData };
}
