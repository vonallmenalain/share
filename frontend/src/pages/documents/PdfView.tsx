import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DocumentItem } from '../../api/client';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from '../../lib/pdf';
import { getPdfBytes } from './docUtils';
import { usePinchZoom } from './usePinchZoom';

interface PageSize {
  w: number;
  h: number;
}

/** Maximale Breite einer Seite (CSS-Pixel) – auf grossen Bildschirmen gut lesbar. */
const MAX_PAGE_WIDTH = 980;
/** Obergrenze pro gerenderter Seite (Pixel), schont den Speicher – v. a. auf iPhones. */
const MAX_CANVAS_PIXELS = 10_000_000;

/**
 * Zeigt alle Seiten eines PDFs untereinander (wie ein normaler PDF-Viewer).
 * Gerendert werden nur Seiten in der Nähe des sichtbaren Bereichs; weit
 * entfernte Seiten geben ihren Speicher wieder frei. So bleiben auch lange
 * PDFs auf dem Handy flüssig. Gezoomt wird in der Ansicht selbst (siehe
 * usePinchZoom): Die Seiten werden grösser und lassen sich dann in alle
 * Richtungen verschieben; die sichtbaren Seiten rendern danach scharf nach.
 */
export default function PdfView({
  doc,
  token,
  scrollRoot,
  onDownload,
  onZoomChange,
}: {
  doc: DocumentItem;
  token: string;
  /** Scroll-Container der Ansicht (für das Nachladen der Seiten und den Zoom). */
  scrollRoot: HTMLElement | null;
  onDownload: () => void;
  /** Meldet die Zoomstufe (1 = ganze Seitenbreite), z. B. um Wischen zu sperren. */
  onZoomChange?: (zoom: number) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cssWidth, setCssWidth] = useState(0);
  const { zoom, settledZoom } = usePinchZoom(scrollRoot, () =>
    Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('.pdf-page') ?? []),
  );
  const docId = doc.id;

  useEffect(() => {
    onZoomChange?.(zoom);
  }, [zoom, onZoomChange]);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setPdf(null);
    setSizes(null);
    setError('');
    (async () => {
      const [{ openPdf }, bytes] = await Promise.all([
        import('../../lib/pdf'),
        getPdfBytes({ id: docId }, token),
      ]);
      if (cancelled) return;
      // Kopie übergeben: pdf.js überträgt die Daten an den Worker, der
      // Zwischenspeicher soll aber erhalten bleiben.
      task = openPdf(new Uint8Array(bytes.slice(0)));
      const opened = await task.promise;
      if (cancelled) return;
      const pageSizes = await Promise.all(
        Array.from({ length: opened.numPages }, async (_, i) => {
          const page = await opened.getPage(i + 1);
          const vp = page.getViewport({ scale: 1 });
          return { w: vp.width, h: vp.height };
        }),
      );
      if (cancelled) return;
      setPdf(opened);
      setSizes(pageSizes);
    })().catch(() => {
      if (!cancelled) setError('Dieses PDF kann hier leider nicht angezeigt werden.');
    });
    return () => {
      cancelled = true;
      // Schliesst das PDF und beendet seinen Worker (auch mitten im Laden).
      void task?.destroy().catch(() => undefined);
    };
  }, [docId, token, attempt]);

  // Verfügbare Breite messen (auch bei Drehung des Handys).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setCssWidth(Math.min(el.clientWidth, MAX_PAGE_WIDTH));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="pdf-view">
      {error ? (
        <div className="doc-viewer-message">
          <p>{error}</p>
          <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setAttempt((n) => n + 1)}>
              Erneut versuchen
            </button>
            <button className="btn btn-sm btn-primary" onClick={onDownload}>
              Herunterladen
            </button>
          </div>
        </div>
      ) : !pdf || !sizes || !cssWidth ? (
        <div className="doc-viewer-message">
          <span className="spinner lg white" />
        </div>
      ) : (
        sizes.map((size, i) => (
          <PdfPage
            key={i}
            pdf={pdf}
            pageNumber={i + 1}
            size={size}
            cssWidth={cssWidth}
            zoom={zoom}
            renderZoom={settledZoom}
            root={scrollRoot}
          />
        ))
      )}
    </div>
  );
}

function PdfPage({
  pdf,
  pageNumber,
  size,
  cssWidth,
  zoom,
  renderZoom,
  root,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize;
  /** Breite der Seite ohne Zoom (ganze Breite der Ansicht). */
  cssWidth: number;
  /** Aktuelle Zoomstufe – bestimmt die angezeigte Grösse (auch mitten in der Geste). */
  zoom: number;
  /** Zoomstufe, sobald die Geste ruht – bestimmt die Auflösung. */
  renderZoom: number;
  root: HTMLElement | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // In der Nähe (wird gerendert) bzw. tatsächlich sichtbar (rendert gezoomt
  // in voller Schärfe, die übrigen in Grundauflösung – das spart Speicher).
  // Die ersten Seiten sofort, ohne auf den Observer zu warten.
  const [near, setNear] = useState(pageNumber <= 2);
  const [visible, setVisible] = useState(pageNumber === 1);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const nearObserver = new IntersectionObserver(([e]) => setNear(e.isIntersecting), {
      root,
      rootMargin: '150% 0px',
    });
    const visibleObserver = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      root,
    });
    nearObserver.observe(el);
    visibleObserver.observe(el);
    return () => {
      nearObserver.disconnect();
      visibleObserver.disconnect();
    };
  }, [root]);

  // In Viertel-Stufen, damit nicht jede kleine Zoom-Änderung neu rendert.
  const quality = visible ? Math.max(1, Math.round(renderZoom * 4) / 4) : 1;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (!near) {
      // Weit weg: Speicher freigeben (leere Canvas behält nur den Platzhalter).
      const old = canvasRef.current;
      if (old) {
        old.width = 0;
        old.height = 0;
        old.remove();
        canvasRef.current = null;
      }
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      let scale = (cssWidth / size.w) * dpr * quality;
      const pixels = size.w * size.h * scale * scale;
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      // In eine neue Canvas rendern und erst danach austauschen – so blitzt
      // beim Nachrendern (Zoom, Drehen) keine leere Seite auf.
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.className = 'pdf-canvas';
      task = page.render({ canvas, viewport });
      await task.promise;
      if (cancelled) {
        canvas.width = 0;
        canvas.height = 0;
        return;
      }
      const old = canvasRef.current;
      box.appendChild(canvas);
      canvasRef.current = canvas;
      if (old) {
        old.width = 0;
        old.height = 0;
        old.remove();
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, quality, cssWidth, pdf, pageNumber, size]);

  // Beim Verlassen der Ansicht Canvas-Speicher sofort freigeben.
  useEffect(
    () => () => {
      const old = canvasRef.current;
      if (old) {
        old.width = 0;
        old.height = 0;
      }
    },
    [],
  );

  const width = cssWidth * zoom;
  return (
    <div
      ref={boxRef}
      className="pdf-page"
      style={{ width, height: (width * size.h) / size.w }}
      aria-label={`Seite ${pageNumber}`}
    />
  );
}
