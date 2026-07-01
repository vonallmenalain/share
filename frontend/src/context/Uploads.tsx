import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { api, API_BASE, Item } from '../api/client';
import { completeUpload, createSession, putChunk, UploadError } from '../lib/uploader';
import { fingerprintOf, pendingStore } from '../lib/storage';

const MAX_CONCURRENT = 3;
// Wie oft ein kompletter Datei-Upload (Session anlegen → Chunks → abschliessen)
// automatisch wiederholt wird, bevor er als Fehler gilt. Die einzelnen Chunks
// werden zusätzlich pro Chunk mehrfach versucht (siehe lib/uploader.ts).
const MAX_TASK_ATTEMPTS = 3;

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export type TaskStatus = 'queued' | 'uploading' | 'processing' | 'done' | 'error' | 'canceled';

export interface UploadTask {
  id: string;
  file: File;
  spaceId: string;
  token: string;
  uploaderName: string;
  fingerprint: string;
  status: TaskStatus;
  uploadedBytes: number;
  totalBytes: number;
  error?: string;
  uploadId?: string;
  item?: Item;
}

interface PublicTask extends Omit<UploadTask, 'file' | 'token'> {
  name: string;
}

interface UploadsContextValue {
  tasks: PublicTask[];
  addFiles: (
    files: File[],
    ctx: { spaceId: string; token: string; uploaderName: string },
  ) => void;
  retry: (id: string) => void;
  retryFailed: (spaceId: string) => void;
  cancel: (id: string) => void;
  clearFinished: (spaceId?: string) => void;
  subscribe: (cb: (item: Item) => void) => () => void;
  activeCount: number;
}

const UploadsContext = createContext<UploadsContextValue | null>(null);

export function useUploads(): UploadsContextValue {
  const ctx = useContext(UploadsContext);
  if (!ctx) throw new Error('useUploads must be used within UploadsProvider');
  return ctx;
}

let localId = 0;
const nextId = () => `t${Date.now()}_${localId++}`;

