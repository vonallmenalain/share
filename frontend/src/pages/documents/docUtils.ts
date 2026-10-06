import { DocType, DocumentItem, fileUrl } from '../../api/client';
import { formatBytes } from '../../lib/format';

/** Dokumenttypen, die in der Ansicht (PDF/Bild/Video) durchgeblättert werden. */
export const VIEWABLE: ReadonlySet<DocType> = new Set<DocType>(['pdf', 'image', 'video']);

/** Angezeigter Titel: Dateiname ohne Endung („01 Ave Maria.pdf" → „01 Ave Maria"). */
export function docTitle(doc: Pick<DocumentItem, 'name'>): string {
  const dot = doc.name.lastIndexOf('.');
  return dot > 0 ? doc.name.slice(0, dot) : doc.name;
}

/** Spielzeit als „3:05" bzw. „1:02:03". */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Kurze Zusatzinfo in der Liste: Dauer bei Musik, sonst Typ + Grösse. */
export function docMeta(doc: DocumentItem): string {
  if (doc.docType === 'audio' && doc.duration) return formatClock(doc.duration);
  const ext = (doc.ext || '').toUpperCase();
  const label = doc.docType === 'pdf' ? 'PDF' : ext && ext !== 'BIN' ? ext : 'Datei';
  return `${label} · ${formatBytes(doc.sizeBytes)}`;
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Natürliche Sortierung nach Dateinamen („2 …" vor „10 …"). */
export function sortFilesByName(files: File[]): File[] {
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}

export function viewUrl(doc: Pick<DocumentItem, 'id'>, token: string): string {
  return fileUrl(`/files/view/${doc.id}`, token);
}

export function downloadUrl(doc: Pick<DocumentItem, 'id'>, token: string): string {
  return fileUrl(`/files/original/${doc.id}`, token);
}

/** Alle Dokumente des Bereichs als ZIP („Alles herunterladen"). */
export function zipUrl(token: string): string {
  return fileUrl('/api/documents/zip', token);
}

// ---- PDF-Bytes zwischenspeichern ------------------------------------------
// Beim Blättern sollen PDFs ohne erneuten Download sofort erscheinen. Die
// zuletzt verwendeten (und die vorab geladenen Nachbar-)PDFs bleiben daher im
// Speicher – begrenzt nach Anzahl und Grösse, damit auch grosse, gescannte
// PDFs auf dem Handy keinen Speicherengpass auslösen.

const MAX_CACHED = 8;
const MAX_CACHED_BYTES = 80 * 1024 * 1024;
/** Nachbarn nur vorab laden, wenn sie nicht zu gross sind (mobile Daten). */
const MAX_PREFETCH_BYTES = 15 * 1024 * 1024;

interface CacheEntry {
  promise: Promise<ArrayBuffer>;
  /** Grösse in Bytes, sobald geladen. */
  size: number;
}

const pdfCache = new Map<string, CacheEntry>();

/** Älteste Einträge entfernen, bis Anzahl und Grösse wieder im Rahmen sind. */
function evict(keep: string) {
  let total = 0;
  for (const entry of pdfCache.values()) total += entry.size;
  for (const [id, entry] of pdfCache) {
    if (pdfCache.size <= MAX_CACHED && total <= MAX_CACHED_BYTES) break;
    if (id === keep) continue;
    pdfCache.delete(id);
    total -= entry.size;
  }
}

/** Lädt die Bytes eines PDFs (aus dem Zwischenspeicher, falls vorhanden). */
export function getPdfBytes(doc: Pick<DocumentItem, 'id'>, token: string): Promise<ArrayBuffer> {
  const cached = pdfCache.get(doc.id);
  if (cached) {
    // Als zuletzt verwendet markieren.
    pdfCache.delete(doc.id);
    pdfCache.set(doc.id, cached);
    return cached.promise;
  }
  const entry: CacheEntry = {
    size: 0,
    promise: fetch(viewUrl(doc, token)).then((res) => {
      if (!res.ok) throw new Error(`PDF konnte nicht geladen werden (${res.status}).`);
      return res.arrayBuffer();
    }),
  };
  pdfCache.set(doc.id, entry);
  entry.promise.then(
    (buffer) => {
      entry.size = buffer.byteLength;
      evict(doc.id);
    },
    () => {
      // Fehlgeschlagene Downloads nicht merken, damit ein neuer Versuch möglich ist.
      if (pdfCache.get(doc.id) === entry) pdfCache.delete(doc.id);
    },
  );
  evict(doc.id);
  return entry.promise;
}

/** Lädt ein PDF schon im Hintergrund, damit es beim Weiterblättern sofort da ist. */
export function prefetchPdf(doc: DocumentItem | undefined, token: string): void {
  if (!doc || doc.docType !== 'pdf' || doc.sizeBytes > MAX_PREFETCH_BYTES) return;
  if (pdfCache.has(doc.id)) return;
  getPdfBytes(doc, token).catch(() => undefined);
}
