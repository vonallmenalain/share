import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, DocumentItem } from '../../api/client';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import { uploadDocument } from '../../lib/uploader';
import { formatBytes } from '../../lib/format';
import { isDocumentsOnly, shareLink, spaceShareUrl } from '../../lib/spaceLinks';
import DocViewer from './DocViewer';
import { PlayerBar, useAudioPlayer } from './AudioPlayer';
import { VIEWABLE, docMeta, docTitle, downloadUrl, sortFilesByName } from './docUtils';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DocTypeBadge,
  DownloadIcon,
  EditIcon,
  LinkIcon,
  PlayIcon,
  PlayingBars,
  RestoreIcon,
  TrashIcon,
  UploadIcon,
} from './icons';

type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

interface UploadEntry {
  key: string;
  file: File;
  loaded: number;
  status: UploadStatus;
  error?: string;
}

let uploadKey = 0;

/**
 * Dokumente-Modul: eine schlichte Liste – PDFs (und andere Dokumente) oben,
 * Musik/Audio darunter. Ein Tippen auf ein PDF öffnet es sofort im Vollbild
 * (weiterblättern per Wischen oder Pfeil), ein Tippen auf ein Lied spielt es
 * sofort ab; danach läuft automatisch das nächste.
 *
 * Werkzeuge zum Hochladen, Sortieren, Umbenennen und Löschen sieht nur, wer
 * darf: ohne Upload-Sperre alle, mit Sperre nur der Administrator (Gerät mit
 * gespeichertem Admin-Schlüssel). Für alle anderen ist es ein reiner
 * Ansichtslink.
 */
