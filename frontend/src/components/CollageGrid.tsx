import { useLayoutEffect, useRef, useState } from 'react';
import { Item } from '../api/client';
import Tile from './Tile';

interface Props {
  items: Item[];
  token: string;
  /** In der Standard-Galerie werden Favoriten grösser dargestellt. */
  emphasizeFavorites?: boolean;
  selectMode?: boolean;
  selected?: Set<string>;
  onToggle?: (item: Item) => void;
  onOpen: (item: Item) => void;
  onLongPress?: (item: Item) => void;
}

// Feinheit des Rasters: kleine Basis-Zeilenhöhe → Kacheln können sich exakt an
// das Seitenverhältnis des Fotos anpassen (Masonry-/Collage-Effekt).
const ROW = 8;
const GAP = 12;
const GAP_SM = 7;

interface Metrics {
  cols: number;
  colWidth: number;
  gap: number;
}

function measure(width: number): Metrics {
  const small = width <= 640;
  const gap = small ? GAP_SM : GAP;
  // Ziel-Spaltenbreite – daraus ergibt sich die Spaltenzahl.
  const target = small ? 165 : 250;
  const minCols = small ? 2 : 3;
  const cols = Math.max(minCols, Math.round((width + gap) / (target + gap)));
  const colWidth = (width - gap * (cols - 1)) / cols;
  return { cols, colWidth, gap };
}

function aspectOf(item: Item): number {
  if (item.width && item.height) {
    const ar = item.width / item.height;
    // Extreme Panoramen/Hochformate begrenzen, damit keine Kachel das Raster sprengt.
    return Math.min(2.2, Math.max(0.55, ar));
  }
  return 1;
}

// Bestimmt, wie viele Spalten/Zeilen eine Kachel belegt. Einzelne Fotos werden
// gezielt grösser dargestellt, damit eine abwechslungsreiche Collage entsteht –
// ohne die Fotos zu beschneiden oder zu verzerren.
function spanFor(item: Item, index: number, m: Metrics, emphasizeFavorites: boolean) {
  const ar = aspectOf(item);
  let colSpan = 1;

  if (emphasizeFavorites && item.favorite) {
    // Favoriten prominent: mobil (2 Spalten) über die gesamte Breite, auf
    // grösseren Bildschirmen doppelt so breit wie normale Fotos.
    colSpan = m.cols <= 2 ? m.cols : 2;
  } else if (m.cols >= 4) {
    const landscape = ar >= 1.25;
    const squarish = ar > 0.85 && ar < 1.25;
    // Breite Querformate gelegentlich über zwei Spalten ziehen …
    if (landscape && index % 6 === 1) colSpan = 2;
    // … und ab und zu ein nahezu quadratisches Foto als „Highlight“ vergrössern.
    else if (squarish && m.cols >= 5 && index % 9 === 4) colSpan = 2;
  }

  const cellWidth = m.colWidth * colSpan + m.gap * (colSpan - 1);
  const height = cellWidth / ar;
  const rowSpan = Math.max(1, Math.round((height + m.gap) / (ROW + m.gap)));
  return { colSpan, rowSpan };
}

/**
 * Foto-Collage: Die Kacheln behalten das Seitenverhältnis der Fotos und werden
 * in unterschiedlichen Grössen dicht angeordnet (Masonry-Layout).
 */
export default function CollageGrid({
  items,
  token,
  emphasizeFavorites = false,
  selectMode,
  selected,
  onToggle,
  onOpen,
  onLongPress,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<Metrics>(() => measure(1240));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setM(measure(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="collage"
      style={{
        gridTemplateColumns: `repeat(${m.cols}, 1fr)`,
        gridAutoRows: `${ROW}px`,
        gap: `${m.gap}px`,
      }}
    >
      {items.map((item, index) => {
        const { colSpan, rowSpan } = spanFor(item, index, m, emphasizeFavorites);
        return (
          <div
            key={item.id}
            className="collage-cell"
            style={{ gridColumn: `span ${colSpan}`, gridRow: `span ${rowSpan}` }}
          >
            <Tile
              item={item}
              token={token}
              selectMode={selectMode}
              selected={selected?.has(item.id)}
              onToggle={onToggle ? () => onToggle(item) : undefined}
              onOpen={() => onOpen(item)}
              onLongPress={onLongPress ? () => onLongPress(item) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
