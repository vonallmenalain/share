import { Item, fileUrl } from '../api/client';

/**
 * Teilen über das native Teilen-Menü des Geräts (Web Share API). Damit lassen
 * sich Fotos/Videos an alle installierten Apps und Kanäle des Handys senden
 * (WhatsApp, Fotos, Mail, AirDrop, …). Wird von den meisten mobilen Browsern
 * (iOS Safari, Android Chrome) unterstützt; Desktop-Browser können oft nur
 * Text/URLs, aber keine Dateien teilen – dafür gibt es einen Download-Fallback.
 */

export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

async function fetchAsFile(item: Item, token: string): Promise<File> {
  const res = await fetch(fileUrl(`/files/original/${item.id}`, token));
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}).`);
  const blob = await res.blob();
  const type = blob.type || item.mime || 'application/octet-stream';
  return new File([blob], item.filename, { type });
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'error';

/**
 * Versucht, die übergebenen Medien als Original-Dateien zu teilen.
 * Gibt zurück, was passiert ist – die aufrufende Stelle entscheidet, ob z. B.
 * bei „unsupported" ein Download-Fallback greift.
 */
export async function shareItems(items: Item[], token: string): Promise<ShareOutcome> {
  if (items.length === 0) return 'error';
  if (!canShare()) return 'unsupported';

  let files: File[];
  try {
    files = await Promise.all(items.map((i) => fetchAsFile(i, token)));
  } catch {
    return 'error';
  }

  const data: ShareData = { files };
  // Manche Browser können teilen, aber keine Dateien (nur Text/URL).
  if (typeof navigator.canShare === 'function' && !navigator.canShare(data)) {
    return 'unsupported';
  }

  try {
    await navigator.share(data);
    return 'shared';
  } catch (err) {
    // Abbruch durch die Nutzer:in im Teilen-Menü ist kein Fehler.
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    return 'error';
  }
}
