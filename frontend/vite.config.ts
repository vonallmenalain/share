import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { previewHtml, spacePreview } from './netlify/shared/linkPreview';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Kennung dieses Builds: im App-Code als `__APP_VERSION__` und zusätzlich als
 * /version.json. So erkennt eine offene Seite nach einem Update des Service
 * Workers, ob sie wirklich neu laden muss (siehe src/main.tsx).
 */
const appVersion = Date.now().toString(36);

function appVersionFile(): Plugin {
  return {
    name: 'app-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: appVersion }),
      });
    },
  };
}

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
 * Link-Vorschau für früher geteilte Dokumente-Links (/d/<bereich>): WhatsApp &
 * Co. lesen nur das statische HTML. Beim Build entsteht deshalb eine Kopie von
 * index.html als d/index.html – mit dem Titel „Dokumente", dem Dokumente-Bild
 * und ohne Beschreibung. Netlify liefert sie für /d/* aus (Regel in
 * public/_redirects). Neue Links (/s/<bereich>) bekommen ihre Vorschau mit dem
 * Namen des Bereichs von der Edge Function (netlify/edge-functions/).
 */
function documentsEntryHtml(): Plugin {
  return {
    name: 'documents-entry-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') {
        this.error('documents-entry-html: index.html fehlt im Build.');
      }
      const source = String(index.source);
      // Adresse der Seite (z. B. https://share.alae.app) aus dem Vorschaubild.
      const origin = /<meta property="og:image" content="(https?:\/\/[^/"]+)\//.exec(source)?.[1];
      if (!origin) this.error('documents-entry-html: og:image nicht in index.html gefunden.');
      const { html, missing } = previewHtml(source, spacePreview('Dokumente', ['documents'], origin));
      if (missing.length) {
        this.error(`documents-entry-html: ${missing.join(', ')} nicht in index.html gefunden.`);
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
    appVersionFile(),
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
        // Farbe des alae.app-Logos (auch Statusleiste der installierten App).
        theme_color: '#111015',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Vollflächig, Zeichen innerhalb der Schutzzone – für runde/geformte Icons.
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Alle gebauten Assets vorab in den Cache legen (Offline-Start & schneller Start).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2}'],
        // Ausnahmen: die PDF-Anzeige (pdf.js, gut 1.8 MB) und ihre Hilfsdateien –
        // sie werden erst beim Öffnen eines PDFs geladen, nicht vorab bei allen,
        // die die App nur für Fotos & Co. nutzen. Dazu alles, was nur Link-
        // Vorschauen (WhatsApp & Co.) brauchen. Je kleiner dieser Cache, desto
        // schneller ist eine neue App-Version auf dem Gerät aktiv.
        globIgnores: [
          '**/pdf-*.js',
          '**/pdfWorker-*.js',
          'pdfjs/**',
          'og-*.png',
          'd/index.html',
        ],
        // Seitenaufrufe (Links öffnen, neu laden) kommen immer zuerst aus dem
        // Netz – so zeigt ein geteilter Link sofort die aktuelle App, auch wenn
        // auf dem Gerät noch eine ältere Version gespeichert ist. Nur ohne Netz
        // startet die gespeicherte App. Früher kam die App zuerst aus dem
        // Cache: Eine alte Version, die einen neuen Link noch nicht kannte,
        // landete so auf der Startseite.
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            options: {
              precacheFallback: { fallbackURL: 'index.html' },
            },
          },
        ],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      // Ermöglicht das Testen des Service Workers auch im Dev-/Preview-Modus.
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  // Der PDF-Worker wird als ES-Modul gestartet (`new Worker(url, { type: 'module' })`).
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
