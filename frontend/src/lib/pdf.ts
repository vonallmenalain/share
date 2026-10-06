// PDF-Anzeige mit pdf.js. Dieses Modul wird erst beim Öffnen des ersten PDFs
// nachgeladen (dynamischer Import), damit die übrige App nicht grösser wird.
//
// pdf.js rendert die Seiten selbst in <canvas>-Elemente – so funktioniert die
// Anzeige überall gleich, auch auf Android (dort gibt es keinen eingebauten
// PDF-Viewer im Browser) und auf dem iPhone (dort zeigt ein eingebettetes PDF
// sonst nur die erste Seite).
import './polyfills';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from './pdfWorker.ts?worker&url';

export type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';

// Jedes PDF bekommt seinen eigenen Worker, den pdf.js beim Schliessen wieder
// beendet. Ein gemeinsamer Worker (`workerPort`) würde beim schnellen Blättern
// zwischen PDFs kollidieren: Das Aufräumen des alten PDFs beendet sonst auch
// das gerade geöffnete neue.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Hilfsdateien von pdf.js (beim Build nach /pdfjs/ kopiert, siehe
 * vite.config.ts): Standard-Schriften für PDFs ohne eingebettete Schrift,
 * CMaps für asiatische Schriften und WASM-Decoder u. a. für gescannte PDFs
 * (JBIG2/JPEG 2000 – z. B. eingescannte Noten). Absolute URLs, weil der
 * Worker sie selbst lädt.
 */
function assetUrl(dir: string): string {
  return new URL(`/pdfjs/${dir}/`, window.location.origin).href;
}

/**
 * Öffnet ein PDF aus den bereits geladenen Bytes. Gibt den Lade-Vorgang
 * zurück (`.promise` = Dokument, `.destroy()` = schliessen und Worker beenden).
 */
export function openPdf(data: Uint8Array): PDFDocumentLoadingTask {
  return pdfjs.getDocument({
    data,
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    enableXfa: false,
  });
}
