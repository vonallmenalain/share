import { API_BASE, Item } from '../api/client';

export interface CreateSessionResult {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  received: number[];
}

/** Legt eine Upload-Session an (oder setzt eine offene fort) und liefert,
 *  welche Chunks bereits auf dem Server liegen. */
export async function createSession(
  token: string,
  file: File,
  uploaderName: string,
): Promise<CreateSessionResult> {
  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      uploaderName,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'Upload konnte nicht gestartet werden.');
  }
  return (await res.json()) as CreateSessionResult;
}

/** Lädt einen einzelnen Chunk hoch (XHR, damit der Fortschritt sichtbar ist). */
export function putChunk(
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

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let msg = `Fehler ${xhr.status}`;
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Hochladen.'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(blob);
  });
}

export async function completeUpload(token: string, uploadId: string): Promise<Item> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'Abschluss fehlgeschlagen.');
  }
  const data = (await res.json()) as { item: Item };
  return data.item;
}
