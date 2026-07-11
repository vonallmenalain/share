import { Router } from 'express';
import { getDb, ItemRow, NoteChecklistItemRow, NoteRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { requireEnabledModule } from '../middleware/module';
import { resolveParticipant } from '../middleware/participant';
import { newId } from '../lib/ids';
import { optionalText, requireString, toBool } from '../lib/validation';
import { publicItem } from './items';

const router = Router();

router.use(requireSpace, requireEnabledModule('notes'), resolveParticipant);

function checklistItemsOf(noteId: string): NoteChecklistItemRow[] {
  return getDb()
    .prepare('SELECT * FROM note_checklist_items WHERE note_id = ? ORDER BY position ASC, created_at ASC')
    .all(noteId) as NoteChecklistItemRow[];
}

function publicChecklistItem(row: NoteChecklistItemRow) {
  return {
    id: row.id,
    text: row.text,
    checked: row.checked === 1,
    position: row.position,
  };
}

/** Aktive (nicht gelöschte) Bildanhänge einer Notiz als Item-DTOs. */
function attachmentsOf(noteId: string, spaceId: string) {
  const rows = getDb()
    .prepare(
      `SELECT i.* FROM note_attachments a
       JOIN items i ON i.id = a.item_id
       WHERE a.note_id = ? AND i.space_id = ? AND i.state = 'active'
       ORDER BY a.position ASC`,
    )
    .all(noteId, spaceId) as ItemRow[];
  return rows.map(publicItem);
}

function publicNote(row: NoteRow, spaceId: string, opts: { full?: boolean } = {}) {
  const checklist = row.note_type === 'checklist' ? checklistItemsOf(row.id) : [];
  const attachments = attachmentsOf(row.id, spaceId);
  const base = {
    id: row.id,
    title: row.title,
    noteType: row.note_type,
    body: row.body,
    pinned: row.pinned === 1,
    createdByParticipantId: row.created_by_participant_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checklistCount: checklist.length,
    checklistCheckedCount: checklist.filter((c) => c.checked).length,
    attachmentCount: attachments.length,
  };
  if (opts.full) {
    return {
      ...base,
      checklist: checklist.map(publicChecklistItem),
      attachments,
    };
  }
  // Übersicht: kleine Vorschau der Anhänge (max. 4) genügt.
  return { ...base, attachments: attachments.slice(0, 4) };
}

function getOwnNote(id: string, spaceId: string): NoteRow {
  const row = getDb()
    .prepare('SELECT * FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL')
    .get(id, spaceId) as NoteRow | undefined;
  if (!row) throw new ApiError(404, 'Notiz nicht gefunden.');
  return row;
}

// ---- Notizen ---------------------------------------------------------------

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const rows = getDb()
      .prepare(
        `SELECT * FROM notes WHERE space_id = ? AND deleted_at IS NULL
         ORDER BY pinned DESC, updated_at DESC`,
      )
      .all(spaceId) as NoteRow[];
    res.json({ notes: rows.map((r) => publicNote(r, spaceId)) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    // Titel darf leer bleiben – ein leerer Titel wird nur in Übersichten als
    // "Ohne Titel" angezeigt, aber NICHT als echter Wert gespeichert. So
    // startet eine neue Notiz mit einem leeren Feld (Platzhalter), statt mit
    // Text, den man erst wieder löschen müsste.
    const title = requireString(req.body?.title, 'Titel', { max: 200, min: 0 });
    const noteType = req.body?.noteType === 'checklist' ? 'checklist' : 'text';
    const body = optionalText(req.body?.body, 20000);
    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO notes (id, space_id, title, note_type, body, pinned, created_by_participant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(id, spaceId, title, noteType, body, req.participantId ?? null, now, now);
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow;
    res.status(201).json({ note: publicNote(row, spaceId, { full: true }) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = getOwnNote(req.params.id, req.spaceId!);
    res.json({ note: publicNote(row, req.spaceId!, { full: true }) });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const existing = getOwnNote(req.params.id, spaceId);
    // Weder Titel noch Text werden beim Speichern "korrigiert" (z. B. leerer
    // Titel → "Ohne Titel", oder ein Trimmen von Zeilenumbrüchen am Ende) –
    // sonst überschreibt die Server-Antwort während des Tippens plötzlich
    // das Eingabefeld. Genau das, was eingegeben wurde, wird gespeichert.
    const title =
      req.body?.title === undefined ? existing.title : requireString(req.body.title, 'Titel', { max: 200, min: 0 });
    const body = req.body?.body === undefined ? existing.body : optionalText(req.body.body, 20000);
    const pinned = req.body?.pinned === undefined ? existing.pinned : toBool(req.body.pinned) ? 1 : 0;
    getDb()
      .prepare('UPDATE notes SET title = ?, body = ?, pinned = ?, updated_at = ? WHERE id = ?')
      .run(title, body, pinned, new Date().toISOString(), existing.id);
    const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(existing.id) as NoteRow;
    res.json({ note: publicNote(row, spaceId, { full: true }) });
  }),
);

/**
 * Notiz (weich) löschen. Die Bildanhänge werden ebenfalls weich gelöscht
 * (state = 'deleted') – die Originaldateien bleiben auf dem QNAP erhalten und
 * werden NICHT physisch entfernt.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const existing = getOwnNote(req.params.id, spaceId);
    const db = getDb();
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      const attachmentIds = (
        db.prepare('SELECT item_id FROM note_attachments WHERE note_id = ?').all(existing.id) as {
          item_id: string;
        }[]
      ).map((r) => r.item_id);
      const softDelete = db.prepare(
        `UPDATE items SET state = 'deleted', state_by = 'Notiz gelöscht', state_at = ? WHERE id = ? AND space_id = ?`,
      );
      for (const iid of attachmentIds) softDelete.run(now, iid, spaceId);
      db.prepare('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, existing.id);
    });
    tx();
    res.json({ ok: true });
  }),
);

// ---- Checklistenpunkte -----------------------------------------------------

router.post(
  '/:id/checklist',
  asyncHandler(async (req, res) => {
    const note = getOwnNote(req.params.id, req.spaceId!);
    const text = requireString(req.body?.text, 'Eintrag', { max: 500 });
    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    const maxPos = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM note_checklist_items WHERE note_id = ?')
      .get(note.id) as { m: number };
    db.prepare(
      `INSERT INTO note_checklist_items (id, note_id, text, checked, position, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    ).run(id, note.id, text, maxPos.m + 1, now, now);
    db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(now, note.id);
    const row = db.prepare('SELECT * FROM note_checklist_items WHERE id = ?').get(id) as NoteChecklistItemRow;
    res.status(201).json({ item: publicChecklistItem(row) });
  }),
);

router.patch(
  '/:id/checklist/:itemId',
  asyncHandler(async (req, res) => {
    const note = getOwnNote(req.params.id, req.spaceId!);
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM note_checklist_items WHERE id = ? AND note_id = ?')
      .get(req.params.itemId, note.id) as NoteChecklistItemRow | undefined;
    if (!row) throw new ApiError(404, 'Eintrag nicht gefunden.');
    const text = req.body?.text === undefined ? row.text : requireString(req.body.text, 'Eintrag', { max: 500 });
    const checked = req.body?.checked === undefined ? row.checked : toBool(req.body.checked) ? 1 : 0;
    const position = req.body?.position === undefined ? row.position : Number(req.body.position);
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE note_checklist_items SET text = ?, checked = ?, position = ?, updated_at = ? WHERE id = ?',
    ).run(text, checked, Number.isFinite(position) ? position : row.position, now, row.id);
    db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(now, note.id);
    const updated = db.prepare('SELECT * FROM note_checklist_items WHERE id = ?').get(row.id) as NoteChecklistItemRow;
    res.json({ item: publicChecklistItem(updated) });
  }),
);

router.delete(
  '/:id/checklist/:itemId',
  asyncHandler(async (req, res) => {
    const note = getOwnNote(req.params.id, req.spaceId!);
    const db = getDb();
    const info = db
      .prepare('DELETE FROM note_checklist_items WHERE id = ? AND note_id = ?')
      .run(req.params.itemId, note.id);
    if (info.changes === 0) throw new ApiError(404, 'Eintrag nicht gefunden.');
    db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), note.id);
    res.json({ ok: true });
  }),
);

// ---- Anhänge ---------------------------------------------------------------

/**
 * Bildanhang von einer Notiz entfernen: Der Verweis wird gelöscht und das
 * (nur zu dieser Notiz gehörende) Medium weich gelöscht. Originaldateien
 * bleiben auf dem QNAP erhalten.
 */
router.delete(
  '/:id/attachments/:itemId',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const note = getOwnNote(req.params.id, spaceId);
    const db = getDb();
    const link = db
      .prepare('SELECT * FROM note_attachments WHERE note_id = ? AND item_id = ?')
      .get(note.id, req.params.itemId) as { note_id: string; item_id: string } | undefined;
    if (!link) throw new ApiError(404, 'Anhang nicht gefunden.');
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM note_attachments WHERE note_id = ? AND item_id = ?').run(note.id, req.params.itemId);
      db.prepare(
        `UPDATE items SET state = 'deleted', state_by = 'Notiz-Anhang entfernt', state_at = ? WHERE id = ? AND space_id = ?`,
      ).run(now, req.params.itemId, spaceId);
      db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(now, note.id);
    });
    tx();
    res.json({ ok: true });
  }),
);

export default router;
