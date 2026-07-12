import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { api, ApiError, ModuleKey, Participant, Space as SpaceType } from '../api/client';
import { nameStore, tokenStore, visitedSpacesStore, VisitedSpace } from '../lib/storage';
import { useParticipants } from '../lib/useParticipants';

export type SessionPhase = 'loading' | 'gate' | 'ready' | 'notfound';

/**
 * „Wer bist du?" – die für den gesamten Bereich gewählte Identität. Wird
 * zentral hier verwaltet (statt pro Modul einzeln), damit die Abfrage nur
 * einmal pro Bereich und Gerät erscheint – unabhängig davon, welchen Link
 * (welches Modul) man als erstes öffnet.
 */
export interface IdentityValue {
  participants: Participant[];
  current: Participant | null;
  currentId: string | null;
  loading: boolean;
  error: string | null;
  /** Ist in diesem Bereich ein Code (PIN) für Identitäten Pflicht? */
  requirePin: boolean;
  /**
   * Läuft im Hintergrund gerade die automatische Auflösung/Anlage der
   * geräteweiten Identität für diesen Bereich? Solange das der Fall ist,
   * soll keine Zwischenansicht aufblitzen.
   */
  resolving: boolean;
  /** Fehler bei der automatischen Anlage (z. B. Name bereits vergeben). */
  resolveError: string | null;
  clearResolveError: () => void;
  /**
   * Ist in diesem (neuen) Bereich ein Code Pflicht, hat die geräteweite
   * Identität aber noch keinen? Dann muss jetzt aktiv einer vergeben werden
   * (siehe establishPin) – der einzige Fall, in dem trotz bereits bekannter
   * Identität aktiv nachgefragt wird.
   */
  needsPin: boolean;
  select: (id: string, pin?: string) => void;
  create: (name: string, pin?: string) => Promise<Participant>;
  establishPin: (pin: string) => Promise<Participant>;
  verifyPin: (id: string, pin: string) => Promise<boolean>;
  setPin: (id: string, opts: { pin: string | null; currentPin?: string }) => Promise<Participant>;
  switchIdentity: () => void;
}

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
    /** Ist die geräteweite Identität bereits bekannt (Name muss nicht mehr erfragt werden)? */
    hasKnownIdentity: boolean;
  };
  enter: (e?: React.FormEvent) => Promise<void>;
  /** Galerie-„Vollbildmodus": blendet TopBar & Navigation beim Scrollen aus. */
  chromeHidden: boolean;
  setChromeHidden: (v: boolean) => void;
  visitedSpaces: VisitedSpace[];
  /** Entfernt einen Bereich aus der lokalen Liste (Wechsel-Menü) – „verlassen". */
  removeVisitedSpace: (slug: string) => void;
  hasModule: (key: ModuleKey) => boolean;
  identity: IdentityValue;
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

  // „Wer bist du?" – geräteweit für ALLE Bereiche, damit die Auswahl nur
  // einmal pro Gerät nötig ist, unabhängig davon, welcher Bereich oder
  // welches Modul zuerst geöffnet wird (siehe useParticipants).
  const participantState = useParticipants(slug, token, !!space?.requireParticipantPin);

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

        // Ist die geräteweite Identität bereits bekannt und braucht dieser
        // Bereich kein Passwort, kann der Zugang vollständig unsichtbar im
        // Hintergrund erfolgen – ohne jede Rückfrage. Nur wenn ein Passwort
        // nötig ist oder es noch gar keine Identität gibt (allererster
        // geöffneter Link), wird das Betreten-Formular gezeigt.
        const knownName = nameStore.get().trim();
        if (!res.space.hasPassword && knownName) {
          try {
            const accessRes = await api<{ space: SpaceType; accessToken: string }>(
              `/api/spaces/by-slug/${encodeURIComponent(slug)}/access`,
              { method: 'POST', body: { name: knownName } },
            );
            if (cancelled) return;
            tokenStore.set(slug, accessRes.accessToken);
            setSpace(accessRes.space);
            setToken(accessRes.accessToken);
            setPhase('ready');
            return;
          } catch {
            // Bei einem Fehler (z. B. Netzwerk) normal weiter zum Formular.
          }
        }
        if (cancelled) return;
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

  const removeVisitedSpace = useCallback((s: string) => {
    visitedSpacesStore.remove(s);
    setVisitedSpaces(visitedSpacesStore.all());
  }, []);

  const enter = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setGateError('');
      const trimmedName = name.trim();
      if (!trimmedName) {
        setGateError('Bitte deinen Namen eingeben.');
        return;
      }
      setGateBusy(true);
      try {
        const res = await api<{ space: SpaceType; accessToken: string }>(
          `/api/spaces/by-slug/${encodeURIComponent(slug)}/access`,
          { method: 'POST', body: { password: gatePassword || undefined, name: trimmedName } },
        );
        tokenStore.set(slug, res.accessToken);
        // Der Name wird geräteweit gespeichert (siehe identityStore) – ein
        // Code (PIN) wird erst danach erfragt, falls dieser Bereich ihn
        // zwingend verlangt (siehe needsPin in useParticipants).
        nameStore.set(trimmedName);
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

  // Der frei wählbare Anzeigename (für Modul-Aktionen ausserhalb der
  // Teilnehmer-Identität, z. B. ältere Uploads) folgt der gewählten Identität
  // – so gibt es im Dropdown nur noch „Deine Identität" statt zwei getrennter
  // Namensfelder.
  useEffect(() => {
    if (participantState.current && participantState.current.name !== name) {
      setName(participantState.current.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantState.current]);

  const hasModule = useCallback(
    (key: ModuleKey) => (key === 'photos' ? true : !!space?.modules?.includes(key)),
    [space],
  );

  const identity = useMemo<IdentityValue>(
    () => ({
      participants: participantState.participants,
      current: participantState.current,
      currentId: participantState.currentId,
      loading: participantState.loading,
      error: participantState.error,
      requirePin: !!space?.requireParticipantPin,
      resolving: participantState.resolving,
      resolveError: participantState.resolveError,
      clearResolveError: participantState.clearResolveError,
      needsPin: participantState.needsPin,
      select: participantState.select,
      create: participantState.create,
      establishPin: participantState.establishPin,
      verifyPin: participantState.verifyPin,
      setPin: participantState.setPin,
      switchIdentity: participantState.switchIdentity,
    }),
    [
      participantState.participants,
      participantState.current,
      participantState.currentId,
      participantState.loading,
      participantState.error,
      participantState.resolving,
      participantState.resolveError,
      participantState.clearResolveError,
      participantState.needsPin,
      participantState.select,
      participantState.create,
      participantState.establishPin,
      participantState.verifyPin,
      participantState.setPin,
      participantState.switchIdentity,
      space?.requireParticipantPin,
    ],
  );

  const value = useMemo<SpaceSessionValue>(
    () => ({
      slug,
      phase,
      space,
      token,
      name,
      setName,
      gate: {
        password: gatePassword,
        setPassword: setGatePassword,
        error: gateError,
        busy: gateBusy,
        hasKnownIdentity: !!nameStore.get().trim(),
      },
      enter,
      chromeHidden,
      setChromeHidden,
      visitedSpaces,
      removeVisitedSpace,
      hasModule,
      identity,
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
      removeVisitedSpace,
      hasModule,
      identity,
    ],
  );

  return <SpaceSessionContext.Provider value={value}>{children}</SpaceSessionContext.Provider>;
}
