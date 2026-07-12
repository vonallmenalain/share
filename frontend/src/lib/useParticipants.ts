import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, Participant } from '../api/client';
import { identityStore, participantStore } from './storage';

/**
 * Verwaltet die Teilnehmer eines Bereichs UND die geräteweite Identität
 * („Wer bist du?"). Die Identität (Name + optionaler Code) wird EINMAL pro
 * Gerät/Browser gespeichert (siehe identityStore) und automatisch für jeden
 * Bereich verwendet – im Hintergrund, ohne dass beim Wechseln zwischen
 * Bereichen erneut nachgefragt wird. Aktiv nachgefragt wird nur,
 *  - wenn überhaupt noch keine Identität existiert (allererster geöffneter
 *    Link), oder
 *  - wenn ein Code (PIN) in einem NEUEN Bereich Pflicht ist, aber die
 *    geräteweite Identität noch keinen hat.
 *
 * Das ist bewusst KEIN echtes Login: Jede:r mit dem Bereichs-Link kann sich
 * grundsätzlich als jede Person auswählen. Wer sich davor schützen möchte,
 * dass andere in ihrem/seinem Namen etwas erfassen, kann der eigenen
 * Identität optional einen Code (PIN) geben (siehe verifyPin/setPin) – dann
 * ist die Auswahl dieser Person nur mit dem richtigen Code möglich.
 */
