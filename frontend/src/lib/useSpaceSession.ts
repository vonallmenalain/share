import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, Space as SpaceType } from '../api/client';
import { nameStore, tokenStore, visitedSpacesStore } from './storage';

export type SessionPhase = 'loading' | 'gate' | 'ready' | 'notfound';

/**
 * Kümmert sich um Zugang und Session eines Bereichs (Space): lädt einen
 * gespeicherten Token, prüft ihn und stellt – falls nötig – ein Formular zum
 * Betreten (Name + optional Passwort) bereit. Wird sowohl von der Galerie-
 * als auch von der eigenständigen Upload-Seite genutzt.
 */
export function useSpaceSession(slug: string) {
  const [phase, setPhase] = useState<SessionPhase>('loading');
  const [space, setSpace] = useState<SpaceType | null>(null);
  const [token, setToken] = useState('');
  const [name, setName] = useState(nameStore.get());

  const [gatePassword, setGatePassword] = useState('');
  const [gateError, setGateError] = useState('');
  const [gateBusy, setGateBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase('loading');
      const stored = tokenStore.get(slug);
      if (stored) {
        try {
          const res = await api<{ space: SpaceType }>('/api/spaces/current', { token: stored });
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

  // Diesen (per Link geöffneten) Bereich lokal merken, damit man später über
  // das Profil-Menü zwischen den selbst besuchten Bereichen wechseln kann.
  useEffect(() => {
    if (slug && space) visitedSpacesStore.record(slug, space.name);
  }, [slug, space]);

  const enter = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setGateError('');
      setGateBusy(true);
      try {
        const res = await api<{ space: SpaceType; accessToken: string }>(
          `/api/spaces/by-slug/${encodeURIComponent(slug)}/access`,
          { method: 'POST', body: { password: gatePassword || undefined } },
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

  return {
    phase,
    space,
    token,
    name,
    setName,
    gate: { password: gatePassword, setPassword: setGatePassword, error: gateError, busy: gateBusy },
    enter,
  };
}
