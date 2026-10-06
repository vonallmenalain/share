import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePinchZoom } from './usePinchZoom';

/**
 * Bild in der Dokument-Ansicht: zuerst ganz sichtbar (nie grösser als im
 * Original), dann wie ein PDF mit zwei Fingern, Doppeltippen oder Ctrl +
 * Mausrad zoombar und in alle Richtungen verschiebbar (siehe usePinchZoom).
 */
export default function ImageView({
  src,
  alt,
  scrollRoot,
  onZoomChange,
}: {
  src: string;
  alt: string;
  scrollRoot: HTMLElement | null;
  onZoomChange?: (zoom: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const { zoom } = usePinchZoom(scrollRoot, () => (imgRef.current ? [imgRef.current] : []));

  useEffect(() => {
    onZoomChange?.(zoom);
  }, [zoom, onZoomChange]);

  // Verfügbare Fläche: Breite des Inhalts, Höhe des Scroll-Bereichs ohne Abstände.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !scrollRoot) return;
    const update = () => {
      const style = getComputedStyle(scrollRoot);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      setArea({ w: box.clientWidth, h: Math.max(100, scrollRoot.clientHeight - padY) });
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(scrollRoot);
    return () => ro.disconnect();
  }, [scrollRoot]);

  const fit =
    natural && area ? Math.min(area.w / natural.w, area.h / natural.h, 1) : null;

  return (
    <div ref={boxRef} className="doc-viewer-media doc-viewer-image">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) {
            setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }
        }}
        style={
          fit && natural
            ? { width: natural.w * fit * zoom, height: natural.h * fit * zoom, maxWidth: 'none' }
            : { maxWidth: '100%', maxHeight: area?.h }
        }
      />
    </div>
  );
}
