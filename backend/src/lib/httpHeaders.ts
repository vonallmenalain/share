/**
 * Content-Disposition-Header mit Dateinamen. Node lehnt Header-Werte mit
 * Zeichen ausserhalb von Latin-1 ab (z. B. „–" oder Emojis) – deshalb gibt es
 * einen ASCII-Ersatznamen plus den vollständigen Namen nach RFC 5987
 * (`filename*`), den alle aktuellen Browser bevorzugen.
 */
export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
