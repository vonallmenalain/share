import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { UploadsProvider } from './context/Uploads';
import './index.css';

/**
 * Ist im Hintergrund eine neue App-Version aktiv geworden, lädt die Seite nur
 * dann neu, wenn sie selbst noch eine ältere Version zeigt. Seitenaufrufe
 * kommen zuerst aus dem Netz (siehe vite.config.ts) – meist läuft also schon
 * die neue Version, und ein Neuladen würde nur stören (z. B. ein gerade
 * laufendes Lied abbrechen).
 */
async function reloadIfOutdated() {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    const { version } = (await res.json()) as { version?: string };
    if (version === __APP_VERSION__) return;
  } catch {
    // Version nicht prüfbar – sicherheitshalber neu laden.
  }
  window.location.reload();
}

// Service Worker registrieren, damit die App als PWA installierbar ist und
// offline startet. 'autoUpdate' lädt neue Versionen im Hintergrund nach.
registerSW({ immediate: true, onNeedReload: () => void reloadIfOutdated() });

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <UploadsProvider>
        <App />
      </UploadsProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
