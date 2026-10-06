import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb, ItemRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { variantPath, Variant } from '../lib/media';
import { inlineContentType } from '../lib/documents';
import { contentDisposition } from '../lib/httpHeaders';
import { sendOriginalsZip, zipFileName } from '../lib/zip';

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
 * Scrubben/Streamen von Videos und Musik und schnelle Downloads grosser Dateien).
 */
function sendFile(
  req: Request,
  res: Response,
  filePath: string,
  contentType: string,
  opts: { downloadName?: string; inlineName?: string; immutable?: boolean } = {},
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
    res.setHeader('Content-Disposition', contentDisposition('attachment', opts.downloadName));
  } else if (opts.inlineName) {
    res.setHeader('Content-Disposition', contentDisposition('inline', opts.inlineName));
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
 * Original zum direkten Anzeigen/Abspielen im Browser (Dokumente-Modul: PDF,
 * Musik, Bilder, Videos). Anders als `/original` wird die Datei inline
 * ausgeliefert – aber NUR für sichere Medientypen, deren Content-Type der
 * Server selbst festlegt (siehe lib/documents.ts). Alles andere (z. B. HTML
 * oder SVG) kommt ausschliesslich als Download, damit nie eine hochgeladene
 * Datei als Webseite auf der API-Domain ausgeführt werden kann.
 */
router.get(
  '/view/:id',
  requireSpace,
  asyncHandler(async (req, res) => {
    const item = getItem(req.params.id, req.spaceId!);
    const filePath = variantPath('original', item.storage_key, item.ext);
    const name = path.basename(item.original_filename) || `datei.${item.ext}`;
    const contentType = inlineContentType(item.ext, item.mime);
    if (!contentType) {
      sendFile(req, res, filePath, 'application/octet-stream', { downloadName: name });
      return;
    }
    sendFile(req, res, filePath, contentType, { inlineName: name, immutable: true });
  }),
);

/**
 * Mehrere Originale als ZIP herunterladen (gestreamt, siehe lib/zip.ts).
 * Query `ids` = kommagetrennte Item-IDs (Auswahl in der Galerie), ohne `ids`
 * alle Fotos & Videos der Galerie – gelöschte nicht. Alle Dokumente gibt es
 * unter `GET /api/documents/zip`.
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
          `SELECT * FROM items WHERE space_id = ? AND scope = 'gallery' AND state = 'active'
           ORDER BY position ASC`,
        )
        .all(req.spaceId) as ItemRow[];
    }
    if (items.length === 0) throw new ApiError(404, 'Keine Medien zum Herunterladen.');

    const space = db.prepare('SELECT name FROM spaces WHERE id = ?').get(req.spaceId) as
      | { name: string }
      | undefined;
    await sendOriginalsZip(res, items, zipFileName(space?.name, 'medien'));
  }),
);

export { Variant };
export default router;
