// Dynamisches Web-App-Manifest pro Bereich. Standardmässig zeigt das statische
// Manifest (start_url "/") beim Installieren auf die Startseite. Damit eine als
// PWA installierte Verknüpfung direkt einen bestimmten Bereich öffnet
// (z. B. /s/ferien-tessin-…), ersetzen wir auf der Bereichsseite das Manifest
// durch eines mit passender start_url/id. So landet man nach dem Öffnen der
// installierten App direkt in diesem Bereich statt auf der Hauptdomain.

const ICONS = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

let currentBlobUrl: string | null = null;
let originalManifestHref: string | null = null;
let originalAppleTitle: string | null = null;

function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).href;
}

function getManifestLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  return link;
}

/**
 * Setzt für die aktuelle Bereichsseite ein Manifest, dessen start_url auf genau
 * diesen Bereich zeigt. `id` ist ebenfalls bereichsspezifisch, damit sich pro
 * Bereich eine eigene installierte App erzeugen lässt.
 */
export function setSpaceManifest(slug: string, name: string): void {
  const link = getManifestLink();
  if (originalManifestHref === null) originalManifestHref = link.getAttribute('href');

  const title = (name || '').trim() || 'share';
  const manifest = {
    name: `${title} · share`,
    short_name: title.slice(0, 12) || 'share',
    description: 'Fotos & Videos einfach in einer privaten Gruppe teilen.',
    lang: 'de',
    id: `/s/${slug}`,
    start_url: absoluteUrl(`/s/${slug}`),
    scope: absoluteUrl('/'),
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f7f9',
    theme_color: '#4f46e5',
    icons: ICONS.map((i) => ({ ...i, src: absoluteUrl(i.src) })),
  };

  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = url;

  // iOS „Zum Home-Bildschirm": Titel der Verknüpfung anpassen.
  const appleTitle = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-title"]',
  );
  if (appleTitle) {
    if (originalAppleTitle === null) originalAppleTitle = appleTitle.getAttribute('content');
    appleTitle.setAttribute('content', title);
  }
}

/** Stellt das ursprüngliche (statische) Manifest wieder her. */
export function resetManifest(): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link && originalManifestHref !== null) link.setAttribute('href', originalManifestHref);
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  const appleTitle = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-title"]',
  );
  if (appleTitle && originalAppleTitle !== null) {
    appleTitle.setAttribute('content', originalAppleTitle);
  }
}
