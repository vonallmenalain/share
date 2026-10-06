import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DocumentItem } from '../../api/client';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from '../../lib/pdf';
import { getPdfBytes } from './docUtils';

interface PageSize {
  w: number;
  h: number;
}

/** Maximale Breite einer Seite (CSS-Pixel) – auf grossen Bildschirmen gut lesbar. */
const MAX_PAGE_WIDTH = 980;
/** Obergrenze pro gerenderter Seite (Pixel), schont den Speicher – v. a. auf iPhones. */
const MAX_CANVAS_PIXELS = 10_000_000;

/**
 * Zoomstufe der Seite (Zwei-Finger-Zoom des Browsers). Wird gezoomt, rendern
 * die sichtbaren Seiten nach kurzer Pause in höherer Auflösung nach, damit
 * kleine Schrift (z. B. Noten) scharf bleibt.
 */
function useVisualZoom(): number {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const z = Math.min(3, Math.max(1, vv.scale || 1));
        setZoom(Math.round(z * 2) / 2);
      }, 250);
    };
    vv.addEventListener('resize', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
    };
  }, []);
  return zoom;
}

/**
 * Zeigt alle Seiten eines PDFs untereinander (wie ein normaler PDF-Viewer).
 * Gerendert werden nur Seiten in der Nähe des sichtbaren Bereichs; weit
 * entfernte Seiten geben ihren Speicher wieder frei. So bleiben auch lange
 * PDFs auf dem Handy flüssig.
 */
export default function PdfView({
  doc,
  token,
  scrollRoot,
  onDownload,
}: {
  doc: DocumentItem;
  token: string;
  /** Scroll-Container der Ansicht (für das Nachladen der Seiten). */
  scrollRoot: HTMLElement | null;
  onDownload: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cssWidth, setCssWidth] = useState(0);
  const zoom = useVisualZoom();
  const docId = doc.id;

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
  root,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize;
  cssWidth: number;
  zoom: number;
  root: HTMLElement | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // In der Nähe (wird gerendert) bzw. tatsächlich sichtbar (darf beim Zoomen
  // hochauflösend nachrendern). Die ersten Seiten sofort, ohne auf den
  // Observer zu warten.
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

  const quality = visible ? zoom : 1;

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

  return (
    <div
      ref={boxRef}
      className="pdf-page"
      style={{ width: cssWidth, height: Math.round((cssWidth * size.h) / size.w) }}
      aria-label={`Seite ${pageNumber}`}
    />
  );
}
