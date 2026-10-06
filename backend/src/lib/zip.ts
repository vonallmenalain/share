import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import type { Response } from 'express';
import type { ItemRow } from '../db';
import { variantPath } from './media';
import { contentDisposition } from './httpHeaders';

/**
 * Dateiname eines ZIPs aus dem Namen des Bereichs, z. B. „Lieder DKA 2026.zip".
 * Zeichen, die Dateisysteme nicht mögen (/ \ : * ? " < > | und
 * Steuerzeichen), werden zu Leerzeichen.
 */
export function zipFileName(name: string | null | undefined, fallback: string): string {
  const base = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
  return `${base || fallback}.zip`;
}

/**
 * Name einer Datei im ZIP: der Originalname, bei Doppelungen mit einem Stück
 * der ID davor der Endung („Lied-ab12cd.mp3"). `used` sammelt die vergebenen
 * Namen.
 */
export function zipEntryName(item: Pick<ItemRow, 'id' | 'original_filename' | 'ext'>, used: Set<string>): string {
  let name = path.basename(item.original_filename) || `${item.id}.${item.ext}`;
  if (used.has(name)) {
    const dot = name.lastIndexOf('.');
    const tag = item.id.slice(0, 6);
    name = dot > 0 ? `${name.slice(0, dot)}-${tag}${name.slice(dot)}` : `${name}-${tag}`;
  }
  used.add(name);
  return name;
}

/**
 * Streamt die Originale als ZIP – auch für viele grosse Dateien
 * speicherschonend. Ohne Kompression: Fotos, Videos, Musik und PDFs sind
 * meist schon komprimiert, so bleibt das QNAP entlastet.
 */
export async function sendOriginalsZip(
  res: Response,
  items: ItemRow[],
  fileName: string,
): Promise<void> {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition('attachment', fileName));
  res.setHeader('Cache-Control', 'private, no-store');

  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[zip] error', err);
    res.destroy(err);
  });
  archive.pipe(res);

  const used = new Set<string>();
  for (const item of items) {
    const filePath = variantPath('original', item.storage_key, item.ext);
    if (!fs.existsSync(filePath)) continue;
    archive.file(filePath, { name: zipEntryName(item, used) });
  }
  await archive.finalize();
}
