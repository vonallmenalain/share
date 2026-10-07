// Dynamisches Web-App-Manifest pro Bereich. Standardmässig zeigt das statische
// Manifest (start_url "/") beim Installieren auf die Startseite. Damit eine als
// PWA installierte Verknüpfung direkt einen bestimmten Bereich öffnet
// (z. B. /s/ferien-tessin-…), ersetzen wir auf der Bereichsseite das Manifest
// durch eines mit passender start_url/id. So landet man nach dem Öffnen der
// installierten App direkt in diesem Bereich statt auf der Hauptdomain.
//
// Installierte App (Android): Chrome prüft beim Start höchstens einmal am Tag,
// ob sich das Manifest geändert hat (Name, Farben …) – genau einmal, sobald die
// Seite fertig geladen ist, und nur mit einem Manifest derselben `id` wie die
// installierte App. Das Bereichs-Manifest erst nach der Antwort des Backends
// zu setzen, war dafür zu spät: Chrome fand das allgemeine Manifest (id "/")
// und liess die Prüfung aus. Darum wird ein schon bekanntes Bereichs-Manifest
// gleich beim Start gesetzt (restoreSpaceManifest) und danach nur ersetzt,
// wenn sich sein Inhalt ändert – eine neue Adresse bricht die Prüfung ab.

import { spaceManifestStore } from './storage';

const ICONS = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

const DEFAULT_DESCRIPTION = 'Ein gemeinsamer Bereich für Familie und Freunde – einfach per Link geteilt.';

let currentBlobUrl: string | null = null;
let currentJson: string | null = null;
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
export function setSpaceManifest(
  slug: string,
  name: string,
  opts: { description?: string } = {},
): void {
  const link = getManifestLink();
  if (originalManifestHref === null) originalManifestHref = link.getAttribute('href');

  const title = (name || '').trim() || 'share';
  const description = opts.description ?? DEFAULT_DESCRIPTION;
  const manifest = {
    // Sowohl der vollständige Name als auch der Kurzname entsprechen exakt dem
    // Bereichsnamen, damit die installierte PWA genauso heisst wie der Bereich
    // (z. B. „Ferien Tessin") und nicht abgeschnitten wird.
    name: title,
    short_name: title,
    description,
    lang: 'de',
    id: `/s/${slug}`,
    start_url: absoluteUrl(`/s/${slug}`),
    scope: absoluteUrl('/'),
    display: 'standalone',
    // 'any' statt 'portrait': So darf die installierte PWA dem Gerät ins
    // Querformat folgen (z. B. für quer aufgenommene Videos im Vollbild).
    orientation: 'any',
    background_color: '#f6f7f9',
    theme_color: '#111015',
    icons: ICONS.map((i) => ({ ...i, src: absoluteUrl(i.src) })),
  };

  // Unverändert und schon gesetzt: dieselbe Adresse behalten (siehe oben).
  const json = JSON.stringify(manifest);
  if (json !== currentJson || !currentBlobUrl || link.getAttribute('href') !== currentBlobUrl) {
    const blob = new Blob([json], { type: 'application/manifest+json' });
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = url;
    currentJson = json;
    spaceManifestStore.set(slug, { name: title, description });
  }

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
  currentJson = null;
  const appleTitle = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-title"]',
  );
  if (appleTitle && originalAppleTitle !== null) {
    appleTitle.setAttribute('content', originalAppleTitle);
  }
}

/**
 * Beim Start der App, vor dem ersten Zeichnen: Ist der Bereich der
 * aufgerufenen Adresse (/s/<bereich> bzw. /d/<bereich>) schon bekannt, sein
 * Manifest sofort setzen – siehe oben.
 */
export function restoreSpaceManifest(pathname: string): void {
  const match = /^\/[sd]\/([^/]+)/.exec(pathname);
  if (!match) return;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    return;
  }
  const saved = spaceManifestStore.get(slug);
  if (saved) setSpaceManifest(slug, saved.name, { description: saved.description });
}

/** Bereich gibt es nicht (mehr): gemerktes Manifest vergessen. */
export function forgetSpaceManifest(slug: string): void {
  spaceManifestStore.clear(slug);
  resetManifest();
}
