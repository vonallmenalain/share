import { API_BASE, Item } from '../api/client';

export interface CreateSessionResult {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  received: number[];
}

/** Fehler beim Upload. `retryable` markiert vorübergehende Fehler (Netzwerk,
 *  Timeout, Server 5xx), die ein automatischer Wiederholversuch beheben kann. */
export class UploadError extends Error {
  retryable: boolean;
  status?: number;
  constructor(message: string, opts: { retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = 'UploadError';
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
  }
}

// Pro Chunk: Zeit ohne Fortschritt, nach der die Anfrage abgebrochen und (sofern
// erlaubt) erneut versucht wird. Mobile Netze "hängen" sonst beliebig lange.
const CHUNK_STALL_TIMEOUT_MS = 90_000;
const MAX_CHUNK_ATTEMPTS = 5;

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Führt eine Aktion mehrfach aus und wiederholt sie bei vorübergehenden
 * Fehlern mit exponentiell wachsender Wartezeit. Abbrüche und endgültige
 * Fehler (z. B. 4xx) werden sofort weitergereicht.
 */
async function withRetry<T>(
  attempt: (tryIndex: number) => Promise<T>,
  opts: { attempts: number; signal?: AbortSignal },
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    try {
      return await attempt(i);
    } catch (err) {
      if (isAbort(err)) throw err;
      const retryable = err instanceof UploadError ? err.retryable : true;
      lastErr = err;
      if (!retryable || i === opts.attempts - 1) throw err;
      // 1s, 2s, 4s, 8s … (max. 15s) warten.
      const wait = Math.min(15_000, 1000 * 2 ** i);
      await delay(wait, opts.signal);
    }
  }
  throw lastErr;
}

/** Legt eine Upload-Session an (oder setzt eine offene fort) und liefert,
 *  welche Chunks bereits auf dem Server liegen. */
export async function createSession(
  token: string,
  file: File,
  uploaderName: string,
  signal?: AbortSignal,
): Promise<CreateSessionResult> {
  return withRetry(
    async () => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/uploads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            filename: file.name,
            mime: file.type || 'application/octet-stream',
            size: file.size,
            uploaderName,
          }),
          signal,
        });
      } catch (err) {
        if (isAbort(err)) throw err;
        throw new UploadError('Upload konnte nicht gestartet werden (Netzwerk).', {
          retryable: true,
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          (data as { error?: string }).error || 'Upload konnte nicht gestartet werden.';
        // 5xx / 429 dürfen wiederholt werden, 4xx nicht.
        throw new UploadError(msg, { retryable: res.status >= 500 || res.status === 429, status: res.status });
      }
      return (await res.json()) as CreateSessionResult;
    },
    { attempts: 4, signal },
  );
}

/** Lädt einen einzelnen Chunk hoch (XHR, damit der Fortschritt sichtbar ist).
 *  Bricht ab, wenn über längere Zeit kein Fortschritt mehr stattfindet. */
function putChunkOnce(
  token: string,
  uploadId: string,
  index: number,
  blob: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${API_BASE}/api/uploads/${uploadId}/chunks/${index}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    // Bricht ab, wenn der Upload zu lange ohne Aktivität hängt (mobile Netze).
    xhr.timeout = CHUNK_STALL_TIMEOUT_MS;

    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => xhr.abort();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let msg = `Fehler ${xhr.status}`;
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch {
          /* ignore */
        }
        // Server-Fehler (5xx) und Überlast (429) sind wiederholbar; 4xx nicht.
        reject(new UploadError(msg, { retryable: xhr.status >= 500 || xhr.status === 429, status: xhr.status }));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new UploadError('Netzwerkfehler beim Hochladen.', { retryable: true }));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new UploadError('Zeitüberschreitung beim Hochladen.', { retryable: true }));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    xhr.send(blob);
  });
}

/** Lädt einen Chunk hoch und wiederholt bei vorübergehenden Fehlern automatisch. */
export function putChunk(
  token: string,
  uploadId: string,
  index: number,
  blob: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return withRetry(
    () => {
      // Bei einem erneuten Versuch den Fortschritt dieses Chunks zurücksetzen,
      // damit die Anzeige nicht über 100 % springt.
      onProgress(0);
      return putChunkOnce(token, uploadId, index, blob, onProgress, signal);
    },
    { attempts: MAX_CHUNK_ATTEMPTS, signal },
  );
}

export async function completeUpload(
  token: string,
  uploadId: string,
  signal?: AbortSignal,
): Promise<Item> {
  return withRetry(
    async () => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/uploads/${uploadId}/complete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
      } catch (err) {
        if (isAbort(err)) throw err;
        throw new UploadError('Abschluss fehlgeschlagen (Netzwerk).', { retryable: true });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = (data as { error?: string }).error || 'Abschluss fehlgeschlagen.';
        // 409 = es fehlen Chunks / falsche Grösse → nicht hier wiederholen,
        // sondern der Aufrufer lädt die fehlenden Chunks erneut.
        throw new UploadError(msg, { retryable: res.status >= 500, status: res.status });
      }
      const data = (await res.json()) as { item: Item };
      return data.item;
    },
    { attempts: 3, signal },
  );
}
