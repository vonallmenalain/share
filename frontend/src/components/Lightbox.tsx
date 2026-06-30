import { useCallback, useEffect } from 'react';
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

      <div className="lb-stage" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && (
          <button className="lb-nav lb-prev" onClick={prev} aria-label="Zurück">
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
            />
          ) : (
            <div style={{ color: '#fff', textAlign: 'center' }}>
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
          <img key={item.id} src={fileUrl(`/files/preview/${item.id}`, token)} alt={item.filename} />
        ) : (
          <div style={{ color: '#fff' }}>
            <div className="spinner lg white" style={{ margin: '0 auto' }} />
          </div>
        )}

        {items.length > 1 && (
          <button className="lb-nav lb-next" onClick={next} aria-label="Weiter">
            ›
          </button>
        )}
      </div>
    </div>
  );
}
