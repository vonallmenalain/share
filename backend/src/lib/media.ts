import sharp from 'sharp';
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

  const takenAt = parseExifDate(meta);

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

function parseExifDate(meta: sharp.Metadata): string | null {
  // sharp exposes EXIF only as a raw buffer; rather than pulling in an EXIF
  // parser we keep this best-effort: scan the buffer for a DateTimeOriginal-like
  // string "YYYY:MM:DD HH:MM:SS". Falls back to null when not found.
  try {
    const exif = meta.exif;
    if (!exif) return null;
    const text = exif.toString('latin1');
    const m = text.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
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
