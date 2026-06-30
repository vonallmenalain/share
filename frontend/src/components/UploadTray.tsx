import { useUploads } from '../context/Uploads';
import { formatBytes } from '../lib/format';

const STATUS_LABEL: Record<string, string> = {
  queued: 'Wartet…',
  uploading: 'Lädt hoch',
  processing: 'Verarbeitet…',
  done: 'Fertig ✓',
  error: 'Fehler',
  canceled: 'Abgebrochen',
};

const VIDEO_EXT = new Set([
  'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp', 'hevc', 'mpg', 'mpeg', 'wmv', 'flv',
]);

/** Schätzt anhand der Dateiendung, ob es ein Video ist (für die Aufschlüsselung). */
function isVideoName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return VIDEO_EXT.has(name.slice(dot + 1).toLowerCase());
}

export default function UploadTray({ spaceId }: { spaceId: string }) {
  const { tasks, retry, cancel, clearFinished } = useUploads();
  const mine = tasks.filter((t) => t.spaceId === spaceId);
  if (mine.length === 0) return null;

  const active = mine.filter((t) => ['queued', 'uploading', 'processing'].includes(t.status)).length;

  // "Hochgeladen" = die Datei ist vollständig beim Server angekommen (sie wird
  // ggf. noch verarbeitet) bzw. fertig.
  const isUploaded = (s: string) => s === 'processing' || s === 'done';
  const uploadedCount = mine.filter((t) => isUploaded(t.status)).length;
  const errorCount = mine.filter((t) => t.status === 'error').length;

  // Gesamtfortschritt über alle Dateien (nach Bytes), damit der Balken auch bei
  // vielen Dateien gleichmässig läuft.
  const totalBytes = mine.reduce((sum, t) => sum + t.totalBytes, 0);
  const sentBytes = mine.reduce(
    (sum, t) => sum + (isUploaded(t.status) ? t.totalBytes : t.uploadedBytes),
    0,
  );
  const overallPct = totalBytes > 0 ? Math.min(100, Math.round((sentBytes / totalBytes) * 100)) : 0;

  // Aufschlüsselung Fotos / Videos.
  const photos = mine.filter((t) => !isVideoName(t.name));
  const videos = mine.filter((t) => isVideoName(t.name));
  const photosDone = photos.filter((t) => isUploaded(t.status)).length;
  const videosDone = videos.filter((t) => isUploaded(t.status)).length;

  const breakdown: string[] = [];
  if (photos.length) breakdown.push(`${photosDone}/${photos.length} Fotos`);
  if (videos.length) breakdown.push(`${videosDone}/${videos.length} Videos`);

  return (
    <div className="tray">
      <div className="tray-head">
        {active > 0 ? <span className="spinner" /> : <span>✓</span>}
        <span>
          {active > 0 ? `${active} Upload${active > 1 ? 's' : ''} läuft` : 'Uploads abgeschlossen'}
        </span>
        <div className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={clearFinished}>
          Aufräumen
        </button>
      </div>

      <div className="tray-summary">
        <div className="tray-summary-top">
          <strong>
            {uploadedCount} von {mine.length} hochgeladen
          </strong>
          <span className="tray-sub">{overallPct}%</span>
        </div>
        <div className="bar bar-lg">
          <i
            style={{
              width: `${overallPct}%`,
              background: errorCount > 0 && active === 0 ? 'var(--danger)' : 'var(--brand)',
            }}
          />
        </div>
        <div className="tray-sub" style={{ marginTop: 5 }}>
          {breakdown.join(' · ')}
          {errorCount > 0 ? ` · ${errorCount} fehlgeschlagen` : ''}
        </div>
      </div>

      <div className="tray-body">
        {mine.map((t) => {
          const pct =
            t.status === 'done' || t.status === 'processing'
              ? 100
              : t.totalBytes > 0
                ? Math.min(99, Math.round((t.uploadedBytes / t.totalBytes) * 100))
                : 0;
          return (
            <div className="tray-row" key={t.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="tray-name">{t.name}</div>
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
    </div>
  );
}
