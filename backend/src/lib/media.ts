import sharp from 'sharp';
import exifr from 'exifr';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config, paths } from '../config';

export type Variant = 'original' | 'thumb' | 'preview' | 'poster' | 'video-preview';

function baseDir(variant: Variant): string {
  switch (variant) {
    case 'original':
      return paths.originals();
    case 'thumb':
      return paths.thumbs();
    case 'preview':
      return paths.previews();
    case 'poster':
      return paths.posters();
    case 'video-preview':
      return paths.videoPreviews();
  }
}

/**
 * Speicherpfad einer Variante. `storageKey` ist "<spaceId>/<itemId>", so liegen
 * alle Dateien eines Bereichs übersichtlich in einem Unterordner.
 */
export function variantPath(variant: Variant, storageKey: string, ext = 'jpg'): string {
  const e = variant === 'original' ? ext : variant === 'video-preview' ? 'mp4' : 'jpg';
  return path.join(baseDir(variant), `${storageKey}.${e}`);
}

async function ensureDir(filePath: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

export interface ImageResult {
  width: number;
  height: number;
  takenAt: string | null;
}

/**
 * Liefert die sichtbaren (an der EXIF-Orientierung ausgerichteten) Masse eines
 * Bildes. `sharp(...).metadata()` gibt die rohen Pixelmasse zurück, OHNE die
 * EXIF-Orientierung anzuwenden. Bei Hochformat-Fotos, die als Querformat-Pixel
 * mit einem Rotations-Flag gespeichert sind (Orientation 5–8), müssen Breite
 * und Höhe getauscht werden – sonst zeigt die Galerie ein Hochformat-Foto
 * fälschlich als Querformat-Kachel (mit einem schmalen Ausschnitt) an.
 */
function orientedSize(meta: sharp.Metadata): { width: number; height: number } {
  let width = meta.width ?? 0;
  let height = meta.height ?? 0;
  const orientation = meta.orientation ?? 1;
  if (orientation >= 5 && orientation <= 8) {
    [width, height] = [height, width];
  }
  return { width, height };
}

/**
 * Erzeugt aus dem (bereits gespeicherten) Original ein Galerie-Thumbnail und
 * eine grössere Vorschau. EXIF-Orientierung wird berücksichtigt; das Original
 * bleibt unverändert.
 */
export async function processImage(originalPath: string, storageKey: string): Promise<ImageResult> {
  const buffer = await fsp.readFile(originalPath);
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  const { width, height } = orientedSize(meta);

  const takenAt = await parseExifDate(buffer);

  await generateDefaultThumb(buffer, storageKey);

  const previewDest = variantPath('preview', storageKey);
  await ensureDir(previewDest);
  await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(config.images.previewMax, config.images.previewMax, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: config.images.previewQuality, mozjpeg: true })
    .toFile(previewDest);

  return { width, height, takenAt };
}

/**
 * Erzeugt das Standard-Thumbnail (ganzes Foto, EXIF-orientiert, „fit: inside").
 * Wird sowohl beim Upload als auch beim Zurücksetzen eines angepassten
 * Vorschaubilds verwendet. Gibt die tatsächlichen Masse des Thumbnails zurück.
 */
export async function generateDefaultThumb(
  buffer: Buffer,
  storageKey: string,
): Promise<{ width: number; height: number }> {
  const thumbDest = variantPath('thumb', storageKey);
  await ensureDir(thumbDest);
  const info = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(config.images.thumbMax, config.images.thumbMax, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: config.images.thumbQuality, mozjpeg: true })
    .toFile(thumbDest);
  return { width: info.width, height: info.height };
}

/** Stellt das Standard-Thumbnail eines Fotos aus dessen Original wieder her. */
export async function resetThumbFromOriginal(
  originalPath: string,
  storageKey: string,
): Promise<{ width: number; height: number }> {
  const buffer = await fsp.readFile(originalPath);
  return generateDefaultThumb(buffer, storageKey);
}