export function useParticipants(slug: string, token: string, requirePin: boolean) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => participantStore.get(slug));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Läuft im Hintergrund gerade die automatische Auflösung/Anlage der
  // geräteweiten Identität für diesen Bereich? Solange das der Fall ist,
  // soll keine Zwischenansicht („Wer bist du?") aufblitzen.
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  // Ist in diesem (neuen) Bereich ein Code Pflicht, aber die geräteweite
  // Identität hat noch keinen? Dann muss jetzt aktiv einer vergeben werden.
  const [needsPin, setNeedsPin] = useState(false);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api<{ participants: Participant[] }>('/api/participants', { token });
      setParticipants(res.participants);
      // Gespeicherte Auswahl verwerfen, wenn der Teilnehmer nicht mehr existiert.
      setCurrentId((prev) => {
        if (prev && !res.participants.some((p) => p.id === prev && !p.archived)) {
          participantStore.clear(slug);
          return null;
        }
        return prev;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teilnehmer konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const select = useCallback(
    (id: string, pin?: string) => {
      participantStore.set(slug, id);
      setCurrentId(id);
      setNeedsPin(false);
      const p = participants.find((x) => x.id === id);
      if (p) {
        identityStore.setName(p.name);
        if (pin !== undefined) identityStore.setPin(pin || null);
      }
    },
    [slug, participants],
  );

  const create = useCallback(
    async (name: string, pin?: string): Promise<Participant> => {
      const res = await api<{ participant: Participant }>('/api/participants', {
        method: 'POST',
        token,
        body: { name, pin: pin || undefined },
      });
      await reload();
      participantStore.set(slug, res.participant.id);
      setCurrentId(res.participant.id);
      identityStore.set(name, pin || null);
      setNeedsPin(false);
      return res.participant;
    },
    [token, reload, slug],
  );

  /**
   * Prüft den Code einer Identität, ohne sie schon auszuwählen. Hat die
   * Person keinen Code hinterlegt, gelingt das immer (gibt `true` zurück).
   */
  const verifyPin = useCallback(
    async (id: string, pin: string): Promise<boolean> => {
      try {
        await api<{ ok: true }>(`/api/participants/${id}/verify-pin`, {
          method: 'POST',
          token,
          body: { pin },
        });
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return false;
        throw err;
      }
    },
    [token],
  );

  /**
   * Eigenen Code setzen/ändern/entfernen. Ist bereits einer hinterlegt, muss
   * der aktuelle Code mitgegeben werden. Aktualisiert die lokale Liste, damit
   * `hasPin` sofort stimmt, sowie – ist die aktuelle Person betroffen – die
   * geräteweite Identität, damit künftige Bereiche denselben Code verwenden.
   */
  const setPin = useCallback(
    async (id: string, opts: { pin: string | null; currentPin?: string }): Promise<Participant> => {
      const res = await api<{ participant: Participant }>(`/api/participants/${id}/pin`, {
        method: 'PATCH',
        token,
        participantId: id,
        body: { pin: opts.pin || undefined, currentPin: opts.currentPin || undefined },
      });
      setParticipants((prev) => prev.map((p) => (p.id === id ? res.participant : p)));
      if (id === currentId) identityStore.setPin(opts.pin || null);
      return res.participant;
    },
    [token, currentId],
  );

  /**
   * Legt die geräteweite Identität in diesem Bereich mit dem angegebenen
   * Code neu an – für den Fall, dass ein Code hier Pflicht ist, die
   * Identität aber noch keinen hat (siehe `needsPin`).
   */
  const establishPin = useCallback(
    async (pin: string): Promise<Participant> => {
      const name = identityStore.get()?.name?.trim();
      if (!name) throw new Error('Keine Identität vorhanden.');
      return create(name, pin);
    },
    [create],
  );

  /**
   * Identität wechseln – geräteweit, damit auf JEDEM Bereich wieder
   * „Wer bist du?" gefragt wird (nicht nur im aktuellen).
   */
  const switchIdentity = useCallback(() => {
    participantStore.clearAll();
    identityStore.clear();
    setCurrentId(null);
    setNeedsPin(false);
  }, []);

  const clearResolveError = useCallback(() => setResolveError(null), []);

  // ---- Automatische, geräteweite Identität ---------------------------------
  // Sobald die Teilnehmerliste geladen ist und (noch) keine gültige Auswahl
  // für diesen Bereich besteht, wird versucht, die geräteweit gespeicherte
  // Identität automatisch anzuwenden – vollständig im Hintergrund, ohne jede
  // Rückfrage. Das deckt den Normalfall ab: neuer Bereich, bereits bekannte
  // Identität. Gelingt das nicht eindeutig (z. B. ist der Name hier bereits
  // mit einem ANDEREN Code geschützt) oder existiert noch gar keine
  // Identität, bleibt die gewohnte Auswahl („Wer bist du?") als Rückfall.
  const resolvedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!token || loading) return;
    if (currentId && participants.some((p) => p.id === currentId && !p.archived)) return;
    const identity = identityStore.get();
    if (!identity?.name) return; // noch keine Identität -> Aufrufer zeigt Erfassung

    const resolveKey = `${slug}:${identity.name.toLowerCase()}:${identity.pin ?? ''}`;
    if (resolvedForRef.current === resolveKey) return; // bereits erfolglos versucht
    resolvedForRef.current = resolveKey;

    let cancelled = false;
    (async () => {
      setResolving(true);
      setResolveError(null);
      try {
        const match = participants.find(
          (p) => !p.archived && p.name.toLowerCase() === identity.name.toLowerCase(),
        );
        if (match) {
          if (!match.hasPin) {
            if (!cancelled) select(match.id);
            return;
          }
          if (identity.pin) {
            const ok = await verifyPin(match.id, identity.pin);
            if (cancelled) return;
            if (ok) {
              select(match.id, identity.pin);
              return;
            }
          }
          // Code stimmt nicht (oder ist unbekannt) -> Rückfall auf die
          // manuelle Auswahl, dort kann der richtige Code eingegeben oder
          // ein anderer Name gewählt werden.
          return;
        }
        if (requirePin && !identity.pin) {
          if (!cancelled) setNeedsPin(true);
          return;
        }
        await create(identity.name, identity.pin || undefined);
      } catch (err) {
        if (!cancelled) {
          setResolveError(
            err instanceof Error ? err.message : 'Identität konnte nicht angelegt werden.',
          );
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loading, participants, currentId, requirePin, slug]);

  const current = participants.find((p) => p.id === currentId) ?? null;

  return {
    participants,
    current,
    currentId,
    loading,
    error,
    resolving,
    resolveError,
    clearResolveError,
    needsPin,
    reload,
    select,
    switchIdentity,
    create,
    establishPin,
    verifyPin,
    setPin,
  };
}

export function participantName(participants: Participant[], id: string | null | undefined): string {
  if (!id) return 'Unbekannt';
  return participants.find((p) => p.id === id)?.name ?? 'Unbekannt';
}
