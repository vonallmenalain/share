import { Router } from 'express';
import { getDb, ItemRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireAdmin, requireSpace } from '../middleware/auth';
import { requireEnabledModule } from '../middleware/module';
import { manageGuard } from '../middleware/manage';
import { adminLimiter } from '../middleware/rateLimit';
import { docTypeOf, renameKeepingExtension } from '../lib/documents';

/**
 * Dokumente-Modul: Dateien aller Art (v. a. PDFs und Musik), die direkt im
 * Browser angezeigt bzw. abgespielt werden. Technisch sind es Medien
 * (`items`) mit `scope = 'document'` – sie nutzen denselben fortsetzbaren
 * Chunk-Upload (`POST /api/uploads` mit `scope: 'document'`), dieselbe Ablage
 * und dieselben Datei-Endpunkte (`/files/view/:id` zum Anzeigen,
 * `/files/original/:id` zum Herunterladen), erscheinen aber nie in der Galerie.
 *
 * Lesen darf jede Person mit Zugriff auf den Bereich. Ändern (löschen,
 * sortieren, umbenennen) ebenfalls – ausser die Upload-Sperre ist aktiv: Dann
 * nur noch der Administrator (siehe middleware/manage.ts).
 */
const router = Router();

router.use(requireSpace, requireEnabledModule('documents'));

export function publicDocument(row: ItemRow) {
  return {
    id: row.id,
    name: row.original_filename,
    ext: row.ext,
    mime: row.mime,
    docType: docTypeOf(row.ext, row.mime),
    sizeBytes: row.size_bytes,
    duration: row.duration,
    position: row.position,
    state: row.state,
    stateBy: row.state_by,
    stateAt: row.state_at,
    createdAt: row.created_at,
  };
}

function documentsOf(spaceId: string, state: 'active' | 'deleted'): ItemRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM items WHERE space_id = ? AND scope = 'document' AND state = ?
       ORDER BY position ASC, created_at ASC`,
    )
    .all(spaceId, state) as ItemRow[];
}

function getOwnDocument(id: string, spaceId: string): ItemRow {
  const row = getDb()
    .prepare(`SELECT * FROM items WHERE id = ? AND space_id = ? AND scope = 'document'`)
    .get(id, spaceId) as ItemRow | undefined;
  if (!row) throw new ApiError(404, 'Dokument nicht gefunden.');
  return row;
}

/** Liest den (frei wählbaren) Anzeigenamen der aktuellen Person. */
function visitorNameOf(req: import('express').Request): string {
  const header = req.headers['x-uploader-name'];
  const raw = Array.isArray(header) ? header[0] : header;
  const value = String(raw ?? '');
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

/** Alle (nicht gelöschten) Dokumente in der festgelegten Reihenfolge. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ documents: documentsOf(req.spaceId!, 'active').map(publicDocument) });
  }),
);

/** Admin: gelöschte Dokumente (zum Wiederherstellen oder endgültigen Löschen). */
router.get(
  '/deleted',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ documents: documentsOf(req.spaceId!, 'deleted').map(publicDocument) });
  }),
);

/**
 * Reihenfolge speichern. Body: { order: string[] } mit den Dokument-IDs in der
 * gewünschten Reihenfolge. Nur Dokumente dieses Bereichs werden angefasst.
 */
router.patch(
  '/order',
  ...manageGuard,
  asyncHandler(async (req, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order)) throw new ApiError(400, 'Ungültige Reihenfolge.');
    const db = getDb();
    const update = db.prepare(
      `UPDATE items SET position = ? WHERE id = ? AND space_id = ? AND scope = 'document'`,
    );
    const tx = db.transaction((ids: string[]) => {
      ids.forEach((id, index) => update.run(index, String(id), req.spaceId));
    });
    tx((order as unknown[]).slice(0, 5000).map(String));
    res.json({ ok: true });
  }),
);

/** Umbenennen (angezeigter Name). Body: { name }. Die Dateiendung bleibt erhalten. */
router.patch(
  '/:id',
  ...manageGuard,
  asyncHandler(async (req, res) => {
    const row = getOwnDocument(req.params.id, req.spaceId!);
    const name = renameKeepingExtension(row.original_filename, req.body?.name);
    getDb().prepare('UPDATE items SET original_filename = ? WHERE id = ?').run(name, row.id);
    const updated = getOwnDocument(row.id, req.spaceId!);
    res.json({ document: publicDocument(updated) });
  }),
);

/**
 * Dokument (weich) löschen: Es verschwindet sofort aus der Liste, die Datei
 * bleibt aber auf dem QNAP. Der Administrator kann es wiederherstellen oder
 * endgültig löschen (Admin-Endpunkte unter /api/spaces/:id/items/...).
 */
router.post(
  '/:id/delete',
  ...manageGuard,
  asyncHandler(async (req, res) => {
    const row = getOwnDocument(req.params.id, req.spaceId!);
    const by = visitorNameOf(req) || (req.isAdmin ? 'Admin' : 'Unbekannt');
    getDb()
      .prepare(`UPDATE items SET state = 'deleted', state_by = ?, state_at = ? WHERE id = ?`)
      .run(by, new Date().toISOString(), row.id);
    res.json({ ok: true });
  }),
);

export default router;