/**
 * Schreibt ein vom Client bereits zugeschnittenes/rotiertes Vorschaubild als
 * neues Thumbnail. Der übergebene Puffer wird zur Sicherheit erneut durch sharp
 * geführt (Validierung + einheitliches JPEG) und auf die Thumbnail-Maximalgrösse
 * begrenzt. Gibt die tatsächlichen Masse des gespeicherten Thumbnails zurück.
 */
export async function writeCustomThumb(
  buffer: Buffer,
  storageKey: string,
): Promise<{ width: number; height: number }> {
  const thumbDest = variantPath('thumb', storageKey);
  await ensureDir(thumbDest);
  const info = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(config.images.thumbMax, config.images.thumbMax, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: config.images.previewQuality, mozjpeg: true })
    .toFile(thumbDest);
  return { width: info.width, height: info.height };
}

/** Liest die (orientierten) Masse einer Bilddatei; null, wenn nicht lesbar. */
export async function readImageSize(
  filePath: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(filePath, { failOn: 'none' }).metadata();
    const { width, height } = orientedSize(meta);
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

/**
 * Ermittelt das Aufnahmedatum eines Fotos aus den EXIF-Metadaten. Wichtig:
 * `DateTimeOriginal` (Aufnahmezeitpunkt) hat Vorrang vor `CreateDate` und
 * `ModifyDate` – letzteres wird von vielen Apps/Diensten beim erneuten
 * Speichern (Bearbeiten, Komprimieren, Hochladen) aktualisiert und würde die
 * chronologische Sortierung sonst auf das Bearbeitungs- statt Aufnahmedatum
 * ausrichten.
 */
async function parseExifDate(buffer: Buffer): Promise<string | null> {
  try {
    const tags = await exifr.parse(buffer, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'],
    });
    const raw = tags?.DateTimeOriginal ?? tags?.CreateDate ?? tags?.ModifyDate;
    if (!raw) return null;
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    // EXIF-Zeitstempel sind lokale Wanduhrzeiten OHNE Zeitzoneninfo (z. B. „08:00“).
    // exifr baut daraus ein Date in der Zeitzone des Servers. Damit die gespeicherte
    // Zeit unabhängig von der Server-Zeitzone stets die reine Wanduhrzeit
    // widerspiegelt (08:00 bleibt 08:00), lesen wir die Komponenten ab und kodieren
    // sie als UTC. Das Frontend zeigt Foto-Zeiten entsprechend ohne Zeitzonen-
    // Umrechnung an – sonst würde die Uhrzeit je nach Betrachter-Zeitzone verrutschen.
    return new Date(
      Date.UTC(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
      ),
    ).toISOString();
  } catch {
    return null;
  }
}

export function fileExists(p: string): boolean {
  return fs.existsSync(p);
}

async function removeEmptyParents(filePath: string, root: string) {
  let dir = path.dirname(path.resolve(filePath));
  const r = path.resolve(root);
  while (dir !== r && dir.startsWith(r + path.sep)) {
    try {
      await fsp.rmdir(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
}

export async function deleteAllVariants(storageKey: string, ext: string) {
  const targets: Array<[Variant, string]> = [
    ['original', variantPath('original', storageKey, ext)],
    ['thumb', variantPath('thumb', storageKey)],
    ['preview', variantPath('preview', storageKey)],
    ['poster', variantPath('poster', storageKey)],
    ['video-preview', variantPath('video-preview', storageKey)],
  ];
  await Promise.all(
    targets.map(async ([variant, t]) => {
      try {
        await fsp.unlink(t);
      } catch {
        /* ignore missing */
      }
      await removeEmptyParents(t, baseDir(variant));
    }),
  );
}

/** Löscht alle Dateien eines ganzen Bereichs (beim Löschen des Space). */
export async function deleteSpaceStorage(spaceId: string) {
  if (!spaceId) return;
  const dirs = [
    paths.originals(),
    paths.thumbs(),
    paths.previews(),
    paths.posters(),
    paths.videoPreviews(),
  ];
  await Promise.all(
    dirs.map(async (base) => {
      try {
        await fsp.rm(path.join(base, spaceId), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }),
  );
}
