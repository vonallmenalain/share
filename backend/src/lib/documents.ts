import { ApiError } from '../middleware/errors';

/**
 * Dokumente-Modul: reine Hilfsfunktionen (ohne Datenbank), damit sie sich
 * einfach testen lassen (siehe documents.test.ts).
 *
 * Dokumente werden NICHT verarbeitet (keine Vorschaubilder/Transcodes): Die
 * Originaldatei wird direkt angezeigt bzw. abgespielt. Welche Art von Anzeige
 * passt, bestimmt der Dokumenttyp:
 *
 * - `pdf`   → PDF-Ansicht im Browser (pdf.js), blättern zum nächsten Dokument
 * - `audio` → Player, spielt danach automatisch das nächste Audio ab
 * - `image` → Bildansicht
 * - `video` → Videoansicht (Original, ohne Transcode)
 * - `file`  → alles andere: nur herunterladen
 */
export type DocType = 'pdf' | 'audio' | 'image' | 'video' | 'file';

/**
 * Sichere Inline-Content-Types nach Dateiendung. NUR diese Typen werden direkt
 * im Browser angezeigt (Content-Disposition: inline). Alles andere – vor allem
 * HTML, SVG oder Skripte – wird ausschliesslich als Download ausgeliefert, damit
 * eine hochgeladene Datei auf der API-Domain nie als Webseite ausgeführt wird.
 */
const INLINE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  // Audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  // Bilder (bewusst ohne SVG – das kann Skripte enthalten)
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  // Video
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/**
 * Gängige (vom Browser gemeldete) MIME-Typen → sicherer Inline-Content-Type.
 * Greift nur, wenn die Dateiendung nichts hergibt (z. B. Datei ohne Endung).
 */
const INLINE_BY_MIME: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/aac': 'audio/aac',
  'audio/wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/ogg': 'audio/ogg',
  'audio/opus': 'audio/ogg',
  'audio/flac': 'audio/flac',
  'audio/x-flac': 'audio/flac',
  'audio/webm': 'audio/webm',
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
  'image/avif': 'image/avif',
  'image/bmp': 'image/bmp',
  'video/mp4': 'video/mp4',
  'video/webm': 'video/webm',
  'video/quicktime': 'video/quicktime',
};

/**
 * Content-Type, unter dem ein Dokument inline (im Browser) angezeigt werden
 * darf – oder null, wenn es nur als Download ausgeliefert werden soll.
 */
export function inlineContentType(ext: string, mime: string): string | null {
  const byExt = INLINE_BY_EXT[String(ext || '').toLowerCase()];
  if (byExt) return byExt;
  const m = String(mime || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  return INLINE_BY_MIME[m] ?? null;
}

/** Bestimmt die Art der Anzeige eines Dokuments (siehe DocType). */
export function docTypeOf(ext: string, mime: string): DocType {
  const ct = inlineContentType(ext, mime);
  if (!ct) return 'file';
  if (ct === 'application/pdf') return 'pdf';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  return 'file';
}

/** Endung inkl. Punkt (z. B. „.mp3"), oder leer, wenn der Name keine hat. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot);
}

/**
 * Neuer Dateiname beim Umbenennen eines Dokuments: Der angezeigte Name kann
 * frei gewählt werden, die ursprüngliche Endung bleibt aber immer erhalten
 * (sonst liesse sich die Datei nach dem Herunterladen nicht mehr öffnen).
 * Pfad- und Steuerzeichen werden entfernt.
 */
export function renameKeepingExtension(original: string, requested: unknown): string {
  const cleaned = String(requested ?? '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ext = extensionOf(original);
  let base = cleaned;
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) {
    base = base.slice(0, -ext.length).trim();
  }
  if (!base) throw new ApiError(400, 'Bitte einen Namen angeben.');
  if (base.length > 150) throw new ApiError(400, 'Der Name ist zu lang.');
  return `${base}${ext}`;
}
