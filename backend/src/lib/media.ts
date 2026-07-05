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
 * Erzeugt aus dem (bereits gespeicherten) Original ein Galerie-Thumbnail und
 * eine grössere Vorschau. EXIF-Orientierung wird berücksichtigt; das Original
 * bleibt unverändert.
 */
export async function processImage(originalPath: string, storageKey: string): Promise<ImageResult> {
  const buffer = await fsp.readFile(originalPath);
  const image = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const takenAt = await parseExifDate(buffer);

  const thumbDest = variantPath('thumb', storageKey);
  await ensureDir(thumbDest);
  await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(config.images.thumbMax, config.images.thumbMax, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: config.images.thumbQuality, mozjpeg: true })
    .toFile(thumbDest);

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
