import { useCallback, useEffect, useRef } from 'react';
import { Item, fileUrl } from '../api/client';
import { formatBytes, formatDateTime } from '../lib/format';

interface Props {
  items: Item[];
  index: number;
  token: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDownload: (item: Item) => void;
}

export default function Lightbox({ items, index, token, onClose, onNavigate, onDownload }: Props) {
  const item = items[index];

  const prev = useCallback(() => {
    onNavigate((index - 1 + items.length) % items.length);
  }, [index, items.length, onNavigate]);
  const next = useCallback(() => {
    onNavigate((index + 1) % items.length);
  }, [index, items.length, onNavigate]);

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
          <div className="name">{item.filename}</div>
          <div className="tray-sub">
            {item.uploaderName} · {formatBytes(item.sizeBytes)}
            {item.takenAt ? ` · ${formatDateTime(item.takenAt)}` : ''}
          </div>
        </div>
        <button className="lb-btn" onClick={() => onDownload(item)}>
          ↓ Original
        </button>
        <button className="lb-btn lb-icon" onClick={onClose} aria-label="Schliessen">
          ✕
        </button>
      </div>

      {/* Klick auf die freie Fläche neben dem Foto/Video schliesst ebenfalls.
          Das Medium selbst und die Navigationspfeile stoppen den Klick. */}
      <div className="lb-stage" onClick={onClose}>
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

        {item.kind === 'video' ? (
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
