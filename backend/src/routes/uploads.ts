import { Router, raw } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config, paths } from '../config';
import { getDb, ItemRow, UploadRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { newId } from '../lib/ids';
import { variantPath } from '../lib/media';
import { detectKind, enqueueProcessing, extFromFilename } from '../services/process';
import { publicItem } from './items';
import { isModuleEnabled } from '../lib/modules';
import { NoteRow } from '../db';

const router = Router();

function uploadDir(uploadId: string): string {
  return path.join(paths.tmpUploads(), uploadId);
}
function partPath(uploadId: string, index: number): string {
  return path.join(uploadDir(uploadId), `${index}.part`);
}

function expectedChunkSize(upload: UploadRow, index: number): number {
  if (index < upload.total_chunks - 1) return upload.chunk_size;
  const rest = upload.size_bytes - upload.chunk_size * (upload.total_chunks - 1);
  return rest;
}

/**
 * Ermittelt anhand der vorhandenen .part-Dateien, welche Chunks bereits
 * vollständig empfangen wurden. Dateisystem als Wahrheitsquelle macht das
 * gegenüber parallelen Uploads/Abbrüchen robust.
 */
async function computeReceived(upload: UploadRow): Promise<number[]> {
  const received: number[] = [];
  for (let i = 0; i < upload.total_chunks; i++) {
    try {
      const st = await fsp.stat(partPath(upload.id, i));
      if (st.size === expectedChunkSize(upload, i)) received.push(i);
    } catch {
      /* missing */
    }
  }
  return received;
}

function getUpload(uploadId: string, spaceId: string): UploadRow {
  const db = getDb();
  const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId) as
    | UploadRow
    | undefined;
  if (!upload || upload.space_id !== spaceId) throw new ApiError(404, 'Upload nicht gefunden.');
  return upload;
}

/**
 * Upload-Session anlegen (oder eine passende offene Session wiederverwenden,
 * damit ein abgebrochener Upload nach Browser-Neustart fortgesetzt werden kann).
 * Body: { filename, mime, size }. Header X-Uploader-Name trägt den Namen.
 */
router.post(
  '/',
  requireSpace,
  asyncHandler(async (req, res) => {
    const filename = String(req.body?.filename ?? '').trim();
    const mime = String(req.body?.mime ?? 'application/octet-stream');
    const size = Number(req.body?.size);
    const uploaderName = String(req.body?.uploaderName ?? '').trim() || 'Unbekannt';
    // Kontext des Uploads: 'gallery' (Fotogalerie, Standard) oder 'note'
    // (Bildanhang einer Notiz). Notiz-Uploads erscheinen NICHT in der Galerie.
    const scope = req.body?.scope === 'note' ? 'note' : 'gallery';
    const noteId = scope === 'note' ? String(req.body?.noteId ?? '').trim() : '';

    if (!filename) throw new ApiError(400, 'Dateiname fehlt.');
    if (!Number.isFinite(size) || size <= 0) throw new ApiError(400, 'Ungültige Dateigrösse.');
    if (size > config.upload.maxFileBytes) {
      const maxMb = Math.round(config.upload.maxFileBytes / (1024 * 1024));
      throw new ApiError(413, `Datei zu gross (max. ${maxMb} MB).`);
    }

    const db = getDb();

    // Galerie-Uploads verlangen, dass die Galerie (Fotos & Videos) für diesen
    // Bereich aktiviert ist – sie ist seit Einführung der Modulauswahl
    // optional und kann z. B. für einen reinen Finanz-Bereich fehlen.
    if (scope === 'gallery' && !isModuleEnabled(req.spaceId!, 'photos')) {
      throw new ApiError(403, 'Die Galerie ist in diesem Bereich nicht aktiviert.');
    }

    // Notiz-Uploads verlangen ein aktiviertes Notiz-Modul und eine gültige,
    // zum Bereich gehörende Notiz-ID (Schutz gegen fremde IDs).
    if (scope === 'note') {
      if (!isModuleEnabled(req.spaceId!, 'notes')) {
        throw new ApiError(403, 'Das Notiz-Modul ist in diesem Bereich nicht aktiviert.');
      }
      const note = db
        .prepare('SELECT * FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL')
        .get(noteId, req.spaceId) as NoteRow | undefined;
      if (!note) throw new ApiError(404, 'Notiz nicht gefunden.');
      if (!/^image\//i.test(mime)) {
        // Für die erste Version sind nur Bildanhänge vorgesehen.
        throw new ApiError(400, 'Für Notizen sind nur Bilder als Anhang möglich.');
      }
    }
    const chunkSize = config.upload.chunkSizeBytes;
    const totalChunks = Math.max(1, Math.ceil(size / chunkSize));

    // Bestehende offene Session mit gleichen Eckdaten wiederverwenden (Resume).
    const existing = db
      .prepare(
        `SELECT * FROM uploads WHERE space_id = ? AND filename = ? AND size_bytes = ? AND scope = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(req.spaceId, filename, size, scope) as UploadRow | undefined;

    let upload: UploadRow;
    if (existing && existing.chunk_size === chunkSize) {
      upload = existing;
    } else {
      const id = newId();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO uploads (id, space_id, uploader_name, filename, mime, size_bytes, chunk_size, total_chunks, received, status, scope, note_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'open', ?, ?, ?, ?)`,
      ).run(
        id,
        req.spaceId,
        uploaderName,
        filename,
        mime,
        size,
        chunkSize,
        totalChunks,
        scope,
        noteId || null,
        now,
        now,
      );
      await fsp.mkdir(uploadDir(id), { recursive: true });
      upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow;
    }

    const received = await computeReceived(upload);
    res.status(201).json({
      uploadId: upload.id,
      chunkSize: upload.chunk_size,
      totalChunks: upload.total_chunks,
      received,
    });
  }),
);

