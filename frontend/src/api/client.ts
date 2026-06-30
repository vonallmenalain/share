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
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.adminKey) headers['X-Admin-Key'] = opts.adminKey;

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

// ---- Typen -----------------------------------------------------------------

export interface Space {
  id: string;
  slug: string;
  name: string;
  hasPassword: boolean;
  createdAt: string;
  itemCount?: number;
}

export interface Item {
  id: string;
  kind: 'photo' | 'video';
  status: 'processing' | 'ready' | 'failed';
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
  createdAt: string;
  hasPreview: boolean;
  hasPoster: boolean;
}
