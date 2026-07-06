export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Space-Access-Token (Bearer). */
  token?: string;
  /** Admin-Schlüssel (X-Admin-Key). */
  adminKey?: string;
  /** Anzeigename der aktuellen Person (X-Uploader-Name) – z. B. für Löschrechte. */
  uploaderName?: string;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.adminKey) headers['X-Admin-Key'] = opts.adminKey;
  if (opts.uploaderName) headers['X-Uploader-Name'] = encodeURIComponent(opts.uploaderName);

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
    signal: opts.signal,
  };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${API_BASE}${path}`, init);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const message =
      (isJson && (data as { error?: string }).error) || 'Es ist ein Fehler aufgetreten.';
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/** Baut eine absolute Datei-URL mit Access-Token im Query. */
export function fileUrl(path: string, token: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * Lädt ein angepasstes Vorschaubild (bereits zugeschnitten/rotiert) als rohe
 * Bild-Bytes hoch und gibt das aktualisierte Item zurück.
 */
export async function uploadThumb(
  itemId: string,
  blob: Blob,
  opts: { token: string; uploaderName?: string },
): Promise<Item> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    'Content-Type': blob.type || 'image/jpeg',
  };
  if (opts.uploaderName) headers['X-Uploader-Name'] = encodeURIComponent(opts.uploaderName);
  const res = await fetch(`${API_BASE}/api/items/${itemId}/thumb`, {
    method: 'POST',
    headers,
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error || 'Upload fehlgeschlagen.');
  }
  return (data as { item: Item }).item;
}

// ---- Typen -----------------------------------------------------------------

export interface Space {
  id: string;
  slug: string;
  name: string;
  hasPassword: boolean;
  createdAt: string;
  itemCount?: number;
  archivedCount?: number;
  deletedCount?: number;
}

export type ItemState = 'active' | 'archived' | 'deleted';

export interface Item {
  id: string;
  kind: 'photo' | 'video';
  status: 'processing' | 'ready' | 'failed';
  state: ItemState;
  stateBy: string | null;
  stateAt: string | null;
  uploaderName: string;
  filename: string;
  ext: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sizeBytes: number;
  takenAt: string | null;
  position: number;
  favorite: boolean;
  /** Zähler zum Cache-Busting, wenn das Vorschaubild angepasst wurde. */
  thumbVersion: number;
  /** Masse des (ggf. angepassten) Thumbnails – bestimmen das Kachel-Seitenverhältnis. */
  thumbW: number | null;
  thumbH: number | null;
  createdAt: string;
  hasPreview: boolean;
  hasPoster: boolean;
}
