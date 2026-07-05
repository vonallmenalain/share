import { useCallback, useEffect, useRef } from 'react';
import { Item, fileUrl } from '../api/client';
import { formatBytes, formatDateTime } from '../lib/format';

interface Props {
  items: Item[];
  index: number;
  token: string;
  /** Anzeigename der aktuellen Person – bestimmt, ob gelöscht werden darf. */
  currentName?: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDownload: (item: Item) => void;
  onArchive?: (item: Item) => void;
  onDelete?: (item: Item) => void;
  onToggleFavorite?: (item: Item) => void;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

export default function Lightbox({
  items,
  index,
  token,
  currentName,
  onClose,
  onNavigate,
  onDownload,
  onArchive,
  onDelete,
  onToggleFavorite,
}: Props) {
  const item = items[index];

  const prev = useCallback(() => {
    onNavigate((index - 1 + items.length) % items.length);
  }, [index, items.length, onNavigate]);
  const next = useCallback(() => {
    onNavigate((index + 1) % items.length);
  }, [index, items.length, onNavigate]);

  // Wischgesten (Touch): links/rechts blättert durch die Medien. Wir merken uns
  // den Startpunkt der Berührung und werten beim Loslassen aus, ob es sich um
  // eine klare horizontale Wischbewegung handelt.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      touchStart.current = null;
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }, []);
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start || items.length <= 1) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      // Nur als Wisch werten, wenn die Bewegung deutlich horizontal ist.
      const THRESHOLD = 50;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
      if (dx < 0) next();
      else prev();
    },
    [items.length, next, prev],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next]);

  // Mit dem Zurück-Button (Browser/Android) das Bild schliessen, statt die Seite
  // zu verlassen. Beim Öffnen legen wir einen History-Eintrag an; "Zurück" löst
  // dann popstate aus und schliesst nur die Lightbox.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    window.history.pushState({ lightbox: true }, '');
    const onPop = () => onCloseRef.current();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Wird die Lightbox per Klick/✕/Esc geschlossen (nicht über "Zurück"),
      // entfernen wir unseren History-Eintrag wieder.
      if (window.history.state?.lightbox) window.history.back();
    };
  }, []);

  if (!item) return null;

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lb-top" onClick={(e) => e.stopPropagation()}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="name">Upload von {item.uploaderName}</div>
          <div className="lb-meta">
            {formatBytes(item.sizeBytes)}
            {/* Foto-Aufnahmezeiten (EXIF) sind zeitzonenlose Wanduhrzeiten und
                werden unverändert angezeigt; Video-Zeiten sind echte Zeitpunkte. */}
            {item.takenAt
              ? ` · ${formatDateTime(item.takenAt, { floating: item.kind !== 'video' })}`
              : ''}
          </div>
        </div>
        {onToggleFavorite && (
          <button
            className={`lb-btn lb-fav${item.favorite ? ' on' : ''}`}
            onClick={() => onToggleFavorite(item)}
            aria-pressed={item.favorite}
            title={item.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
          >
            {item.favorite ? '★' : '☆'}
          </button>
        )}
        <button className="lb-btn" onClick={() => onDownload(item)} title="Original herunterladen">
          ↓ <span className="lb-btn-label">Original</span>
        </button>
        {onArchive && (
          <button
            className="lb-btn lb-icon"
            onClick={() => onArchive(item)}
            title="Archivieren (aus der Galerie ausblenden, bleibt erhalten)"
            aria-label="Archivieren"
          >
            🗄️
          </button>
        )}
        {onDelete && currentName && sameName(item.uploaderName, currentName) && (
          <button
            className="lb-btn lb-icon lb-danger"
            onClick={() => onDelete(item)}
            title="Löschen (nur du als Uploader:in kannst dieses Medium löschen)"
            aria-label="Löschen"
          >
            🗑️
          </button>
        )}
        <button className="lb-btn lb-icon" onClick={onClose} aria-label="Schliessen">
          ✕
        </button>
      </div>

      {/* Klick auf die freie Fläche neben dem Foto/Video schliesst ebenfalls.
          Das Medium selbst und die Navigationspfeile stoppen den Klick. */}
      <div
        className="lb-stage"
        onClick={onClose}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {items.length > 1 && (
          <button
            className="lb-nav lb-prev"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            aria-label="Zurück"
          >
            ‹
          </button>
        )}

        {item.status === 'failed' ? (
          // Verarbeitung fehlgeschlagen (z. B. nicht unterstütztes Format):
          // keine Vorschau möglich – Original bleibt aber herunterladbar.
          <div className="lb-fallback" onClick={(e) => e.stopPropagation()}>
            <div className="lb-fallback-icon">{item.kind === 'video' ? '🎬' : '🖼️'}</div>
            <div className="lb-fallback-title">Vorschau nicht verfügbar</div>
            <div className="lb-fallback-sub">
              Dieses Medium konnte nicht als Vorschau aufbereitet werden. Das Original ist
              unverändert gespeichert und kann heruntergeladen werden.
            </div>
            <button className="lb-btn" onClick={() => onDownload(item)}>
              ↓ Original herunterladen
            </button>
          </div>
        ) : item.kind === 'video' ? (
          item.hasPreview ? (
            <video
              key={item.id}
              src={fileUrl(`/files/video/${item.id}`, token)}
              poster={item.hasPoster ? fileUrl(`/files/poster/${item.id}`, token) : undefined}
              controls
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              style={{ color: '#fff', textAlign: 'center' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="spinner lg white" style={{ margin: '0 auto 14px' }} />
              Vorschau wird noch erstellt…
              <div style={{ marginTop: 14 }}>
                <button className="lb-btn" onClick={() => onDownload(item)}>
                  ↓ Original herunterladen
                </button>
              </div>
            </div>
          )
        ) : item.hasPreview ? (
          <img
            key={item.id}
            src={fileUrl(`/files/preview/${item.id}`, token)}
            alt={item.filename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div style={{ color: '#fff' }} onClick={(e) => e.stopPropagation()}>
            <div className="spinner lg white" style={{ margin: '0 auto' }} />
          </div>
        )}

        {items.length > 1 && (
          <button
            className="lb-nav lb-next"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            aria-label="Weiter"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
