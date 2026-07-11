import type Database from 'better-sqlite3';
import { getDb, ParticipantRow } from '../db';

export function publicParticipant(row: ParticipantRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    archived: row.archived === 1,
    createdAt: row.created_at,
  };
}

export type PublicParticipant = ReturnType<typeof publicParticipant>;

/** Lädt einen Teilnehmer, sofern er zum angegebenen Bereich gehört. */
export function findParticipant(
  id: string,
  spaceId: string,
  db: Database.Database = getDb(),
): ParticipantRow | undefined {
  return db.prepare('SELECT * FROM participants WHERE id = ? AND space_id = ?').get(id, spaceId) as
    | ParticipantRow
    | undefined;
}

/** Prüft, ob eine Teilnehmer-ID zum Bereich gehört (nicht archiviert optional). */
export function participantBelongsToSpace(
  id: string,
  spaceId: string,
  db: Database.Database = getDb(),
): boolean {
  return !!findParticipant(id, spaceId, db);
}
