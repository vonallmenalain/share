import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, Participant } from '../api/client';
import { participantStore } from './storage';

/**
 * Verwaltet die Teilnehmer eines Bereichs und die lokal gewählte Identität
 * („Wer bist du?"). Die Auswahl wird pro Bereich im localStorage gespeichert.
 *
 * Das ist bewusst KEIN echtes Login: Jede:r mit dem Bereichs-Link kann sich
 * grundsätzlich als jede Person auswählen. Wer sich davor schützen möchte,
 * dass andere in ihrem/seinem Namen etwas erfassen, kann der eigenen
 * Identität optional einen Code (PIN) geben (siehe verifyPin/setPin) – dann
 * ist die Auswahl dieser Person nur mit dem richtigen Code möglich.
 */
export function useParticipants(slug: string, token: string) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => participantStore.get(slug));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    (id: string) => {
      participantStore.set(slug, id);
      setCurrentId(id);
    },
    [slug],
  );

  /** Aktuelle Auswahl aufheben, damit wieder „Wer bist du?" gefragt wird. */
  const switchIdentity = useCallback(() => {
    participantStore.clear(slug);
    setCurrentId(null);
  }, [slug]);

  const create = useCallback(
    async (name: string, pin?: string): Promise<Participant> => {
      const res = await api<{ participant: Participant }>('/api/participants', {
        method: 'POST',
        token,
        body: { name, pin: pin || undefined },
      });
      await reload();
      select(res.participant.id);
      return res.participant;
    },
    [token, reload, select],
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
   * `hasPin` sofort stimmt.
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
      return res.participant;
    },
    [token],
  );

  const current = participants.find((p) => p.id === currentId) ?? null;

  return {
    participants,
    current,
    currentId,
    loading,
    error,
    reload,
    select,
    switchIdentity,
    create,
    verifyPin,
    setPin,
  };
}

export function participantName(participants: Participant[], id: string | null | undefined): string {
  if (!id) return 'Unbekannt';
  return participants.find((p) => p.id === id)?.name ?? 'Unbekannt';
}
