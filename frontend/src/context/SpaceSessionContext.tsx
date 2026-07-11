import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { api, ApiError, ModuleKey, Space as SpaceType } from '../api/client';
import { nameStore, tokenStore, visitedSpacesStore, VisitedSpace } from '../lib/storage';

export type SessionPhase = 'loading' | 'gate' | 'ready' | 'notfound';

export interface SpaceSessionValue {
  slug: string;
  phase: SessionPhase;
  space: SpaceType | null;
  token: string;
  name: string;
  setName: (n: string) => void;
  gate: {
    password: string;
    setPassword: (p: string) => void;
    error: string;
    busy: boolean;
  };
  enter: (e?: React.FormEvent) => Promise<void>;
  /** Galerie-„Vollbildmodus": blendet TopBar & Navigation beim Scrollen aus. */
  chromeHidden: boolean;
  setChromeHidden: (v: boolean) => void;
  visitedSpaces: VisitedSpace[];
  hasModule: (key: ModuleKey) => boolean;
}

const SpaceSessionContext = createContext<SpaceSessionValue | null>(null);

export function useSpaceSessionContext(): SpaceSessionValue {
  const ctx = useContext(SpaceSessionContext);
  if (!ctx) throw new Error('useSpaceSessionContext must be used within SpaceSessionProvider');
  return ctx;
}

/**
 * Stellt Zugang und Session eines Bereichs bereit – zentral für alle Module,
 * damit beim Wechsel zwischen Modulen keine doppelten API-Abfragen oder
 * doppelten Zugriffs-Log-Einträge entstehen. Die Logik entspricht dem früheren
 * Verhalten in Space.tsx/useSpaceSession.ts (Token laden/prüfen, sonst
 * Betreten-Formular), ergänzt um die aktivierten Module des Bereichs.
 */
export function SpaceSessionProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [phase, setPhase] = useState<SessionPhase>('loading');
  const [space, setSpace] = useState<SpaceType | null>(null);
  const [token, setToken] = useState('');
  const [name, setNameState] = useState(nameStore.get());
  const [visitedSpaces, setVisitedSpaces] = useState<VisitedSpace[]>(() => visitedSpacesStore.all());

  const [gatePassword, setGatePassword] = useState('');
  const [gateError, setGateError] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);

  const setName = useCallback((n: string) => {
    setNameState(n);
    if (n.trim()) nameStore.set(n.trim());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase('loading');
      setChromeHidden(false);
      const stored = tokenStore.get(slug);
      if (stored) {
        try {
          // Öffnen des Bereichs protokollieren (genau einmal pro Session).
          const res = await api<{ space: SpaceType }>('/api/spaces/current', {
            token: stored,
            uploaderName: nameStore.get() || undefined,
          });
          if (cancelled) return;
          setSpace(res.space);
          setToken(stored);
          setPhase('ready');
          return;
        } catch {
          tokenStore.clear(slug);
        }
      }
      try {
        const res = await api<{ space: SpaceType }>(
          `/api/spaces/by-slug/${encodeURIComponent(slug)}`,
        );
        if (cancelled) return;
        setSpace(res.space);
        setPhase('gate');
      } catch (err) {
        if (cancelled) return;
        setPhase(err instanceof ApiError && err.status === 404 ? 'notfound' : 'gate');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Diesen (per Link geöffneten) Bereich lokal merken.
  useEffect(() => {
    if (slug && space) {
      visitedSpacesStore.record(slug, space.name);
      setVisitedSpaces(visitedSpacesStore.all());
    }
  }, [slug, space]);

  const enter = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setGateError('');
      setGateBusy(true);
      try {
        const res = await api<{ space: SpaceType; accessToken: string }>(
          `/api/spaces/by-slug/${encodeURIComponent(slug)}/access`,
          { method: 'POST', body: { password: gatePassword || undefined, name: name.trim() || undefined } },
        );
        tokenStore.set(slug, res.accessToken);
        if (name.trim()) nameStore.set(name.trim());
        setSpace(res.space);
        setToken(res.accessToken);
        setPhase('ready');
      } catch (err) {
        setGateError(err instanceof Error ? err.message : 'Zugang fehlgeschlagen.');
      } finally {
        setGateBusy(false);
      }
    },
    [slug, gatePassword, name],
  );

  const hasModule = useCallback(
    (key: ModuleKey) => (key === 'photos' ? true : !!space?.modules?.includes(key)),
    [space],
  );

  const value = useMemo<SpaceSessionValue>(
    () => ({
      slug,
      phase,
      space,
      token,
      name,
      setName,
      gate: { password: gatePassword, setPassword: setGatePassword, error: gateError, busy: gateBusy },
      enter,
      chromeHidden,
      setChromeHidden,
      visitedSpaces,
      hasModule,
    }),
    [
      slug,
      phase,
      space,
      token,
      name,
      setName,
      gatePassword,
      gateError,
      gateBusy,
      enter,
      chromeHidden,
      visitedSpaces,
      hasModule,
    ],
  );

  return <SpaceSessionContext.Provider value={value}>{children}</SpaceSessionContext.Provider>;
}
