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

export default function UploadTray({ spaceId }: { spaceId: string }) {
  const { tasks, retry, cancel, clearFinished } = useUploads();
  const mine = tasks.filter((t) => t.spaceId === spaceId);
  if (mine.length === 0) return null;

  const active = mine.filter((t) => ['queued', 'uploading', 'processing'].includes(t.status)).length;

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
