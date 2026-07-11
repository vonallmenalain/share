import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { getDb, ItemRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { variantPath, Variant } from '../lib/media';

const router = Router();

function getItem(id: string, spaceId: string): ItemRow {
  const item = getDb().prepare('SELECT * FROM items WHERE id = ? AND space_id = ?').get(id, spaceId) as
    | ItemRow
    | undefined;
  if (!item) throw new ApiError(404, 'Medium nicht gefunden.');
  return item;
}

/**
 * Liefert eine Datei aus – mit Unterstützung für HTTP-Range (wichtig für das
 * Scrubben/Streamen von Videos und schnelle Downloads grosser Dateien).
 */
function sendFile(
  req: Request,
  res: Response,
  filePath: string,
  contentType: string,
  opts: { downloadName?: string; immutable?: boolean } = {},
) {
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'Datei nicht gefunden.');
  const stat = fs.statSync(filePath);
  const total = stat.size;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Robots-Tag', 'noindex, noimageindex');
  if (opts.immutable) {
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  if (opts.downloadName) {
    const safe = opts.downloadName.replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  }

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`);
        return res.end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', end - start + 1);
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
  }

  res.setHeader('Content-Length', total);
  return fs.createReadStream(filePath).pipe(res);
}

/** Galerie-Thumbnail (nur Fotos). */
router.get(
  '/thumb/:id',
  requireSpace,
  asyncHandler(async (req, res) => {
    const item = getItem(req.params.id, req.spaceId!);
    sendFile(req, res, variantPath('thumb', item.storage_key), 'image/jpeg', { immutable: true });
  }),
);

/** Grosse Bildvorschau (Lightbox). */
router.get(
  '/preview/:id',
  requireSpace,
  asyncHandler(async (req, res) => {
    const item = getItem(req.params.id, req.spaceId!);
    sendFile(req, res, variantPath('preview', item.storage_key), 'image/jpeg', { immutable: true });
  }),
);

/** Video-Poster (Standbild). */
router.get(
  '/poster/:id',
  requireSpace,
  asyncHandler(async (req, res) => {
    const item = getItem(req.params.id, req.spaceId!);
    sendFile(req, res, variantPath('poster', item.storage_key), 'image/jpeg', { immutable: true });
  }),
);

/** Abspielbare Video-Vorschau (kleiner, H.264). */
router.get(
  '/video/:id',
  requireSpace,
  asyncHandler(async (req, res) => {
    const item = getItem(req.params.id, req.spaceId!);
    sendFile(req, res, variantPath('video-preview', item.storage_key), 'video/mp4', {
      immutable: true,
    });
  }),
);

/** Download der Originaldatei. */
router.get(
  '/original/:id',
  requireSpace,
  asyncHandler(async (req, res) => {
    const item = getItem(req.params.id, req.spaceId!);
    const contentType = item.mime || 'application/octet-stream';
    const safeName = path.basename(item.original_filename) || `datei.${item.ext}`;
    sendFile(req, res, variantPath('original', item.storage_key, item.ext), contentType, {
      downloadName: safeName,
    });
  }),
);

/**
 * Mehrere Originale als ZIP herunterladen. Query `ids` = kommagetrennte Item-IDs
 * (oder leer = alle Items des Bereichs). Wird gestreamt, also auch für viele
 * grosse Dateien speicherschonend.
 */
router.get(
  '/zip',
  requireSpace,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const idsParam = String(req.query.ids ?? '').trim();
    let items: ItemRow[];
    if (idsParam) {
      const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 1000);
      const placeholders = ids.map(() => '?').join(',');
      items = db
        .prepare(`SELECT * FROM items WHERE space_id = ? AND id IN (${placeholders})`)
        .all(req.spaceId, ...ids) as ItemRow[];
    } else {
      items = db
        .prepare(
          `SELECT * FROM items WHERE space_id = ? AND scope = 'gallery' ORDER BY position ASC`,
        )
        .all(req.spaceId) as ItemRow[];
    }
    if (items.length === 0) throw new ApiError(404, 'Keine Medien zum Herunterladen.');

    const space = db.prepare('SELECT name FROM spaces WHERE id = ?').get(req.spaceId) as
      | { name: string }
      | undefined;
    const zipName = `${(space?.name ?? 'medien').replace(/[^a-zA-Z0-9-_]+/g, '_')}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 0 } }); // Fotos/Videos sind bereits komprimiert.
    archive.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[zip] error', err);
      res.destroy(err);
    });
    archive.pipe(res);

    const usedNames = new Set<string>();
    for (const item of items) {
      const filePath = variantPath('original', item.storage_key, item.ext);
      if (!fs.existsSync(filePath)) continue;
      let name = path.basename(item.original_filename) || `${item.id}.${item.ext}`;
      if (usedNames.has(name)) {
        const dot = name.lastIndexOf('.');
        name = dot > 0 ? `${name.slice(0, dot)}-${item.id.slice(0, 6)}${name.slice(dot)}` : `${name}-${item.id.slice(0, 6)}`;
      }
      usedNames.add(name);
      archive.file(filePath, { name });
    }
    await archive.finalize();
  }),
);

export { Variant };
export default router;