export default function DocumentsPage() {
  const { slug, space, token, uploaderName, isAdmin, adminKey, canManage } =
    useSpaceSessionContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [docs, setDocs] = useState<DocumentItem[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [deletedDocs, setDeletedDocs] = useState<DocumentItem[]>([]);
  const [notice, setNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Laden ---------------------------------------------------------------
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api<{ documents: DocumentItem[] }>('/api/documents', { token });
      setDocs(res.documents);
      setLoadError('');
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Die Dateien konnten nicht geladen werden.',
      );
      setDocs((prev) => prev ?? []);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Titel des Browser-Tabs: nur der Name des Bereichs.
  useEffect(() => {
    if (!space?.name) return;
    const previous = document.title;
    document.title = space.name;
    return () => {
      document.title = previous;
    };
  }, [space?.name]);

  // ---- Abgeleitete Listen --------------------------------------------------
  const all = docs ?? [];
  const otherDocs = all.filter((d) => d.docType !== 'audio');
  const audioDocs = all.filter((d) => d.docType === 'audio');
  const viewDocs = otherDocs.filter((d) => VIEWABLE.has(d.docType));
  const showHeadings = otherDocs.length > 0 && audioDocs.length > 0;

  const player = useAudioPlayer(audioDocs, token, space?.name ?? '');

  // ---- Ansicht (PDF/Bild/Video) – geöffnet über ?doc=<id> -----------------
  // Über die URL, damit „Zurück" (Browser/Android) die Ansicht schliesst.
  const openId = searchParams.get('doc');
  const viewIndex = openId ? viewDocs.findIndex((d) => d.id === openId) : -1;
  const openedHere = useRef(false);
  useEffect(() => {
    if (!openId) openedHere.current = false;
  }, [openId]);

  const setDocParam = useCallback(
    (id: string | null, replace: boolean) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('doc', id);
          else next.delete('doc');
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const download = useCallback(
    (doc: DocumentItem) => {
      const a = document.createElement('a');
      a.href = downloadUrl(doc, token);
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [token],
  );

  const openDoc = (doc: DocumentItem) => {
    if (doc.docType === 'audio') {
      player.playOrToggle(doc.id);
    } else if (VIEWABLE.has(doc.docType)) {
      openedHere.current = true;
      setDocParam(doc.id, false);
    } else {
      download(doc);
    }
  };

  const closeViewer = useCallback(() => {
    if (openedHere.current) {
      openedHere.current = false;
      navigate(-1);
    } else {
      setDocParam(null, true);
    }
  }, [navigate, setDocParam]);

  const navigateViewer = useCallback(
    (index: number) => {
      const target = viewDocs[index];
      if (target) setDocParam(target.id, true);
    },
    [viewDocs, setDocParam],
  );

  // ---- Hochladen (nacheinander, damit die Reihenfolge stimmt) -------------
  const entriesRef = useRef<UploadEntry[]>([]);
  const [, setUploadTick] = useState(0);
  const tickPending = useRef(false);
  const rerenderUploads = useCallback(() => {
    if (tickPending.current) return;
    tickPending.current = true;
    requestAnimationFrame(() => {
      tickPending.current = false;
      setUploadTick((n) => n + 1);
    });
  }, []);
  const runningRef = useRef(false);

  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const entry = entriesRef.current.find((e) => e.status === 'queued');
        if (!entry) break;
        entry.status = 'uploading';
        entry.error = undefined;
        rerenderUploads();
        try {
          const doc = await uploadDocument(
            token,
            entry.file,
            uploaderName || (isAdmin ? 'Admin' : 'Gast'),
            {
              adminKey: adminKey || undefined,
              onProgress: (loaded) => {
                entry.loaded = loaded;
                rerenderUploads();
              },
            },
          );
          entry.status = 'done';
          entry.loaded = entry.file.size;
          setDocs((prev) => [...(prev ?? []).filter((d) => d.id !== doc.id), doc]);
        } catch (err) {
          entry.status = 'error';
          entry.error = err instanceof Error ? err.message : 'Hochladen fehlgeschlagen.';
        }
        rerenderUploads();
      }
    } finally {
      runningRef.current = false;
    }
  }, [token, uploaderName, isAdmin, adminKey, rerenderUploads]);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list || list.length === 0 || !canManage) return;
    for (const file of sortFilesByName(Array.from(list))) {
      entriesRef.current.push({ key: `u${uploadKey++}`, file, loaded: 0, status: 'queued' });
    }
    rerenderUploads();
    void runQueue();
  };

  const entries = entriesRef.current;
  const uploading = entries.some((e) => e.status === 'queued' || e.status === 'uploading');
  const uploadErrors = entries.filter((e) => e.status === 'error').length;
  const uploadDone = entries.filter((e) => e.status === 'done').length;

  // Warnen, wenn die Seite während eines Uploads geschlossen wird.
  useEffect(() => {
    if (!uploading) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [uploading]);

  // Neue Dateien anderer Personen sehen (nur ohne Upload-Sperre relevant) –
  // aber nicht mitten im Bearbeiten oder Hochladen.
  useEffect(() => {
    if (!token || editing || uploading) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [token, editing, uploading, load]);

  // ---- Bearbeiten ----------------------------------------------------------
  const authOpts = {
    token,
    adminKey: adminKey || undefined,
    uploaderName: uploaderName || undefined,
  };

  const loadDeleted = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await api<{ documents: DocumentItem[] }>('/api/documents/deleted', {
        token,
        adminKey,
      });
      setDeletedDocs(res.documents);
    } catch {
      setDeletedDocs([]);
    }
  }, [isAdmin, token, adminKey]);

  useEffect(() => {
    if (editing) void loadDeleted();
  }, [editing, loadDeleted]);

  const moveDoc = async (doc: DocumentItem, delta: -1 | 1) => {
    const isAudio = doc.docType === 'audio';
    const section = isAudio ? audioDocs : otherDocs;
    const i = section.findIndex((d) => d.id === doc.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= section.length) return;
    const moved = [...section];
    [moved[i], moved[j]] = [moved[j], moved[i]];
    const order = isAudio ? [...otherDocs, ...moved] : [...moved, ...audioDocs];
    setDocs(order.map((d, position) => ({ ...d, position })));
    try {
      await api('/api/documents/order', {
        method: 'PATCH',
        body: { order: order.map((d) => d.id) },
        ...authOpts,
      });
    } catch (err) {
      alert(
        err instanceof Error ? err.message : 'Die Reihenfolge konnte nicht gespeichert werden.',
      );
      void load();
    }
  };

  const renameDoc = async (doc: DocumentItem) => {
    const input = window.prompt('Neuer Name:', docTitle(doc));
    const name = input?.trim();
    if (!name || name === docTitle(doc)) return;
    try {
      const res = await api<{ document: DocumentItem }>(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        body: { name },
        ...authOpts,
      });
      setDocs((prev) => prev?.map((d) => (d.id === doc.id ? res.document : d)) ?? prev);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Umbenennen fehlgeschlagen.');
    }
  };

  const deleteDoc = async (doc: DocumentItem) => {
    if (!window.confirm(`„${docTitle(doc)}" löschen? Die Datei verschwindet aus der Liste.`))
      return;
    try {
      await api(`/api/documents/${doc.id}/delete`, { method: 'POST', ...authOpts });
      if (player.currentId === doc.id) player.stop();
      setDocs((prev) => prev?.filter((d) => d.id !== doc.id) ?? prev);
      void loadDeleted();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  const restoreDoc = async (doc: DocumentItem) => {
    if (!space) return;
    try {
      await api(`/api/spaces/${space.id}/items/${doc.id}/state`, {
        method: 'PATCH',
        adminKey,
        body: { state: 'active' },
      });
      setDeletedDocs((prev) => prev.filter((d) => d.id !== doc.id));
      void load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Wiederherstellen fehlgeschlagen.');
    }
  };

  const purgeDoc = async (doc: DocumentItem) => {
    if (!space) return;
    if (
      !window.confirm(
        `„${docTitle(doc)}" endgültig löschen? Das lässt sich nicht rückgängig machen.`,
      )
    )
      return;
    try {
      await api(`/api/spaces/${space.id}/items/${doc.id}`, { method: 'DELETE', adminKey });
      setDeletedDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  const shareSpace = async () => {
    if (!space) return;
    // Reine Dokumente-Bereiche zeigen ihre Dokumente direkt unter /s/<slug>.
    const url = isDocumentsOnly(space.modules)
      ? spaceShareUrl(slug)
      : `${spaceShareUrl(slug)}/docs`;
    const outcome = await shareLink(url, space.name);
    if (outcome === 'copied') {
      setNotice('Link kopiert – du kannst ihn jetzt z. B. in WhatsApp einfügen.');
      window.setTimeout(() => setNotice(''), 3500);
    }
  };

  // ---- Darstellung ---------------------------------------------------------
  const renderRow = (doc: DocumentItem, section: DocumentItem[]) => {
    const isCurrent = player.currentId === doc.id;
    const pos = section.findIndex((d) => d.id === doc.id);
    const title = docTitle(doc);
    return (
      <li key={doc.id} className={`doc-row${isCurrent ? ' current' : ''}`}>
        <button
          type="button"
          className="doc-row-main"
          onClick={() => openDoc(doc)}
          aria-label={
            doc.docType === 'audio'
              ? `${title} ${isCurrent && player.playing ? 'pausieren' : 'abspielen'}`
              : doc.docType === 'file'
                ? `${title} herunterladen`
                : `${title} öffnen`
          }
        >
          {doc.docType === 'audio' && isCurrent ? (
            <span className="doc-badge doc-badge-audio doc-badge-active" aria-hidden="true">
              {player.playing ? <PlayingBars /> : <PlayIcon size={16} />}
            </span>
          ) : (
            <DocTypeBadge type={doc.docType} />
          )}
          <span className="doc-row-text">
            <span className="doc-row-name">{title}</span>
            <span className="doc-row-meta">{docMeta(doc)}</span>
          </span>
        </button>
        {editing ? (
          <span className="doc-row-edit">
            <button
              type="button"
              className="doc-icon-btn"
              onClick={() => void moveDoc(doc, -1)}
              disabled={pos <= 0}
              aria-label="Nach oben"
              title="Nach oben"
            >
              <ArrowUpIcon size={18} />
            </button>
            <button
              type="button"
              className="doc-icon-btn"
              onClick={() => void moveDoc(doc, 1)}
              disabled={pos >= section.length - 1}
              aria-label="Nach unten"
              title="Nach unten"
            >
              <ArrowDownIcon size={18} />
            </button>
            <button
              type="button"
              className="doc-icon-btn"
              onClick={() => void renameDoc(doc)}
              aria-label="Umbenennen"
              title="Umbenennen"
            >
              <EditIcon size={17} />
            </button>
            <button
              type="button"
              className="doc-icon-btn danger"
              onClick={() => void deleteDoc(doc)}
              aria-label="Löschen"
              title="Löschen"
            >
              <TrashIcon size={17} />
            </button>
          </span>
        ) : (
          <a
            className="doc-icon-btn doc-row-dl"
            href={downloadUrl(doc, token)}
            download={doc.name}
            aria-label={`${title} herunterladen`}
            title="Herunterladen"
          >
            <DownloadIcon size={18} />
          </a>
        )}
      </li>
    );
  };

  const loading = docs === null;
  const empty = !loading && all.length === 0;

  return (
    <div
      className={`container doc-page${player.currentId ? ' with-player' : ''}${viewIndex >= 0 ? ' viewer-open' : ''}${editing ? ' editing' : ''}`}
      onDragOver={(e) => {
        if (!canManage) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!canManage) return;
        e.preventDefault();
        setDragOver(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {/* Ein einziges <audio>-Element für die ganze Wiedergabeliste. */}
      <audio ref={player.audioRef} preload="none" />

      <header className="doc-head">
        <h1 className="space-title">{space?.name}</h1>
      </header>

      {canManage && (
        <div className="doc-tools">
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
            <UploadIcon size={18} />
            Dateien hinzufügen
          </button>
          {all.length > 0 && (
            <button
              className={`btn${editing ? ' btn-active' : ''}`}
              onClick={() => setEditing((v) => !v)}
            >
              <EditIcon size={17} />
              {editing ? 'Fertig' : 'Bearbeiten'}
            </button>
          )}
          {isAdmin && (
            <button className="btn" onClick={() => void shareSpace()}>
              <LinkIcon size={17} />
              Link teilen
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {canManage && (
        <p className="doc-tools-hint">
          {space?.uploadsLocked
            ? '🔒 Nur du als Admin siehst diese Werkzeuge. Alle anderen können nur ansehen, anhören und herunterladen.'
            : 'Alle mit dem Link können Dateien hinzufügen und bearbeiten.'}
        </p>
      )}

      {notice && <div className="ok-box">{notice}</div>}

      {entries.length > 0 && (
        <div className="doc-uploads">
          <div className="doc-uploads-head">
            <strong>
              {uploading
                ? `Lade hoch … ${uploadDone} von ${entries.length}`
                : uploadErrors > 0
                  ? `${uploadErrors} ${uploadErrors === 1 ? 'Datei' : 'Dateien'} fehlgeschlagen`
                  : `${uploadDone} ${uploadDone === 1 ? 'Datei' : 'Dateien'} hochgeladen ✓`}
            </strong>
            <span className="spacer" />
            {!uploading && uploadErrors > 0 && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  for (const e of entriesRef.current) {
                    if (e.status === 'error') {
                      e.status = 'queued';
                      e.loaded = 0;
                    }
                  }
                  rerenderUploads();
                  void runQueue();
                }}
              >
                Erneut versuchen
              </button>
            )}
            {!uploading && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  entriesRef.current = [];
                  rerenderUploads();
                }}
              >
                Ausblenden
              </button>
            )}
          </div>
          {/* Nach erfolgreichem Abschluss genügt die Zusammenfassung. */}
          {(uploading || uploadErrors > 0) && (
            <ul className="doc-upload-list">
              {entries.map((e) => {
                const pct =
                  e.status === 'done'
                    ? 100
                    : e.file.size
                      ? Math.min(99, Math.round((e.loaded / e.file.size) * 100))
                      : 0;
                return (
                  <li key={e.key} className={`doc-upload doc-upload-${e.status}`}>
                    <div className="doc-upload-line">
                      <span className="doc-upload-name">{e.file.name}</span>
                      <span className="doc-upload-state">
                        {e.status === 'queued'
                          ? 'wartet'
                          : e.status === 'uploading'
                            ? `${pct}%`
                            : e.status === 'done'
                              ? '✓'
                              : 'Fehler'}
                      </span>
                    </div>
                    <div className="bar">
                      <i
                        style={{
                          width: `${pct}%`,
                          background:
                            e.status === 'error'
                              ? 'var(--danger)'
                              : e.status === 'done'
                                ? 'var(--ok)'
                                : 'var(--brand)',
                        }}
                      />
                    </div>
                    {e.status === 'error' && <div className="doc-upload-error">{e.error}</div>}
                    {e.status !== 'error' && e.status !== 'done' && (
                      <div className="doc-upload-size">{formatBytes(e.file.size)}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {loadError && <div className="error-box">{loadError}</div>}

      {loading ? (
        <div className="doc-loading">
          <span className="spinner lg" />
        </div>
      ) : empty ? (
        canManage ? (
          <button
            type="button"
            className={`dropzone doc-dropzone${dragOver ? ' over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon size={30} />
            <strong>Noch keine Dateien</strong>
            <span className="hint">
              Tippe hier, um Dateien auszuwählen (z. B. PDFs und MP3s) – oder ziehe sie hierher.
            </span>
          </button>
        ) : (
          <div className="empty-hint">Hier wurden noch keine Dateien geteilt.</div>
        )
      ) : (
        <>
          {otherDocs.length > 0 && (
            <section className="doc-section" aria-label="Dokumente">
              {showHeadings && <h2 className="doc-section-title">Dokumente</h2>}
              <ul className="doc-list">{otherDocs.map((d) => renderRow(d, otherDocs))}</ul>
            </section>
          )}
          {audioDocs.length > 0 && (
            <section className="doc-section" aria-label="Audio">
              {showHeadings && <h2 className="doc-section-title">Audio</h2>}
              <ul className="doc-list">{audioDocs.map((d) => renderRow(d, audioDocs))}</ul>
            </section>
          )}
        </>
      )}

      {editing && isAdmin && deletedDocs.length > 0 && (
        <section className="doc-section doc-deleted" aria-label="Gelöscht">
          <h2 className="doc-section-title">Gelöscht (nur für dich sichtbar)</h2>
          <ul className="doc-list">
            {deletedDocs.map((doc) => (
              <li key={doc.id} className="doc-row deleted">
                <span className="doc-row-main" aria-disabled="true">
                  <DocTypeBadge type={doc.docType} />
                  <span className="doc-row-text">
                    <span className="doc-row-name">{docTitle(doc)}</span>
                    <span className="doc-row-meta">{docMeta(doc)}</span>
                  </span>
                </span>
                <span className="doc-row-edit">
                  <button
                    type="button"
                    className="doc-icon-btn"
                    onClick={() => void restoreDoc(doc)}
                    aria-label="Wiederherstellen"
                    title="Wiederherstellen"
                  >
                    <RestoreIcon size={18} />
                  </button>
                  <button
                    type="button"
                    className="doc-icon-btn danger"
                    onClick={() => void purgeDoc(doc)}
                    aria-label="Endgültig löschen"
                    title="Endgültig löschen"
                  >
                    <TrashIcon size={17} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {viewIndex >= 0 && (
        <DocViewer
          docs={viewDocs}
          index={viewIndex}
          token={token}
          onClose={closeViewer}
          onNavigate={navigateViewer}
          withPlayer={!!player.currentId}
          onMediaPlay={player.pause}
        />
      )}

      <PlayerBar player={player} tracks={audioDocs} />

      {dragOver && canManage && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">
            <UploadIcon size={40} />
            <strong>Zum Hochladen hier ablegen</strong>
          </div>
        </div>
      )}
    </div>
  );
}
