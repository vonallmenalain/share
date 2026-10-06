import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Hilfsdateien von pdf.js (PDF-Anzeige im Dokumente-Modul) unter /pdfjs/
 * bereitstellen: Standard-Schriften (PDFs ohne eingebettete Schrift), CMaps
 * (asiatische Schriften) und die Bild-Decoder für gescannte PDFs (JBIG2,
 * JPEG 2000, Farbprofile). Im Build werden sie nach dist/pdfjs/ kopiert, im
 * Dev-Server direkt aus node_modules ausgeliefert.
 */
function pdfjsAssets(): Plugin {
  const base = path.join(rootDir, 'node_modules', 'pdfjs-dist');
  const dirs = ['cmaps', 'standard_fonts', 'wasm'];
  // quickjs-* gehört zur Skript-Sandbox des vollen pdf.js-Viewers – nicht nötig.
  const skip = /^quickjs/;
  const filesOf = (dir: string) =>
    fs
      .readdirSync(path.join(base, dir))
      .filter((f) => !skip.test(f) && fs.statSync(path.join(base, dir, f)).isFile());
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const [dir, file, ...rest] = decodeURIComponent((req.url ?? '').split('?')[0])
          .replace(/^\/+/, '')
          .split('/');
        if (!dirs.includes(dir) || !file || rest.length || !filesOf(dir).includes(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        fs.createReadStream(path.join(base, dir, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of dirs) {
        for (const file of filesOf(dir)) {
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${dir}/${file}`,
            source: fs.readFileSync(path.join(base, dir, file)),
          });
        }
      }
    },
  };
}

/**
 * Neutrale Link-Vorschau für Dokumente-Links (/d/<bereich>): WhatsApp & Co.
 * lesen nur das statische HTML (ohne JavaScript). Deshalb entsteht beim Build
 * eine Kopie von index.html als d/index.html – mit Titel, Beschreibung und
 * Vorschaubild ohne Bezug zur Foto-App. Die App selbst ist identisch. Netlify
 * liefert sie für /d/* aus (Regel `/d/*  /d/index.html  200` in
 * public/_redirects, vor der allgemeinen SPA-Regel).
 */
function documentsEntryHtml(): Plugin {
  const title = 'Geteilte Dokumente';
  const description = 'Direkt im Browser ansehen und anhören.';
  const replacements: Array<[RegExp, string]> = [
    [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
    [/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`],
    [/(<meta property="og:image" content="[^"]*)og-image\.png(")/, '$1og-docs.png$2'],
    [/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${title}$2`],
    [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`],
    [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${description}$2`],
    [/(<meta name="twitter:image" content="[^"]*)og-image\.png(")/, '$1og-docs.png$2'],
    // Die kanonische URL der Startseite gilt hier nicht.
    [/\s*<meta property="og:url" content="[^"]*" \/>/, ''],
  ];
  return {
    name: 'documents-entry-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') {
        this.error('documents-entry-html: index.html fehlt im Build.');
      }
      let html = String(index.source);
      for (const [pattern, replacement] of replacements) {
        if (!pattern.test(html)) {
          this.error(`documents-entry-html: ${pattern} nicht in index.html gefunden.`);
        }
        html = html.replace(pattern, replacement);
      }
      this.emitFile({ type: 'asset', fileName: 'd/index.html', source: html });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    pdfjsAssets(),
    documentsEntryHtml(),
    VitePWA({
      // Service Worker automatisch im Hintergrund aktualisieren, sobald ein
      // neues Deploy verfügbar ist – so bekommen Nutzer Updates ohne manuelles
      // Neuladen und ohne einen alten Cache-Stand zu behalten.
      registerType: 'autoUpdate',
      // Registrierung erfolgt explizit in src/main.tsx über 'virtual:pwa-register',
      // deshalb keine zusätzliche automatische Injektion (verhindert Doppel-Registrierung).
      injectRegister: null,
      // Manifest-Dateiname mit .webmanifest-Endung, damit der korrekte
      // Content-Type ausgeliefert wird.
      manifestFilename: 'manifest.webmanifest',
      manifest: {
        name: 'share · Fotos & Videos teilen',
        short_name: 'share',
        description:
          'Fotos & Videos einfach in einer privaten Gruppe teilen – Originale hoch- und runterladen.',
        lang: 'de',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // 'any' statt 'portrait': So darf die installierte PWA dem Gerät
        // ins Querformat folgen (z. B. für quer aufgenommene Videos im
        // Vollbild). Bei 'portrait' bleibt eine installierte App am Home-
        // Bildschirm aufs Hochformat gesperrt, obwohl der Browser dreht.
        orientation: 'any',
        background_color: '#f6f7f9',
        theme_color: '#4f46e5',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Alle gebauten Assets vorab in den Cache legen (Offline-Start & schneller Start).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2}'],
        // Ausnahme: die PDF-Anzeige (pdf.js, gut 1.8 MB) und ihre Hilfsdateien.
        // Sie werden erst beim Öffnen eines PDFs geladen – nicht vorab bei allen,
        // die die App nur für Fotos & Co. nutzen.
        globIgnores: ['**/pdf-*.js', '**/pdfWorker-*.js', 'pdfjs/**', 'og-docs.png'],
        // Single-Page-App: unbekannte Navigationsrouten auf index.html zurückfallen lassen.
        navigateFallback: '/index.html',
        // API-Aufrufe und den Netlify-SPA-Redirect nicht abfangen.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      // Ermöglicht das Testen des Service Workers auch im Dev-/Preview-Modus.
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  // Der PDF-Worker wird als ES-Modul gestartet (`new Worker(url, { type: 'module' })`).
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
