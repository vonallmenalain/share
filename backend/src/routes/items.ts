import { Router } from 'express';
import { getDb, ItemRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { fileExists, variantPath } from '../lib/media';

const router = Router();

export function publicItem(item: ItemRow) {
  const hasPreview =
    item.kind === 'photo'
      ? fileExists(variantPath('preview', item.storage_key))
      : fileExists(variantPath('video-preview', item.storage_key));
  const hasPoster = item.kind === 'video' && fileExists(variantPath('poster', item.storage_key));
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    state: item.state,
    stateBy: item.state_by,
    stateAt: item.state_at,
    uploaderName: item.uploader_name,
    filename: item.original_filename,
    ext: item.ext,
    mime: item.mime,
    width: item.width,
    height: item.height,
    duration: item.duration,
    sizeBytes: item.size_bytes,
    takenAt: item.taken_at,
    position: item.position,
    favorite: item.favorite === 1,
    createdAt: item.created_at,
    hasPreview,
    hasPoster,
  };
}

/** Liest den (frei wählbaren) Anzeigenamen der aktuellen Person. */
function uploaderNameOf(req: import('express').Request): string {
  const header = req.headers['x-uploader-name'];
  const raw = Array.isArray(header) ? header[0] : header;
  const value = String(raw ?? '');
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function sameUploader(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

function getOwnItem(id: string, spaceId: string): ItemRow {
  const item = getDb()
    .prepare('SELECT * FROM items WHERE id = ? AND space_id = ?')
    .get(id, spaceId) as ItemRow | undefined;
  if (!item) throw new ApiError(404, 'Medium nicht gefunden.');
  return item;
}

/** Liste aller aktiven Medien eines Bereichs (in benutzerdefinierter Reihenfolge). */
router.get(
  '/',
  requireSpace,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM items WHERE space_id = ? AND state = 'active' ORDER BY position ASC, created_at ASC`,
      )
      .all(req.spaceId) as ItemRow[];
    res.json({ items: rows.map(publicItem) });
  }),
);

/** Status einzelner Items (zum Pollen während der Verarbeitung). */
router.get(
  '/status',
  requireSpace,
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);
    if (ids.length === 0) return res.json({ items: [] });
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT * FROM items WHERE space_id = ? AND id IN (${placeholders})`)
      .all(req.spaceId, ...ids) as ItemRow[];
    res.json({ items: rows.map(publicItem) });
  }),
);

/**
 * Benutzerdefinierte Reihenfolge speichern. Body: { order: string[] } mit den
 * Item-IDs in gewünschter Reihenfolge. Nur Items des aktuellen Bereichs werden
 * berücksichtigt.
 */
router.patch(
  '/order',
  requireSpace,
  asyncHandler(async (req, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order)) throw new ApiError(400, 'Ungültige Reihenfolge.');
    const db = getDb();
    const update = db.prepare('UPDATE items SET position = ? WHERE id = ? AND space_id = ?');
    const tx = db.transaction((ids: string[]) => {
      ids.forEach((id, index) => update.run(index, String(id), req.spaceId));
    });
    tx(order as string[]);
    res.json({ ok: true });
  }),
);

/**
 * Medium archivieren. Darf jede Person im Bereich. Das Medium verschwindet
 * aus der Galerie, bleibt aber (inkl. aller Dateien) erhalten und kann vom
 * Administrator wiederhergestellt oder endgültig gelöscht werden.
 */
router.post(
  '/:id/archive',
  requireSpace,
  asyncHandler(async (req, res) => {
    const item = getOwnItem(req.params.id, req.spaceId!);
    const by = uploaderNameOf(req) || 'Unbekannt';
    getDb()
      .prepare(`UPDATE items SET state='archived', state_by=?, state_at=? WHERE id=?`)
      .run(by, new Date().toISOString(), item.id);
    res.json({ ok: true });
  }),
);

/**
 * Medium als Favorit markieren oder die Markierung entfernen. Darf jede Person
 * im Bereich. Body: { favorite: boolean }.
 */
router.post(
  '/:id/favorite',
  requireSpace,
  asyncHandler(async (req, res) => {
    const item = getOwnItem(req.params.id, req.spaceId!);
    const value = req.body?.favorite === false ? 0 : 1;
    getDb().prepare(`UPDATE items SET favorite=? WHERE id=?`).run(value, item.id);
    res.json({ ok: true, favorite: value === 1 });
  }),
);

/**
 * Medium (weich) löschen. Nur die Person, die es hochgeladen hat, darf das.
 * Das Medium verschwindet aus der Galerie, wird aber nicht physisch entfernt –
 * nur der Administrator kann Medien endgültig löschen.
 */
router.post(
  '/:id/delete',
  requireSpace,
  asyncHandler(async (req, res) => {
    const item = getOwnItem(req.params.id, req.spaceId!);
    const by = uploaderNameOf(req);
    if (!by) throw new ApiError(400, 'Bitte zuerst deinen Namen angeben.');
    if (!sameUploader(by, item.uploader_name)) {
      throw new ApiError(403, 'Nur wer ein Medium hochgeladen hat, darf es löschen.');
    }
    getDb()
      .prepare(`UPDATE items SET state='deleted', state_by=?, state_at=? WHERE id=?`)
      .run(by, new Date().toISOString(), item.id);
    res.json({ ok: true });
  }),
);

export default router;
