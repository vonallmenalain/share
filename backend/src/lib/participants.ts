import type Database from 'better-sqlite3';
import { getDb, ParticipantRow } from '../db';

export function publicParticipant(row: ParticipantRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    archived: row.archived === 1,
    // Ob diese Identität mit einem Code geschützt ist – der Hash selbst wird
    // nie an den Client geschickt.
    hasPin: row.pin_hash != null,
    // Mit welcher „primären" Identität diese Identität im Finanzbereich als
    // eine Person zusammengeführt ist (null = eigenständig).
    mergedInto: row.merged_into,
    createdAt: row.created_at,
  };
}

export type PublicParticipant = ReturnType<typeof publicParticipant>;

/**
 * Baut für einen Bereich eine Abbildung „Teilnehmer-ID → kanonische (Wurzel-)
 * ID". Zusammengeführte Identitäten (merged_into gesetzt) werden auf ihre
 * primäre Identität aufgelöst; die Auflösung folgt der Kette bis zur Wurzel und
 * ist gegen Zyklen abgesichert. Eigenständige Identitäten bilden auf sich
 * selbst ab. Diese Abbildung ist die einzige Stelle, an der die
 * Zusammenführung in Berechnungen wirksam wird – die gespeicherten Finanzdaten
 * bleiben unangetastet, damit ein Auflösen jederzeit möglich ist.
 */
export function loadMergeMap(
  spaceId: string,
  db: Database.Database = getDb(),
): Map<string, string> {
  const rows = db
    .prepare('SELECT id, merged_into FROM participants WHERE space_id = ?')
    .all(spaceId) as Array<{ id: string; merged_into: string | null }>;
  const parent = new Map<string, string | null>();
  for (const r of rows) parent.set(r.id, r.merged_into);

  const resolve = (start: string): string => {
    const seen = new Set<string>();
    let cur = start;
    // Der Kette folgen, solange ein Elternteil existiert UND noch bekannt ist
    // (der Zeiger könnte theoretisch auf eine fremde/gelöschte ID verweisen).
    while (parent.get(cur) && parent.has(parent.get(cur)!) && !seen.has(cur)) {
      seen.add(cur);
      cur = parent.get(cur)!;
    }
    return cur;
  };

  const map = new Map<string, string>();
  for (const r of rows) map.set(r.id, resolve(r.id));
  return map;
}

/** Kanonische (Wurzel-)ID einer Identität gemäss Zusammenführungs-Abbildung. */
export function canonicalId(map: Map<string, string>, id: string): string {
  return map.get(id) ?? id;
}

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