/** Status einer Upload-Session (welche Chunks fehlen noch). */
router.get(
  '/:id',
  requireSpace,
  asyncHandler(async (req, res) => {
    const upload = getUpload(req.params.id, req.spaceId!);
    const received = await computeReceived(upload);
    res.json({
      uploadId: upload.id,
      chunkSize: upload.chunk_size,
      totalChunks: upload.total_chunks,
      received,
      status: upload.status,
      itemId: upload.item_id,
    });
  }),
);

/**
 * Einen Chunk hochladen. Body = rohe Bytes des Chunks. Idempotent: ein bereits
 * vorhandener Chunk wird einfach überschrieben. Atomar via temp-Datei + rename.
 */
router.put(
  '/:id/chunks/:index',
  requireSpace,
  raw({ type: '*/*', limit: config.upload.chunkSizeBytes + 1024 * 1024 }),
  asyncHandler(async (req, res) => {
    const upload = getUpload(req.params.id, req.spaceId!);
    if (upload.status === 'completed') {
      return res.json({ ok: true, alreadyCompleted: true });
    }
    const index = parseInt(req.params.index, 10);
    if (!Number.isInteger(index) || index < 0 || index >= upload.total_chunks) {
      throw new ApiError(400, 'Ungültiger Chunk-Index.');
    }
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new ApiError(400, 'Leerer Chunk.');
    }
    const expected = expectedChunkSize(upload, index);
    if (body.length !== expected) {
      throw new ApiError(400, `Falsche Chunk-Grösse (erwartet ${expected}, erhalten ${body.length}).`);
    }

    await fsp.mkdir(uploadDir(upload.id), { recursive: true });
    const dest = partPath(upload.id, index);
    const tmp = `${dest}.tmp`;
    await fsp.writeFile(tmp, body);
    await fsp.rename(tmp, dest);

    getDb()
      .prepare('UPDATE uploads SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), upload.id);

    const received = await computeReceived(upload);
    res.json({ ok: true, received: received.length, totalChunks: upload.total_chunks });
  }),
);

/**
 * Upload abschliessen: prüft, dass alle Chunks vorhanden sind, fügt sie zur
 * Originaldatei zusammen, legt das Item an und stösst die (asynchrone)
 * Verarbeitung an. Antwortet mit dem (noch in Verarbeitung befindlichen) Item.
 */
