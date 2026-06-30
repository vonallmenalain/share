import { getDb, ItemRow } from '../db';
import { processImage, variantPath } from '../lib/media';
import { processVideo } from '../lib/video';

/**
 * Verarbeitet ein frisch hochgeladenes Item: erzeugt Bild-Varianten bzw.
 * Video-Poster + Vorschau und aktualisiert Metadaten und Status in der DB.
 * Läuft asynchron nach Abschluss des Uploads; das Frontend pollt den Status.
 */
export async function processItem(itemId: string): Promise<void> {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as ItemRow | undefined;
  if (!item) return;

  const originalPath = variantPath('original', item.storage_key, item.ext);

  try {
    if (item.kind === 'photo') {
      const r = await processImage(originalPath, item.storage_key);
      db.prepare(
        `UPDATE items SET status='ready', width=?, height=?, taken_at=COALESCE(?, taken_at) WHERE id=?`,
      ).run(r.width || null, r.height || null, r.takenAt, itemId);
    } else {
      const r = await processVideo(originalPath, item.storage_key);
      db.prepare(
        `UPDATE items SET status='ready', width=?, height=?, duration=?, taken_at=COALESCE(?, taken_at) WHERE id=?`,
      ).run(r.width, r.height, r.duration, r.takenAt, itemId);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[process] failed for item', itemId, err);
    db.prepare(`UPDATE items SET status='failed' WHERE id=?`).run(itemId);
  }
}

const KNOWN_IMAGE = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'tif', 'heic', 'heif', 'avif', 'bmp'];
const KNOWN_VIDEO = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp', 'hevc', 'mpg', 'mpeg', 'wmv', 'flv'];

export function detectKind(mime: string, ext: string): 'photo' | 'video' {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'photo';
  if (m.startsWith('video/')) return 'video';
  const e = ext.toLowerCase();
  if (KNOWN_VIDEO.includes(e)) return 'video';
  if (KNOWN_IMAGE.includes(e)) return 'photo';
  // Fallback: als Foto behandeln.
  return 'photo';
}

export function extFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return 'bin';
  return filename
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
}
