import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { useUploads } from '../context/Uploads';
import { useSpaceSession } from '../lib/useSpaceSession';
import { nameStore } from '../lib/storage';
import { formatBytes, formatEta, formatSpeed } from '../lib/format';

const VIDEO_EXT = new Set([
  'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp', 'hevc', 'mpg', 'mpeg', 'wmv', 'flv',
]);

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

const isUploaded = (s: string) => s === 'processing' || s === 'done';

/**
 * Eigenständige Upload-Seite (kein Popup) unter /s/:slug/upload.
 * Zeigt sofort nach dem Hinzufügen von Dateien einen Fortschrittsbalken mit
 * Anzahl hochgeladener Fotos/Videos, Uploadgeschwindigkeit, verbleibenden MB
 * und einer geschätzten Restdauer.
 */
export default function UploadPage() {
  const { slug = '' } = useParams();
  const uploads = useUploads();
  const { phase, space, token, name, setName, gate, enter } = useSpaceSession(slug);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const startUpload = useCallback(
    (files: File[]) => {
      if (!space || !token || files.length === 0) return;
      let uploaderName = name.trim() || nameStore.get();
      if (!uploaderName) {
        uploaderName = (window.prompt('Dein Name (wird bei deinen Medien angezeigt):') || '').trim();
        if (!uploaderName) return;
        setName(uploaderName);
        nameStore.set(uploaderName);
      }
      uploads.addFiles(files, { spaceId: space.id, token, uploaderName });
    },
    [space, token, name, uploads, setName],
  );

  const pick = () => fileInputRef.current?.click();

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    startUpload(Array.from(list));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // ---- Ableitungen für die Fortschrittsanzeige ----------------------------
  const mine = space ? uploads.tasks.filter((t) => t.spaceId === space.id) : [];

  const uploadingCount = mine.filter((t) => ['queued', 'uploading'].includes(t.status)).length;
  const processingCount = mine.filter((t) => t.status === 'processing').length;
  const activeCount = uploadingCount + processingCount;

  const uploadedCount = mine.filter((t) => isUploaded(t.status)).length;
  const doneCount = mine.filter((t) => t.status === 'done').length;
  const errorCount = mine.filter((t) => t.status === 'error').length;
  const canceledCount = mine.filter((t) => t.status === 'canceled').length;

  const totalBytes = mine.reduce((sum, t) => sum + t.totalBytes, 0);
  const sentBytes = mine.reduce(
    (sum, t) => sum + (isUploaded(t.status) ? t.totalBytes : t.uploadedBytes),
    0,
  );
  const remainingBytes = Math.max(0, totalBytes - sentBytes);
  const overallPct = totalBytes > 0 ? Math.min(100, Math.round((sentBytes / totalBytes) * 100)) : 0;

  const photos = mine.filter((t) => !isVideoName(t.name));
  const videos = mine.filter((t) => isVideoName(t.name));

  const allFinished = mine.length > 0 && activeCount === 0;

  // ---- Geschwindigkeit & Restzeit (gleitendes 5-Sekunden-Fenster) ---------
  const [speed, setSpeed] = useState(0);
  const sentRef = useRef(0);
  const activeRef = useRef(false);
  sentRef.current = sentBytes;
  activeRef.current = activeCount > 0;

  useEffect(() => {
    const samples: { t: number; b: number }[] = [];
    const id = setInterval(() => {
      const now = Date.now();
      if (!activeRef.current) {
        samples.length = 0;
        setSpeed(0);
        return;
      }
      samples.push({ t: now, b: sentRef.current });
      const cutoff = now - 5000;
      while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
      const first = samples[0];
      const dt = (now - first.t) / 1000;
      const db = sentRef.current - first.b;
      setSpeed(dt > 0.2 ? Math.max(0, db / dt) : 0);
    }, 500);
    return () => clearInterval(id);
  }, []);

  const eta = speed > 0 && activeCount > 0 ? remainingBytes / speed : null;

  // ---- Render --------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <div className="center-page">
        <span className="spinner lg" />
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <div className="center-page">
        <div className="panel">
          <h1>Bereich nicht gefunden</h1>
          <p className="sub">Der Link ist ungültig oder der Bereich wurde gelöscht.</p>
          <Link className="btn" to="/">
            Zur Startseite
          </Link>
        </div>
      </div>
    );
  }

  if (phase === 'gate') {
    return (
      <div className="center-page">
        <div className="panel">
          <span className="hero-badge">{space?.name ?? 'Bereich'}</span>
          <h1>Bereich betreten</h1>
          <p className="sub">
            Gib deinen Namen ein, damit alle sehen, von wem die Fotos stammen
            {space?.hasPassword ? ' – und das Passwort des Bereichs.' : '.'}
          </p>
          {gate.error && <div className="error-box">{gate.error}</div>}
          <form onSubmit={enter}>
            <div className="field">
              <label className="label">Dein Name</label>
              <input
                className="input"
                placeholder="z. B. Anna"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            {space?.hasPassword && (
              <div className="field">
                <label className="label">Passwort</label>
                <input
                  className="input"
                  type="password"
                  value={gate.password}
                  onChange={(e) => gate.setPassword(e.target.value)}
                />
              </div>
            )}
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={gate.busy}>
              {gate.busy ? 'Öffne…' : 'Bereich betreten'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      <TopBar>
        <Link className="btn btn-sm" to={`/s/${slug}`}>
          ← Zur Galerie
        </Link>
      </TopBar>

      <div
        className="container upload-page"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="space-head">
          <h1 className="space-title">Hochladen</h1>
          <div className="space-meta">
            {space?.name}
            {space?.hasPassword ? ' · 🔒 passwortgeschützt' : ''} · als <strong>{name || 'Gast'}</strong>
          </div>
        </div>

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
          className={`dropzone dropzone-xl${dragOver ? ' over' : ''}`}
          onClick={pick}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div style={{ fontSize: 44, marginBottom: 8 }}>⬆️</div>
          <strong style={{ fontSize: 18 }}>Fotos &amp; Videos hierher ziehen</strong>
          <div className="hint" style={{ marginTop: 8 }}>
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
            . Der Upload startet sofort.
          </div>
        </div>

        {mine.length > 0 && (
          <div className="upload-summary-card">
            <div className="upload-progress-top">
              <strong style={{ fontSize: 16 }}>
                {uploadedCount} von {mine.length} hochgeladen
              </strong>
              <span className="upload-pct">{overallPct}%</span>
            </div>

            <div className="bar bar-xl">
              <i
                style={{
                  width: `${overallPct}%`,
                  background:
                    errorCount > 0 && activeCount === 0 ? 'var(--danger)' : 'var(--brand)',
                }}
              />
            </div>

            <div className="upload-stats">
              <div className="upload-stat">
                <span className="upload-stat-label">Fotos</span>
                <span className="upload-stat-value">
                  {photos.filter((t) => isUploaded(t.status)).length} / {photos.length}
                </span>
              </div>
              <div className="upload-stat">
                <span className="upload-stat-label">Videos</span>
                <span className="upload-stat-value">
                  {videos.filter((t) => isUploaded(t.status)).length} / {videos.length}
                </span>
              </div>
              <div className="upload-stat">
                <span className="upload-stat-label">Geschwindigkeit</span>
                <span className="upload-stat-value">
                  {activeCount > 0 ? formatSpeed(speed) : '–'}
                </span>
              </div>
              <div className="upload-stat">
                <span className="upload-stat-label">Verbleibend</span>
                <span className="upload-stat-value">
                  {activeCount > 0 ? formatBytes(remainingBytes) : '0 B'}
                </span>
              </div>
              <div className="upload-stat">
                <span className="upload-stat-label">Restzeit</span>
                <span className="upload-stat-value">
                  {activeCount > 0 ? formatEta(eta) : '–'}
                </span>
              </div>
              <div className="upload-stat">
                <span className="upload-stat-label">Übertragen</span>
                <span className="upload-stat-value">
                  {formatBytes(sentBytes)} / {formatBytes(totalBytes)}
                </span>
              </div>
            </div>

            <div className="upload-summary-foot">
              {activeCount > 0 ? (
                <span className="muted upload-live">
                  <span className="spinner" />
                  {uploadingCount > 0
                    ? `${uploadingCount} Upload${uploadingCount > 1 ? 's' : ''} läuft…`
                    : 'Verarbeitung läuft…'}
                </span>
              ) : (
                <span className="muted">Fertig – du kannst weitere Dateien hinzufügen.</span>
              )}
              <div className="spacer" />
              {allFinished && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => uploads.clearFinished(space?.id)}
                >
                  Liste leeren
                </button>
              )}
              <Link className="btn btn-sm btn-primary" to={`/s/${slug}`}>
                Zur Galerie
              </Link>
            </div>
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
                {doneCount} von {mine.length} {mine.length === 1 ? 'Medium' : 'Medien'} erfolgreich
                hochgeladen.
                {errorCount > 0 ? ` ${errorCount} fehlgeschlagen.` : ''}
                {canceledCount > 0 ? ` ${canceledCount} abgebrochen.` : ''}
                {errorCount > 0 && (
                  <>
                    {' '}
                    <button
                      className="link-btn"
                      onClick={() => space && uploads.retryFailed(space.id)}
                    >
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
                  <div className="upload-file-icon">{isVideoName(t.name) ? '🎬' : '🖼️'}</div>
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
                    <button className="btn btn-sm" onClick={() => uploads.retry(t.id)}>
                      Erneut
                    </button>
                  )}
                  {['queued', 'uploading'].includes(t.status) && (
                    <button className="btn btn-sm btn-ghost" onClick={() => uploads.cancel(t.id)}>
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {dragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">
            <div style={{ fontSize: 44 }}>⬆️</div>
            <strong>Zum Hochladen hier ablegen</strong>
          </div>
        </div>
      )}
    </>
  );
}