router.post(
  '/:id/complete',
  requireSpace,
  asyncHandler(async (req, res) => {
    const upload = getUpload(req.params.id, req.spaceId!);

    if (upload.status === 'completed' && upload.item_id) {
      const existingItem = getDb()
        .prepare('SELECT * FROM items WHERE id = ?')
        .get(upload.item_id) as ItemRow | undefined;
      if (existingItem) return res.json({ item: publicItem(existingItem) });
    }

    const received = await computeReceived(upload);
    if (received.length !== upload.total_chunks) {
      const missing = [];
      for (let i = 0; i < upload.total_chunks; i++) if (!received.includes(i)) missing.push(i);
      throw new ApiError(409, `Es fehlen noch Chunks: ${missing.slice(0, 20).join(', ')}`);
    }

    const ext = extFromFilename(upload.filename);
    const kind = detectKind(upload.mime, ext);
    const itemId = newId();
    const storageKey = `${upload.space_id}/${itemId}`;
    const originalDest = variantPath('original', storageKey, ext);
    await fsp.mkdir(path.dirname(originalDest), { recursive: true });

    // Chunks der Reihe nach zur Originaldatei zusammenfügen. Wir lesen jeden
    // Teil als Stream und warten über den write-Callback, bis er tatsächlich
    // geschrieben wurde (inkl. Backpressure). So entsteht keine Race-Condition,
    // bei der die zusammengefügte Datei zu kurz wäre.
    const tmpOriginal = `${originalDest}.assembling`;
    const out = fs.createWriteStream(tmpOriginal);
    try {
      for (let i = 0; i < upload.total_chunks; i++) {
        const rs = fs.createReadStream(partPath(upload.id, i));
        for await (const chunk of rs) {
          if (!out.write(chunk as Buffer)) {
            await new Promise<void>((resolve, reject) => {
              out.once('drain', resolve);
              out.once('error', reject);
            });
          }
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        out.end(() => resolve());
        out.on('error', reject);
      });
    }

    const stat = await fsp.stat(tmpOriginal);
    if (stat.size !== upload.size_bytes) {
      await fsp.unlink(tmpOriginal).catch(() => undefined);
      throw new ApiError(409, 'Zusammengefügte Datei hat falsche Grösse – bitte erneut versuchen.');
    }
    await fsp.rename(tmpOriginal, originalDest);

    const db = getDb();
    const now = new Date().toISOString();
    const scope = upload.scope === 'note' ? 'note' : 'gallery';
    const maxPos = db
      .prepare(`SELECT COALESCE(MAX(position), -1) AS m FROM items WHERE space_id = ? AND scope = ?`)
      .get(upload.space_id, scope) as { m: number };
    const insertItemAndLink = db.transaction(() => {
      db.prepare(
        `INSERT INTO items (id, space_id, kind, status, uploader_name, original_filename, ext, mime, storage_key, size_bytes, position, scope, note_id, created_at)
         VALUES (?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        itemId,
        upload.space_id,
        kind,
        upload.uploader_name,
        upload.filename,
        ext,
        upload.mime,
        storageKey,
        upload.size_bytes,
        maxPos.m + 1,
        scope,
        upload.note_id ?? null,
        now,
      );
      // Notiz-Anhang verknüpfen (falls die Notiz noch existiert).
      if (scope === 'note' && upload.note_id) {
        const note = db
          .prepare(`SELECT id FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
          .get(upload.note_id, upload.space_id) as { id: string } | undefined;
        if (note) {
          const maxAtt = db
            .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM note_attachments WHERE note_id = ?')
            .get(upload.note_id) as { m: number };
          db.prepare(
            'INSERT OR IGNORE INTO note_attachments (note_id, item_id, position) VALUES (?, ?, ?)',
          ).run(upload.note_id, itemId, maxAtt.m + 1);
          db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(now, upload.note_id);
        }
      }
      db.prepare(`UPDATE uploads SET status='completed', item_id=?, updated_at=? WHERE id=?`).run(
        itemId,
        now,
        upload.id,
      );
    });
    insertItemAndLink();

    // Temporäre Chunks aufräumen.
    fsp.rm(uploadDir(upload.id), { recursive: true, force: true }).catch(() => undefined);

    // Verarbeitung (Varianten/Transcode) einreihen – die Warteschlange begrenzt
    // die gleichzeitige Last (siehe services/process.ts).
    enqueueProcessing(itemId);

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as ItemRow;
    res.status(201).json({ item: publicItem(item) });
  }),
);

/** Upload abbrechen (Chunks verwerfen). */
router.delete(
  '/:id',
  requireSpace,
  asyncHandler(async (req, res) => {
    const upload = getUpload(req.params.id, req.spaceId!);
    if (upload.status === 'open') {
      getDb().prepare('DELETE FROM uploads WHERE id = ?').run(upload.id);
      await fsp.rm(uploadDir(upload.id), { recursive: true, force: true }).catch(() => undefined);
    }
    res.json({ ok: true });
  }),
);

export default router;
