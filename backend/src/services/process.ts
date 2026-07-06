import sharp from 'sharp';
import { config } from '../config';
import { getDb, getMeta, setMeta, ItemRow } from '../db';
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

// ---- Verarbeitungs-Warteschlange -------------------------------------------
// Begrenzt die Anzahl gleichzeitig laufender processItem()-Jobs (sharp/ffmpeg
// sind CPU-/RAM-intensiv). Eingehende Uploads werden weiter sofort gespeichert;
// nur die nachgelagerte Verarbeitung wird gedrosselt, damit eine Upload-Spitze
// den Server nicht überlastet.

const pending: string[] = [];
const inFlight = new Set<string>();
let active = 0;

function drainQueue(): void {
  while (active < config.processing.concurrency && pending.length > 0) {
    const itemId = pending.shift()!;
    inFlight.delete(itemId);
    active++;
    void processItem(itemId)
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[process] job failed for item', itemId, err);
      })
      .finally(() => {
        active--;
        drainQueue();
      });
  }
}

/**
 * Reiht ein Item zur (nebenläufig begrenzten) Verarbeitung ein. Doppelte
 * Einträge desselben, noch nicht gestarteten Items werden ignoriert.
 */
export function enqueueProcessing(itemId: string): void {
  if (inFlight.has(itemId)) return;
  inFlight.add(itemId);
  pending.push(itemId);
  drainQueue();
}

/**
 * Reiht beim Start alle Items neu ein, die noch als "processing" markiert sind
 * (z. B. weil der Server während der Verarbeitung neu gestartet wurde). So
 * bleiben keine Medien dauerhaft im Verarbeitungs-Zustand hängen.
 */
export function requeueUnfinished(): number {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id FROM items WHERE status = 'processing'`)
    .all() as Array<{ id: string }>;
  for (const r of rows) enqueueProcessing(r.id);
  return rows.length;
}

const ORIENT_BACKFILL_KEY = 'oriented_dims_backfill_v1';

/**
 * Einmalige Korrektur bestehender Fotos: Früher wurden Breite/Höhe aus den rohen
 * Pixelmassen gespeichert, ohne die EXIF-Orientierung anzuwenden. Dadurch wurden
 * Hochformat-Fotos (Orientation 5–8) in der Galerie fälschlich als Querformat
 * dargestellt. Diese Funktion liest die Orientierung der Originale und tauscht
 * bei Bedarf Breite/Höhe. Läuft nur einmal (per app_meta-Flag) und im Hintergrund,
 * damit der Serverstart nicht blockiert wird.
 */
export async function backfillOrientedDims(): Promise<void> {
  if (getMeta(ORIENT_BACKFILL_KEY) === 'done') return;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, storage_key, ext, width, height FROM items WHERE kind = 'photo' AND status = 'ready'`,
    )
    .all() as Array<{
    id: string;
    storage_key: string;
    ext: string;
    width: number | null;
    height: number | null;
  }>;
  const update = db.prepare('UPDATE items SET width = ?, height = ? WHERE id = ?');
  let fixed = 0;
  for (const r of rows) {
    try {
      const meta = await sharp(variantPath('original', r.storage_key, r.ext), {
        failOn: 'none',
      }).metadata();
      const orientation = meta.orientation ?? 1;
      let w = meta.width ?? 0;
      let h = meta.height ?? 0;
      if (orientation >= 5 && orientation <= 8) [w, h] = [h, w];
      if (w && h && (w !== r.width || h !== r.height)) {
        update.run(w, h, r.id);
        fixed++;
      }
    } catch {
      /* ignore einzelne, nicht lesbare Dateien */
    }
  }
  setMeta(ORIENT_BACKFILL_KEY, 'done');
  if (fixed > 0) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] oriented dimensions corrected for ${fixed} photo(s)`);
  }
}
