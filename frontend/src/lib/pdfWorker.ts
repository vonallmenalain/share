// Einstieg des PDF-Workers: zuerst die Polyfills, danach der eigentliche
// pdf.js-Worker (Legacy-Build = breitere Browser-Unterstützung). Die
// Reihenfolge der Imports ist wichtig – ES-Module werden in dieser Reihenfolge
// ausgewertet.
import './polyfills';
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
