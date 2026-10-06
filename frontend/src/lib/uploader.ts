import { API_BASE, DocumentItem, Item } from '../api/client';

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
 *  welche Chunks bereits auf dem Server liegen. Mit `adminKey` darf auch in
 *  Bereichen mit Upload-Sperre hochgeladen werden (nur Administrator). */
export async function createSession(
  token: string,
  file: File,
  uploaderName: string,
  signal?: AbortSignal,
  extra?: { scope?: 'gallery' | 'note' | 'document'; noteId?: string; adminKey?: string },
): Promise<CreateSessionResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (extra?.adminKey) headers['X-Admin-Key'] = extra.adminKey;
  return withRetry(
    async () => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/uploads`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filename: file.name,
            mime: file.type || 'application/octet-stream',
            size: file.size,
            uploaderName,
            ...(extra?.scope ? { scope: extra.scope } : {}),
            ...(extra?.noteId ? { noteId: extra.noteId } : {}),
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

/**
 * Lädt ein Bild als Notiz-Anhang hoch (voller, fortsetzbarer Chunk-Upload über
 * dieselbe Logik wie die Galerie). Gibt das (ggf. noch in Verarbeitung
 * befindliche) Item zurück.
 */
export async function uploadNoteImage(
  token: string,
  noteId: string,
  file: File,
  uploaderName: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Item> {
  const session = await createSession(token, file, uploaderName, signal, {
    scope: 'note',
    noteId,
  });
  const { chunkSize, totalChunks } = session;
  const received = new Set(session.received);
  let done = received.size;
  for (let index = 0; index < totalChunks; index++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (received.has(index)) continue;
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);
    await putChunk(token, session.uploadId, index, blob, () => undefined, signal);
    done++;
    onProgress?.(done / totalChunks);
  }
  return completeUpload(token, session.uploadId, signal);
}

/**
 * Lädt eine Datei ins Dokumente-Modul hoch (derselbe fortsetzbare
 * Chunk-Upload wie bei der Galerie). `onProgress` meldet die bereits
 * übertragenen Bytes. Dokumente sind nach dem Abschluss sofort verfügbar –
 * es gibt keine Verarbeitung, auf die gewartet werden müsste.
 */
export async function uploadDocument(
  token: string,
  file: File,
  uploaderName: string,
  opts: { adminKey?: string; onProgress?: (loadedBytes: number) => void; signal?: AbortSignal } = {},
): Promise<DocumentItem> {
  const { adminKey, onProgress, signal } = opts;
  // 409 = Server meldet fehlende Chunks: Ein neuer Durchgang setzt die
  // Session fort und lädt nur den fehlenden Rest nach.
  for (let attempt = 0; ; attempt++) {
    try {
      const session = await createSession(token, file, uploaderName, signal, {
        scope: 'document',
        adminKey,
      });
      const { chunkSize, totalChunks } = session;
      const received = new Set(session.received);
      const chunkLength = (index: number) =>
        Math.min(chunkSize, file.size - index * chunkSize);
      let done = 0;
      for (const index of received) done += chunkLength(index);
      onProgress?.(done);
      for (let index = 0; index < totalChunks; index++) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (received.has(index)) continue;
        const start = index * chunkSize;
        const blob = file.slice(start, start + chunkLength(index));
        const base = done;
        await putChunk(token, session.uploadId, index, blob, (loaded) => onProgress?.(base + loaded), signal);
        done += chunkLength(index);
        onProgress?.(done);
      }
      const payload = await completeUploadPayload(token, session.uploadId, signal);
      if (!payload.document) throw new UploadError('Unerwartete Antwort des Servers.');
      return payload.document;
    } catch (err) {
      if (attempt < 2 && err instanceof UploadError && err.status === 409) continue;
      throw err;
    }
  }
}

export async function completeUpload(
  token: string,
  uploadId: string,
  signal?: AbortSignal,
): Promise<Item> {
  return (await completeUploadPayload(token, uploadId, signal)).item;
}

/** Schliesst einen Upload ab; Dokumente kommen zusätzlich im Dokument-Format zurück. */
async function completeUploadPayload(
  token: string,
  uploadId: string,
  signal?: AbortSignal,
): Promise<{ item: Item; document?: DocumentItem }> {
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
      return (await res.json()) as { item: Item; document?: DocumentItem };
    },
    { attempts: 3, signal },
  );
}
