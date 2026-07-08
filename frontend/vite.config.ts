import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
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
  server: {
    port: 5173,
  },
});
