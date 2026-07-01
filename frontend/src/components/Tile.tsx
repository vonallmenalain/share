import { useRef } from 'react';
import { Item, fileUrl } from '../api/client';
import { formatDuration } from '../lib/format';

interface Props {
  item: Item;
  token: string;
  selected?: boolean;
  selectMode?: boolean;
  onOpen?: () => void;
  onToggle?: () => void;
  /** Langes Drücken (mobil) – wechselt z. B. in den Auswahl-Modus. */
  onLongPress?: () => void;
}

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 12;

export default function Tile({
  item,
  token,
  selected,
  selectMode,
  onOpen,
  onToggle,
  onLongPress,
}: Props) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longFiredRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const beginLongPress = (x: number, y: number) => {
    if (!onLongPress) return;
    longFiredRef.current = false;
    startRef.current = { x, y };
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      longFiredRef.current = true;
      clearTimer();
      // Kurzes haptisches Feedback, falls vom Gerät unterstützt.
      try {
        navigator.vibrate?.(15);
      } catch {
        /* ignore */
      }
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const maybeCancelOnMove = (x: number, y: number) => {
    if (!startRef.current) return;
    if (
      Math.abs(x - startRef.current.x) > MOVE_CANCEL_PX ||
      Math.abs(y - startRef.current.y) > MOVE_CANCEL_PX
    ) {
      clearTimer();
    }
  };

  const click = () => {
    // Folgt einem langen Druck ein Klick (Touch-Geräte feuern beides),
    // wird dieser unterdrückt – die Auswahl wurde bereits getroffen.
    if (longFiredRef.current) {
      longFiredRef.current = false;
      return;
    }
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
      onContextMenu={(e) => {
        // Verhindert das Kontextmenü beim langen Drücken (mobil/Desktop).
        if (onLongPress) e.preventDefault();
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) beginLongPress(t.clientX, t.clientY);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) maybeCancelOnMove(t.clientX, t.clientY);
      }}
      onTouchEnd={clearTimer}
      onTouchCancel={clearTimer}
      title={`${item.filename} · ${item.uploaderName}`}
    >
      {thumbSrc ? (
        <img src={thumbSrc} alt={item.filename} loading="lazy" draggable={false} />
      ) : (
        <div className="tile processing">
          <span style={{ fontSize: 28 }}>🎬</span>
        </div>
      )}

      {item.favorite && (
        <span className="tile-fav" aria-label="Favorit" title="Favorit">
          ★
        </span>
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
