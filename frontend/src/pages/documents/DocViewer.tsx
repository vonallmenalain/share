import { useCallback, useEffect, useRef, useState } from 'react';
import { DocumentItem } from '../../api/client';
import PdfView from './PdfView';
import ImageView from './ImageView';
import { docTitle, downloadUrl, prefetchPdf, viewUrl } from './docUtils';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
} from './icons';

interface Props {
  /** Alle ansehbaren Dokumente (PDF, Bild, Video) in Listen-Reihenfolge. */
  docs: DocumentItem[];
  index: number;
  token: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** Ist unten der Musik-Player eingeblendet? (Dann bleibt dafür Platz frei.) */
  withPlayer: boolean;
  /** Ein Video startet – z. B. um laufende Musik anzuhalten. */
  onMediaPlay?: () => void;
}

/**
 * Vollbild-Ansicht für PDFs, Bilder und Videos. Weiterblättern per Wischen
 * (links/rechts), über die Pfeile oben oder die Pfeiltasten; ein Tippen auf
 * den Titel öffnet die Liste aller Dokumente zum direkten Springen. Musik
 * läuft dabei weiter.
 */
export default function DocViewer({
  docs,
  index,
  token,
  onClose,
  onNavigate,
  withPlayer,
  onMediaPlay,
}: Props) {
  const doc = docs[index];
  const hasPrev = index > 0;
  const hasNext = index < docs.length - 1;
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  // Zoomstufe des offenen Dokuments (1 = ganze Breite). Ist hineingezoomt,
  // verschieben Wischen und Pfeiltasten nur den Ausschnitt – kein Blättern.
  const zoomRef = useRef(1);
  const handleZoom = useCallback((z: number) => {
    zoomRef.current = z;
  }, []);
  // Liste aller Dokumente (Tippen auf den Titel).
  const [listOpen, setListOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  // Richtung der letzten Navigation – bestimmt, von welcher Seite das nächste
  // Dokument hereingleitet. Pro Dokument einmal festgehalten, damit spätere
  // Neu-Renderings (z. B. durch den Player) die Animation nicht wiederholen.
  const navDirection = useRef<'open' | 'next' | 'prev'>('open');
  const slide = useRef<{ id: string; dir: 'open' | 'next' | 'prev' } | null>(null);
  if (doc && slide.current?.id !== doc.id) {
    slide.current = { id: doc.id, dir: navDirection.current };
  }

  const prev = useCallback(() => {
    if (!hasPrev) return;
    navDirection.current = 'prev';
    onNavigate(index - 1);
  }, [hasPrev, index, onNavigate]);
  const next = useCallback(() => {
    if (!hasNext) return;
    navDirection.current = 'next';
    onNavigate(index + 1);
  }, [hasNext, index, onNavigate]);
  const goTo = (target: number) => {
    setListOpen(false);
    if (target === index) return;
    navDirection.current = target > index ? 'next' : 'prev';
    onNavigate(target);
  };

  // Beim Blättern (Wischen, Pfeile) die Liste schliessen; das neue Dokument
  // beginnt ungezoomt.
  const docId = doc?.id;
  useEffect(() => {
    setListOpen(false);
    zoomRef.current = 1;
  }, [docId]);

  // Geöffnete Liste: aktuelles Dokument sichtbar machen.
  useEffect(() => {
    if (!listOpen) return;
    listRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [listOpen]);

  const download = useCallback(() => {
    if (!doc) return;
    const a = document.createElement('a');
    a.href = downloadUrl(doc, token);
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [doc, token]);

  // Nachbar-PDFs schon im Hintergrund laden → Blättern ohne Wartezeit.
  useEffect(() => {
    prefetchPdf(docs[index + 1], token);
    prefetchPdf(docs[index - 1], token);
  }, [docs, index, token]);

  // Tastatur: Pfeile blättern, Escape schliesst (zuerst die offene Liste).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, video')) return;
      if (e.key === 'Escape') {
        if (listOpen) setListOpen(false);
        else onClose();
      } else if (zoomRef.current > 1.01) {
        return;
      } else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next, listOpen]);

  // Hintergrund (Liste) nicht mitscrollen lassen.
  useEffect(() => {
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevOverflow;
    };
  }, []);

  // Wischgesten: deutlich horizontale Bewegung = blättern – nur in der
  // Ganzseiten-Ansicht. Ist hineingezoomt, verschiebt der Finger den
  // Ausschnitt in alle Richtungen (siehe usePinchZoom). Nie auf den
  // Bedienelementen eines Videos.
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (e.touches.length !== 1 || target?.closest('video, button, a')) {
      touchStart.current = null;
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    if (zoomRef.current > 1.01 || (window.visualViewport?.scale ?? 1) > 1.05) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const fast = Date.now() - start.t < 600;
    if (Math.abs(dx) < (fast ? 50 : 90) || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) next();
    else prev();
  };

  if (!doc) return null;

  return (
    <div
      className={`doc-viewer${withPlayer ? ' with-player' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={docTitle(doc)}
    >
      <header className="doc-viewer-bar">
        <button
          className="doc-viewer-btn"
          onClick={onClose}
          aria-label="Schliessen"
          title="Schliessen"
        >
          <CloseIcon size={22} />
        </button>
        {docs.length > 1 ? (
          <button
            type="button"
            className="doc-viewer-title doc-viewer-title-btn"
            onClick={() => setListOpen((open) => !open)}
            aria-expanded={listOpen}
            aria-controls="doc-viewer-list"
            title="Alle Dokumente"
          >
            <span className="doc-viewer-title-row">
              <strong>{docTitle(doc)}</strong>
              <ChevronDownIcon size={16} className="doc-viewer-chevron" />
            </span>
            <span className="doc-viewer-count">
              {index + 1} / {docs.length}
            </span>
          </button>
        ) : (
          <div className="doc-viewer-title">
            <strong>{docTitle(doc)}</strong>
          </div>
        )}
        {docs.length > 1 && (
          <>
            <button
              className="doc-viewer-btn"
              onClick={prev}
              disabled={!hasPrev}
              aria-label="Vorheriges Dokument"
              title="Vorheriges Dokument"
            >
              <ChevronLeftIcon size={22} />
            </button>
            <button
              className="doc-viewer-btn"
              onClick={next}
              disabled={!hasNext}
              aria-label="Nächstes Dokument"
              title="Nächstes Dokument"
            >
              <ChevronRightIcon size={22} />
            </button>
          </>
        )}
        <button
          className="doc-viewer-btn"
          onClick={download}
          aria-label="Herunterladen"
          title="Herunterladen"
        >
          <DownloadIcon size={21} />
        </button>

        {listOpen && (
          <>
            <div className="doc-viewer-list-backdrop" onClick={() => setListOpen(false)} />
            <div className="doc-viewer-list" id="doc-viewer-list">
              <ol ref={listRef}>
                {docs.map((d, i) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className={`doc-viewer-list-item${i === index ? ' current' : ''}`}
                      aria-current={i === index ? 'true' : undefined}
                      onClick={() => goTo(i)}
                    >
                      <span className="doc-viewer-list-no">{i + 1}</span>
                      <span className="doc-viewer-list-name">{docTitle(d)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </header>

      <div
        key={doc.id}
        ref={setScrollEl}
        className={`doc-viewer-scroll doc-slide-${slide.current?.dir ?? 'open'}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {doc.docType === 'pdf' ? (
          <PdfView
            doc={doc}
            token={token}
            scrollRoot={scrollEl}
            onDownload={download}
            onZoomChange={handleZoom}
          />
        ) : doc.docType === 'image' ? (
          <ImageView
            src={viewUrl(doc, token)}
            alt={docTitle(doc)}
            scrollRoot={scrollEl}
            onZoomChange={handleZoom}
          />
        ) : (
          <div className="doc-viewer-media">
            <video
              src={viewUrl(doc, token)}
              controls
              playsInline
              preload="metadata"
              onPlay={onMediaPlay}
            />
          </div>
        )}
      </div>

      {hasPrev && (
        <button
          className="doc-viewer-side doc-viewer-side-prev"
          onClick={prev}
          aria-label="Vorheriges Dokument"
        >
          <ChevronLeftIcon size={28} />
        </button>
      )}
      {hasNext && (
        <button
          className="doc-viewer-side doc-viewer-side-next"
          onClick={next}
          aria-label="Nächstes Dokument"
        >
          <ChevronRightIcon size={28} />
        </button>
      )}
    </div>
  );
}
