import { useRef, useState } from 'react';
import { useUploads } from '../context/Uploads';
import { formatBytes } from '../lib/format';

const VIDEO_EXT = new Set([
  'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp', 'hevc', 'mpg', 'mpeg', 'wmv', 'flv',
]);

/** Schätzt anhand der Dateiendung, ob es ein Video ist (für die Aufschlüsselung). */
function isVideoName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return VIDEO_EXT.has(name.slice(dot + 1).toLowerCase());
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Wartet…',
  uploading: 'Lädt hoch…',
  processing: 'Verarbeitet…',
  done: 'Fertig',
  error: 'Fehler',
  canceled: 'Abgebrochen',
};

/**
 * Eigenständiger Hochlade-Bereich für einen Bereich (Space). Zeigt immer ein
 * Drag-&-Drop-Feld und eine Dateiauswahl. Sobald Dateien hinzugefügt werden,
 * erscheint ein Fortschrittsbalken (z. B. „4 von 8 hochgeladen“). Erst wenn
 * alles fertig ist, wird eine Zusammenfassung (Erfolg / Fehler) angezeigt.
 */
export default function UploadPanel({
  spaceId,
  onFiles,
  onClose,
}: {
  spaceId: string;
  onFiles: (files: File[]) => void;
  onClose: () => void;
}) {
  const { tasks, retry, retryFailed, cancel, clearFinished } = useUploads();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const mine = tasks.filter((t) => t.spaceId === spaceId);

  const uploadingCount = mine.filter((t) => ['queued', 'uploading'].includes(t.status)).length;
  const processingCount = mine.filter((t) => t.status === 'processing').length;
  const activeCount = uploadingCount + processingCount;

  // „Hochgeladen“ = vollständig beim Server angekommen (wird ggf. noch
  // verarbeitet) bzw. fertig.
  const isUploaded = (s: string) => s === 'processing' || s === 'done';
  const uploadedCount = mine.filter((t) => isUploaded(t.status)).length;
  const doneCount = mine.filter((t) => t.status === 'done').length;
  const errorCount = mine.filter((t) => t.status === 'error').length;
  const canceledCount = mine.filter((t) => t.status === 'canceled').length;

  // Gesamtfortschritt nach Bytes, damit der Balken auch bei vielen (grossen)
  // Dateien gleichmässig läuft.
  const totalBytes = mine.reduce((sum, t) => sum + t.totalBytes, 0);
  const sentBytes = mine.reduce(
    (sum, t) => sum + (isUploaded(t.status) ? t.totalBytes : t.uploadedBytes),
    0,
  );
  const overallPct = totalBytes > 0 ? Math.min(100, Math.round((sentBytes / totalBytes) * 100)) : 0;

  const photos = mine.filter((t) => !isVideoName(t.name));
  const videos = mine.filter((t) => isVideoName(t.name));
  const breakdown: string[] = [];
  if (photos.length) breakdown.push(`${photos.filter((t) => isUploaded(t.status)).length}/${photos.length} Fotos`);
  if (videos.length) breakdown.push(`${videos.filter((t) => isUploaded(t.status)).length}/${videos.length} Videos`);

  const allFinished = mine.length > 0 && activeCount === 0;

  const pick = () => fileInputRef.current?.click();

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const close = () => {
    // Fertige/abgebrochene/fehlgeschlagene Einträge dieses Bereichs aufräumen,
    // damit der Bereich beim nächsten Öffnen sauber startet.
    if (activeCount === 0) clearFinished(spaceId);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-card upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Hochladen</h2>
          <button className="btn btn-sm btn-ghost" onClick={close} aria-label="Schliessen">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <div
            className={`dropzone${dragOver ? ' over' : ''}`}
            onClick={pick}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div style={{ fontSize: 34, marginBottom: 6 }}>⬆️</div>
            <strong>Fotos &amp; Videos hierher ziehen</strong>
            <div className="hint" style={{ marginTop: 6 }}>
              oder{' '}
              <button
                className="link-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  pick();
                }}
              >
                Dateien vom Gerät auswählen
              </button>
              .
            </div>
          </div>

          {mine.length > 0 && (
            <div className="upload-progress">
              <div className="upload-progress-top">
                <strong>
                  {uploadedCount} von {mine.length} hochgeladen
                </strong>
                <span className="tray-sub">{overallPct}%</span>
              </div>
              <div className="bar bar-lg">
                <i
                  style={{
                    width: `${overallPct}%`,
                    background:
                      errorCount > 0 && activeCount === 0 ? 'var(--danger)' : 'var(--brand)',
                  }}
                />
              </div>
              {breakdown.length > 0 && (
                <div className="tray-sub" style={{ marginTop: 6 }}>
                  {breakdown.join(' · ')}
                  {processingCount > 0 && uploadingCount === 0
                    ? ' · Verarbeitung läuft…'
                    : ''}
                </div>
              )}
            </div>
          )}

          {allFinished && (
            <div className={errorCount > 0 || canceledCount > 0 ? 'error-box' : 'ok-box'}>
              {errorCount === 0 && canceledCount === 0 ? (
                <>
                  ✓ Alle {doneCount} {doneCount === 1 ? 'Medium wurde' : 'Medien wurden'}{' '}
                  erfolgreich hochgeladen.
                </>
              ) : (
                <>
                  {doneCount} von {mine.length}{' '}
                  {mine.length === 1 ? 'Medium' : 'Medien'} erfolgreich hochgeladen.
                  {errorCount > 0 ? ` ${errorCount} fehlgeschlagen.` : ''}
                  {canceledCount > 0 ? ` ${canceledCount} abgebrochen.` : ''}
                  {errorCount > 0 && (
                    <>
                      {' '}
                      <button className="link-btn" onClick={() => retryFailed(spaceId)}>
                        Fehlgeschlagene erneut versuchen
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {mine.length > 0 && (
            <div className="upload-file-list">
              {mine.map((t) => {
                const pct =
                  t.status === 'done' || t.status === 'processing'
                    ? 100
                    : t.totalBytes > 0
                      ? Math.min(99, Math.round((t.uploadedBytes / t.totalBytes) * 100))
                      : 0;
                return (
                  <div className="upload-file" key={t.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="upload-file-name" title={t.name}>
                        {t.name}
                      </div>
                      <div className="bar">
                        <i
                          style={{
                            width: `${pct}%`,
                            background:
                              t.status === 'error'
                                ? 'var(--danger)'
                                : t.status === 'done'
                                  ? 'var(--ok)'
                                  : 'var(--brand)',
                          }}
                        />
                      </div>
                      <div className="tray-sub">
                        {t.status === 'error'
                          ? t.error || 'Fehler'
                          : `${STATUS_LABEL[t.status]} · ${formatBytes(t.uploadedBytes)} / ${formatBytes(
                              t.totalBytes,
                            )}`}
                      </div>
                    </div>
                    {(t.status === 'error' || t.status === 'canceled') && (
                      <button className="btn btn-sm" onClick={() => retry(t.id)}>
                        Erneut
                      </button>
                    )}
                    {['queued', 'uploading'].includes(t.status) && (
                      <button className="btn btn-sm btn-ghost" onClick={() => cancel(t.id)}>
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {activeCount > 0 ? (
            <span className="muted" style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="spinner" />
              {uploadingCount > 0
                ? `${uploadingCount} Upload${uploadingCount > 1 ? 's' : ''} läuft…`
                : 'Verarbeitung läuft…'}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 14 }}>
              {mine.length > 0 ? 'Fertig – du kannst weitere Dateien hinzufügen.' : 'Bereit.'}
            </span>
          )}
          <div className="spacer" />
          <button className="btn btn-primary" onClick={close}>
            {activeCount > 0 ? 'Im Hintergrund weiter' : 'Schliessen'}
          </button>
        </div>
      </div>
    </div>
  );
}
