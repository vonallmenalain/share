import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { UploadsProvider } from './context/Uploads';
import './index.css';

// Service Worker registrieren, damit die App als PWA installierbar ist und
// offline startet. 'autoUpdate' lädt neue Versionen im Hintergrund nach.
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <UploadsProvider>
        <App />
      </UploadsProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
