import { Item, fileUrl } from '../api/client';
import { formatDuration } from '../lib/format';

interface Props {
  item: Item;
  token: string;
  selected?: boolean;
  selectMode?: boolean;
  onOpen?: () => void;
  onToggle?: () => void;
}

export default function Tile({ item, token, selected, selectMode, onOpen, onToggle }: Props) {
  const click = () => {
    if (selectMode) onToggle?.();
    else onOpen?.();
  };

  if (item.status === 'processing') {
    return (
      <div className="tile processing" title={`${item.filename} – wird verarbeitet`}>
        <span className="spinner" />
      </div>
    );
  }

  const thumbSrc =
    item.kind === 'video'
      ? item.hasPoster
        ? fileUrl(`/files/poster/${item.id}`, token)
        : undefined
      : fileUrl(`/files/thumb/${item.id}`, token);

  return (
    <div
      className={`tile${selected ? ' selected' : ''}`}
      onClick={click}
      title={`${item.filename} · ${item.uploaderName}`}
    >
      {thumbSrc ? (
        <img src={thumbSrc} alt={item.filename} loading="lazy" draggable={false} />
      ) : (
        <div className="tile processing">
          <span style={{ fontSize: 28 }}>🎬</span>
        </div>
      )}

      {item.kind === 'video' && (
        <>
          <div className="play">
            <span>▶</span>
          </div>
          {item.duration ? <span className="dur">{formatDuration(item.duration)}</span> : null}
        </>
      )}

      {selectMode && (
        <span className="tile-check" style={selected ? { background: 'var(--brand)', color: '#fff' } : undefined}>
          {selected ? '✓' : ''}
        </span>
      )}
    </div>
  );
}
