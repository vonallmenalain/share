import { useCallback, useEffect, useState } from 'react';
import { api, Participant } from '../api/client';
import { participantStore } from './storage';

/**
 * Verwaltet die Teilnehmer eines Bereichs und die lokal gewählte Identität
 * („Wer bist du?"). Die Auswahl wird pro Bereich im localStorage gespeichert.
 * Bewusstes Vertrauensmodell für Familie & Freunde – keine echte Auth.
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

  const create = useCallback(
    async (name: string): Promise<Participant> => {
      const res = await api<{ participant: Participant }>('/api/participants', {
        method: 'POST',
        token,
        body: { name },
      });
      await reload();
      select(res.participant.id);
      return res.participant;
    },
    [token, reload, select],
  );

  const current = participants.find((p) => p.id === currentId) ?? null;

  return { participants, current, currentId, loading, error, reload, select, create };
}

export function participantName(participants: Participant[], id: string | null | undefined): string {
  if (!id) return 'Unbekannt';
  return participants.find((p) => p.id === id)?.name ?? 'Unbekannt';
}