export function UploadsProvider({ children }: { children: ReactNode }) {
  // Die Task-Liste lebt bewusst in einer Ref statt in State: `patch()` wird
  // während eines Uploads sehr häufig aufgerufen (bei jedem Fortschritts-Tick
  // jedes Chunks) und darf dafür keine neuen Task-Objekte/Arrays allozieren.
  // `force` ist NUR ein Signal an React "bitte neu rendern" – der Zählerwert
  // selbst wird nirgends gelesen. Genau das ist beim Ableiten von `tasks`
  // weiter unten zu beachten (siehe Kommentar dort): sie dürfen nicht über
  // ein `useMemo` mit den Callback-Referenzen als Dependency berechnet werden,
  // sonst rendert die Komponente zwar neu, die Anzeige bleibt aber für immer
  // auf dem allerersten (meist leeren) Stand eingefroren – exakt der Grund,
  // wieso der Upload-Fortschritt bisher nie sichtbar war, obwohl der Upload
  // selbst einwandfrei lief.
  const tasksRef = useRef<UploadTask[]>([]);
  const abortRef = useRef<Map<string, AbortController>>(new Map());
  const subscribersRef = useRef<Set<(item: Item) => void>>(new Set());
  const [, force] = useState(0);

  const sync = useCallback(() => force((n) => n + 1), []);

  const notify = useCallback((item: Item) => {
    subscribersRef.current.forEach((cb) => {
      try {
        cb(item);
      } catch {
        /* ignore */
      }
    });
  }, []);

  const patch = useCallback(
    (id: string, changes: Partial<UploadTask>) => {
      const t = tasksRef.current.find((x) => x.id === id);
      if (!t) return;
      Object.assign(t, changes);
      sync();
    },
    [sync],
  );

  // Ein einzelner Versuch: Session anlegen/fortsetzen, fehlende Chunks senden,
  // abschliessen und auf die Verarbeitung warten. Wirft bei Fehlern; der
  // Aufrufer entscheidet über Wiederholung.
  const attemptUpload = useCallback(
    async (task: UploadTask, signal: AbortSignal) => {
      const session = await createSession(task.token, task.file, task.uploaderName, signal);
      patch(task.id, { uploadId: session.uploadId });

      pendingStore.upsert(task.spaceId, {
        fingerprint: task.fingerprint,
        uploadId: session.uploadId,
        filename: task.file.name,
        size: task.file.size,
        totalChunks: session.totalChunks,
        updatedAt: Date.now(),
      });

      const { chunkSize, totalChunks } = session;
      const received = new Set(session.received);

      let doneBytes = 0;
      for (const idx of received) {
        const start = idx * chunkSize;
        const end = Math.min(start + chunkSize, task.file.size);
        doneBytes += end - start;
      }
      patch(task.id, { uploadedBytes: doneBytes });

      for (let index = 0; index < totalChunks; index++) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        if (received.has(index)) continue;
        const start = index * chunkSize;
        const end = Math.min(start + chunkSize, task.file.size);
        const blob = task.file.slice(start, end);
        const base = doneBytes;
        await putChunk(
          task.token,
          session.uploadId,
          index,
          blob,
          (loaded) => patch(task.id, { uploadedBytes: base + loaded }),
          signal,
        );
        doneBytes += end - start;
        patch(task.id, { uploadedBytes: doneBytes });
      }

      patch(task.id, { status: 'processing', uploadedBytes: task.file.size });
      const item = await completeUpload(task.token, session.uploadId, signal);
      pendingStore.remove(task.spaceId, task.fingerprint);
      patch(task.id, { item });
      notify(item); // zeigt das (noch verarbeitende) Item in der Galerie an

      // Auf Fertigstellung der Verarbeitung warten.
      const ready = await pollUntilReady(task.token, item.id, signal);
      if (ready) notify(ready);
      patch(task.id, { status: 'done', item: ready ?? item });
    },
    [notify, patch],
  );

  const runTask = useCallback(
    async (task: UploadTask) => {
      const controller = new AbortController();
      abortRef.current.set(task.id, controller);
      patch(task.id, { status: 'uploading', error: undefined });

      try {
        let lastErr: unknown;
        for (let attempt = 0; attempt < MAX_TASK_ATTEMPTS; attempt++) {
          if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
          try {
            await attemptUpload(task, controller.signal);
            return; // Erfolg – Status wurde bereits auf 'done' gesetzt.
          } catch (err) {
            if (isAbortError(err)) throw err;
            lastErr = err;
            const retryable = err instanceof UploadError ? err.retryable : false;
            // 409 = Server meldet fehlende Chunks / falsche Grösse. Ein neuer
            // Versuch setzt die Session fort und lädt nur den fehlenden Rest neu.
            const isConflict = err instanceof UploadError && err.status === 409;
            const last = attempt === MAX_TASK_ATTEMPTS - 1;
            if ((retryable || isConflict) && !last) {
              patch(task.id, { status: 'uploading', error: undefined });
              await sleep(Math.min(8000, 1500 * 2 ** attempt), controller.signal);
              continue;
            }
            throw err;
          }
        }
        throw lastErr;
      } catch (err) {
        if (isAbortError(err)) {
          patch(task.id, { status: 'canceled' });
        } else {
          patch(task.id, {
            status: 'error',
            error: err instanceof Error ? err.message : 'Unbekannter Fehler',
          });
        }
      } finally {
        abortRef.current.delete(task.id);
        pump();
      }
    },
    [attemptUpload, patch],
  );

  const pump = useCallback(() => {
    const active = tasksRef.current.filter(
      (t) => t.status === 'uploading' || t.status === 'processing',
    ).length;
    let slots = MAX_CONCURRENT - active;
    if (slots <= 0) return;
    for (const t of tasksRef.current) {
      if (slots <= 0) break;
      if (t.status === 'queued') {
        slots--;
        void runTask(t);
      }
    }
  }, [runTask]);

  const addFiles = useCallback<UploadsContextValue['addFiles']>(
    (files, ctx) => {
      for (const file of files) {
        const fp = fingerprintOf(file);
        // Doppelte (gleiche Datei, noch aktiv) vermeiden.
        const dup = tasksRef.current.find(
          (t) =>
            t.fingerprint === fp &&
            t.spaceId === ctx.spaceId &&
            ['queued', 'uploading', 'processing', 'done'].includes(t.status),
        );
        if (dup) continue;
        tasksRef.current.push({
          id: nextId(),
          file,
          spaceId: ctx.spaceId,
          token: ctx.token,
          uploaderName: ctx.uploaderName,
          fingerprint: fp,
          status: 'queued',
          uploadedBytes: 0,
          totalBytes: file.size,
        });
      }
      sync();
      pump();
    },
    [pump, sync],
  );

  const retry = useCallback(
    (id: string) => {
      const t = tasksRef.current.find((x) => x.id === id);
      if (!t) return;
      if (t.status === 'error' || t.status === 'canceled') {
        t.status = 'queued';
        t.error = undefined;
        sync();
        pump();
      }
    },
    [pump, sync],
  );

  const retryFailed = useCallback(
    (spaceId: string) => {
      let changed = false;
      for (const t of tasksRef.current) {
        if (t.spaceId === spaceId && (t.status === 'error' || t.status === 'canceled')) {
          t.status = 'queued';
          t.error = undefined;
          changed = true;
        }
      }
      if (changed) {
        sync();
        pump();
      }
    },
    [pump, sync],
  );

  const cancel = useCallback(
    (id: string) => {
      const t = tasksRef.current.find((x) => x.id === id);
      if (!t) return;
      abortRef.current.get(id)?.abort();
      if (t.uploadId) {
        api(`/api/uploads/${t.uploadId}`, { method: 'DELETE', token: t.token }).catch(
          () => undefined,
        );
      }
      pendingStore.remove(t.spaceId, t.fingerprint);
      t.status = 'canceled';
      sync();
    },
    [sync],
  );

  const clearFinished = useCallback(
    (spaceId?: string) => {
      tasksRef.current = tasksRef.current.filter((t) => {
        if (spaceId && t.spaceId !== spaceId) return true;
        return !['done', 'canceled', 'error'].includes(t.status);
      });
      sync();
    },
    [sync],
  );

  const subscribe = useCallback((cb: (item: Item) => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  // Warnung beim Schliessen, falls noch Uploads laufen.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const active = tasksRef.current.some(
        (t) => t.status === 'uploading' || t.status === 'processing' || t.status === 'queued',
      );
      if (active) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Bewusst OHNE useMemo: `tasksRef.current` wird ausserhalb von React
  // mutiert (siehe patch()), daher gibt es keine Dependency, die "richtig"
  // wäre, um eine Neuberechnung auszulösen – jeder Versuch, das über die
  // Callback-Referenzen oder den `force`-Zähler zu memoisieren, führt dazu,
  // dass diese Liste beim erneuten Rendern nicht aktualisiert wird (siehe
  // Kommentar oben). Die Berechnung ist mit wenigen aktiven Uploads trivial
  // günstig, und UploadsProvider rendert ohnehin nur neu, wenn sync() nach
  // einer echten Änderung aufgerufen wurde – hier also bei jedem Render neu
  // aus der Ref lesen ist sowohl korrekt als auch günstig.
  const tasks: PublicTask[] = tasksRef.current.map((t) => ({
    id: t.id,
    spaceId: t.spaceId,
    uploaderName: t.uploaderName,
    fingerprint: t.fingerprint,
    status: t.status,
    uploadedBytes: t.uploadedBytes,
    totalBytes: t.totalBytes,
    error: t.error,
    uploadId: t.uploadId,
    item: t.item,
    name: t.file.name,
  }));
  const activeCount = tasks.filter((t) =>
    ['queued', 'uploading', 'processing'].includes(t.status),
  ).length;
  const value: UploadsContextValue = {
    tasks,
    addFiles,
    retry,
    retryFailed,
    cancel,
    clearFinished,
    subscribe,
    activeCount,
  };

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

async function pollUntilReady(
  token: string,
  itemId: string,
  signal: AbortSignal,
): Promise<Item | null> {
  // Bis zu ~5 Minuten auf die Verarbeitung warten (Videos können dauern).
  for (let i = 0; i < 150; i++) {
    if (signal.aborted) return null;
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await api<{ items: Item[] }>(
        `/api/items/status?ids=${encodeURIComponent(itemId)}`,
        { token },
      );
      const it = res.items[0];
      if (it && (it.status === 'ready' || it.status === 'failed')) return it;
    } catch {
      /* weiter pollen */
    }
  }
  return null;
}

export { API_BASE };
