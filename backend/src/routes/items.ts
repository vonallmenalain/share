import { Router } from 'express';
import { getDb, ItemRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { deleteAllVariants, fileExists, variantPath } from '../lib/media';

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
    createdAt: item.created_at,
    hasPreview,
    hasPoster,
  };
}

/** Liste aller Medien eines Bereichs (in benutzerdefinierter Reihenfolge). */
router.get(
  '/',
  requireSpace,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM items WHERE space_id = ? ORDER BY position ASC, created_at ASC')
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

/** Einzelnes Item löschen (inkl. aller Dateien). */
router.delete(
  '/:id',
  requireSpace,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const item = db
      .prepare('SELECT * FROM items WHERE id = ? AND space_id = ?')
      .get(req.params.id, req.spaceId) as ItemRow | undefined;
    if (!item) throw new ApiError(404, 'Medium nicht gefunden.');
    db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
    await deleteAllVariants(item.storage_key, item.ext);
    res.json({ ok: true });
  }),
);

export default router;
