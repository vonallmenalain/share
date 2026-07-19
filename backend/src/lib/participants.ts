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

/**
 * Legt zwei Identitäten DERSELBEN Person endgültig zu EINER zusammen
 * („Duplikat bereinigen"). Anders als die Finanz-Zusammenführung
 * (`merged_into`, nur Ansicht/Berechnung, umkehrbar) werden hier ALLE
 * gespeicherten Verweise der Quell-Identität auf die Ziel-Identität
 * umgeschrieben und die Quelle anschliessend gelöscht – das ist **nicht**
 * umkehrbar.
 *
 * Umgeschrieben werden Finanzdaten (Zahler, Ersteller, Anteile,
 * Ausgleichszahlungen) sowie lose „erstellt/erledigt von"-Verweise in
 * Einkaufsliste, Notizen, Kalender und Abrechnungs-Stapeln. Anteile derselben
 * Ausgabe werden zusammengezählt, sich selbst zahlende Transfers (Ziel → Ziel)
 * entfernt. Bestehende Finanz-Zusammenführungen auf die Quelle werden auf das
 * Ziel umgehängt. Läuft komplett in EINER Transaktion.
 *
 * Voraussetzung: Quelle und Ziel gehören zum selben Bereich und sind
 * verschieden (der Aufrufer stellt das sicher; defensiv wird `source === target`
 * abgewiesen).
 */
export function consolidateParticipants(
  spaceId: string,
  sourceId: string,
  targetId: string,
  db: Database.Database = getDb(),
): void {
  if (sourceId === targetId) {
    throw new Error('Quelle und Ziel dürfen beim Zusammenlegen nicht identisch sein.');
  }
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    // 1. Ausgaben: Zahler:in und Ersteller:in auf die Ziel-Identität umschreiben.
    db.prepare(
      `UPDATE finance_expenses SET paid_by_participant_id = @target, updated_at = @now
       WHERE space_id = @space AND paid_by_participant_id = @source`,
    ).run({ target: targetId, now, space: spaceId, source: sourceId });
    db.prepare(
      `UPDATE finance_expenses SET created_by_participant_id = @target, updated_at = @now
       WHERE space_id = @space AND created_by_participant_id = @source`,
    ).run({ target: targetId, now, space: spaceId, source: sourceId });

    // 2. Anteile (Splits). Der Primärschlüssel ist (expense_id, participant_id) –
    //    ein blindes Umhängen würde bei Ausgaben, in denen BEIDE Identitäten
    //    einen Anteil haben, mit dem bestehenden Ziel-Anteil kollidieren. Daher:
    //    (a) dort die Anteile zusammenzählen, (b) den doppelten Quell-Anteil
    //    löschen, (c) die übrigen Quell-Anteile einfach umhängen.
    db.prepare(
      `UPDATE finance_expense_splits
       SET share_cents = share_cents + (
         SELECT s.share_cents FROM finance_expense_splits AS s
         WHERE s.expense_id = finance_expense_splits.expense_id AND s.participant_id = @source
       )
       WHERE participant_id = @target
         AND expense_id IN (
           SELECT expense_id FROM finance_expense_splits WHERE participant_id = @source
         )`,
    ).run({ source: sourceId, target: targetId });
    db.prepare(
      `DELETE FROM finance_expense_splits
       WHERE participant_id = @source
         AND expense_id IN (
           SELECT expense_id FROM finance_expense_splits WHERE participant_id = @target
         )`,
    ).run({ source: sourceId, target: targetId });
    db.prepare(
      `UPDATE finance_expense_splits SET participant_id = @target WHERE participant_id = @source`,
    ).run({ source: sourceId, target: targetId });

    // 3. Ausgleichszahlungen: from/to umschreiben. Dabei entstehende
    //    Selbst-Transfers (Ziel → Ziel) sind bedeutungslos und werden entfernt.
    db.prepare(
      `UPDATE finance_settlement_transfers SET from_participant_id = @target
       WHERE from_participant_id = @source`,
    ).run({ source: sourceId, target: targetId });
    db.prepare(
      `UPDATE finance_settlement_transfers SET to_participant_id = @target
       WHERE to_participant_id = @source`,
    ).run({ source: sourceId, target: targetId });
    db.prepare(
      `DELETE FROM finance_settlement_transfers
       WHERE from_participant_id = @target AND to_participant_id = @target`,
    ).run({ target: targetId });

    // 4. Lose Verweise ohne Fremdschlüssel („erstellt/erledigt von").
    const looseRefs: Array<[table: string, col: string]> = [
      ['shopping_items', 'checked_by_participant_id'],
      ['shopping_items', 'created_by_participant_id'],
      ['notes', 'created_by_participant_id'],
      ['calendar_events', 'created_by_participant_id'],
      ['finance_settlement_batches', 'created_by_participant_id'],
    ];
    for (const [table, col] of looseRefs) {
      db.prepare(
        `UPDATE ${table} SET ${col} = @target WHERE space_id = @space AND ${col} = @source`,
      ).run({ target: targetId, space: spaceId, source: sourceId });
    }

    // 5. Bestehende Finanz-Zusammenführungen (merged_into) bereinigen:
    //    Identitäten, die auf die Quelle zeigten, auf das Ziel umhängen; zeigte
    //    das Ziel selbst auf die Quelle, den Zeiger lösen (sie sind jetzt
    //    dieselbe Identität) – sonst würde er nach dem Löschen ins Leere zeigen.
    db.prepare(
      `UPDATE participants SET merged_into = @target, updated_at = @now
       WHERE space_id = @space AND merged_into = @source AND id <> @target`,
    ).run({ target: targetId, now, space: spaceId, source: sourceId });
    db.prepare(
      `UPDATE participants SET merged_into = NULL, updated_at = @now
       WHERE id = @target AND merged_into = @source`,
    ).run({ now, target: targetId, source: sourceId });

    // 6. Quelle löschen – jetzt zeigt kein Datensatz mehr auf sie – und das
    //    Ziel als „berührt" markieren.
    db.prepare('DELETE FROM participants WHERE id = @source AND space_id = @space').run({
      source: sourceId,
      space: spaceId,
    });
    db.prepare('UPDATE participants SET updated_at = @now WHERE id = @target').run({
      now,
      target: targetId,
    });
  });
  run();
}
