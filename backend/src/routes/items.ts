import { Router, raw } from 'express';
import { getDb, ItemRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { requireEnabledModule } from '../middleware/module';
import {
  fileExists,
  variantPath,
  writeCustomThumb,
  resetThumbFromOriginal,
} from '../lib/media';

const router = Router();

// Alle Routen hier betreffen ausschliesslich die Galerie (Fotos & Videos) –
// ist dieses Modul für den Bereich abgewählt, gibt es hier nichts zu tun.
router.use(requireSpace, requireEnabledModule('photos'));

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
    thumbVersion: item.thumb_version ?? 0,
    thumbW: item.thumb_w,
    thumbH: item.thumb_h,
    scope: item.scope ?? 'gallery',
    noteId: item.note_id ?? null,
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
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM items WHERE space_id = ? AND state = 'active' AND scope = 'gallery'
         ORDER BY position ASC, created_at ASC`,
      )
      .all(req.spaceId) as ItemRow[];
    res.json({ items: rows.map(publicItem) });
  }),
);

/** Status einzelner Items (zum Pollen während der Verarbeitung). */
router.get(
  '/status',
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
 * Medium als Favorit markieren oder die Markierung entfernen. Darf jede Person
 * im Bereich. Body: { favorite: boolean }.
 */
router.post(
  '/:id/favorite',
  asyncHandler(async (req, res) => {
    const item = getOwnItem(req.params.id, req.spaceId!);
    const value = req.body?.favorite === false ? 0 : 1;
    getDb().prepare(`UPDATE items SET favorite=? WHERE id=?`).run(value, item.id);
    res.json({ ok: true, favorite: value === 1 });
  }),
);

/**
 * Angepasstes Vorschaubild (Thumbnail) setzen. Body = rohe Bild-Bytes (JPEG/PNG)
 * des vom Client bereits zugeschnittenen/gezoomten/rotierten Ausschnitts. Darf
 * jede Person im Bereich (wie das Setzen eines Favoriten). Nur für Fotos.
 */
router.post(
  '/:id/thumb',
  raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 20 * 1024 * 1024 }),
  asyncHandler(async (req, res) => {
    const item = getOwnItem(req.params.id, req.spaceId!);
    if (item.kind !== 'photo') {
      throw new ApiError(400, 'Nur für Fotos kann ein Vorschaubild angepasst werden.');
    }
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new ApiError(400, 'Kein Bild empfangen.');
    }
    let dims: { width: number; height: number };
    try {
      dims = await writeCustomThumb(body, item.storage_key);
    } catch {
      throw new ApiError(400, 'Das Vorschaubild konnte nicht verarbeitet werden.');
    }
    getDb()
      .prepare(
        `UPDATE items SET thumb_w=?, thumb_h=?, thumb_version=thumb_version+1 WHERE id=?`,
      )
      .run(dims.width, dims.height, item.id);
    const updated = getDb().prepare('SELECT * FROM items WHERE id = ?').get(item.id) as ItemRow;
    res.json({ item: publicItem(updated) });
  }),
);

/**
 * Angepasstes Vorschaubild zurücksetzen: Das Standard-Thumbnail (ganzes Foto)
 * wird aus dem Original neu erzeugt und die Anpassung entfernt.
 */
router.delete(
  '/:id/thumb',
  asyncHandler(async (req, res) => {
    const item = getOwnItem(req.params.id, req.spaceId!);
    if (item.kind !== 'photo') {
      throw new ApiError(400, 'Nur für Fotos kann ein Vorschaubild angepasst werden.');
    }
    try {
      await resetThumbFromOriginal(
        variantPath('original', item.storage_key, item.ext),
        item.storage_key,
      );
    } catch {
      throw new ApiError(400, 'Das Vorschaubild konnte nicht zurückgesetzt werden.');
    }
    getDb()
      .prepare(`UPDATE items SET thumb_w=NULL, thumb_h=NULL, thumb_version=thumb_version+1 WHERE id=?`)
      .run(item.id);
    const updated = getDb().prepare('SELECT * FROM items WHERE id = ?').get(item.id) as ItemRow;
    res.json({ item: publicItem(updated) });
  }),
);

/**
 * Medium (weich) löschen. Jede Person mit Zugriff auf den Bereich (Link) darf
 * jedes Medium löschen – unabhängig davon, wer es hochgeladen hat. Das Medium
 * verschwindet danach sofort aus allen Galerien, wird aber nur ausgeblendet und
 * nicht physisch entfernt. Nur der Administrator sieht die gelöschten Medien
 * weiterhin und kann sie wiederherstellen oder endgültig (inkl. Dateien vom
 * QNAP) löschen.
 */
router.post(
  '/:id/delete',
  asyncHandler(async (req, res) => {
    const item = getOwnItem(req.params.id, req.spaceId!);
    // Wer gelöscht hat, wird – sofern ein Name bekannt ist – festgehalten. Ein
    // Name ist aber keine Voraussetzung mehr, damit jeder Gast löschen kann.
    const by = uploaderNameOf(req) || 'Unbekannt';
    getDb()
      .prepare(`UPDATE items SET state='deleted', state_by=?, state_at=? WHERE id=?`)
      .run(by, new Date().toISOString(), item.id);
    res.json({ ok: true });
  }),
);

export default router;
