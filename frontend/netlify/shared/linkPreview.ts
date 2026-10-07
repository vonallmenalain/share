// Link-Vorschau (Open Graph) für geteilte Bereichs-Links. Gemeinsam genutzt vom
// Build (vite.config.ts erzeugt damit d/index.html) und von der Netlify Edge
// Function (netlify/edge-functions/link-preview.ts). Bewusst ohne Abhängigkeiten,
// damit derselbe Code in Node (Build, Tests) und Deno (Edge) läuft.

/** Text sicher in HTML (Text oder Attribut in "…") einsetzen. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Module in der Reihenfolge der App (wie backend/src/lib/modules.ts), mit dem
 * Namen für die Beschreibung und dem Vorschaubild (in frontend/public/).
 */
export const PREVIEW_MODULES = [
  { key: 'photos', label: 'Fotos & Videos', image: 'og-photos.png' },
  { key: 'documents', label: 'Dokumente', image: 'og-docs.png' },
  { key: 'finance', label: 'Finanzen', image: 'og-finance.png' },
  { key: 'shopping', label: 'Einkaufsliste', image: 'og-shopping.png' },
  { key: 'notes', label: 'Notizen', image: 'og-notes.png' },
  { key: 'calendar', label: 'Kalender', image: 'og-calendar.png' },
];

/** Vorschaubild für Bereiche mit mehreren Modulen (und die Startseite). */
export const SHARE_IMAGE = 'og-image.png';

/**
 * Version der Vorschaubilder (`?v=…`, auch in index.html). Erhöhen, wenn sich
 * ein Bild ändert – WhatsApp & Co. speichern Bilder unter ihrer Adresse.
 */
export const PREVIEW_IMAGE_VERSION = 3;

export interface LinkPreview {
  /** Titel unter dem Vorschaubild – z. B. der Name des Bereichs. */
  title: string;
  /** Kurze Beschreibung. Ohne Angabe wird sie entfernt. */
  description?: string;
  /** Absolute URL des Vorschaubilds. */
  imageUrl: string;
  /** Alternativtext des Vorschaubilds. */
  imageAlt: string;
  /** Adresse der Seite (og:url). Ohne Angabe wird og:url entfernt. */
  url?: string;
}

/**
 * Vorschau eines Bereichs je nach aktiven Modulen – bewusst knapp. Titel ist
 * immer der Name des Bereichs. Mit einem Modul zeigt das Bild dieses Modul,
 * eine Beschreibung braucht es dann nicht. Mit mehreren Modulen kommt das
 * share-Bild, die Beschreibung nennt die Module („Fotos & Videos · Finanzen").
 */
export function spacePreview(name: string, modules: unknown, origin: string): LinkPreview {
  const active = PREVIEW_MODULES.filter((m) => Array.isArray(modules) && modules.includes(m.key));
  const imageUrl = (file: string) => `${origin}/${file}?v=${PREVIEW_IMAGE_VERSION}`;
  if (active.length === 1) {
    return { title: name, imageUrl: imageUrl(active[0].image), imageAlt: active[0].label };
  }
  return {
    title: name,
    description: active.length ? active.map((m) => m.label).join(' · ') : undefined,
    imageUrl: imageUrl(SHARE_IMAGE),
    imageAlt: 'share',
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function metaPattern(attr: 'name' | 'property', key: string): RegExp {
  return new RegExp(`(<meta\\s+${attr}="${escapeRegExp(key)}"\\s+content=")[^"]*(")`);
}

function metaTagPattern(attr: 'name' | 'property', key: string): RegExp {
  return new RegExp(`\\s*<meta\\s+${attr}="${escapeRegExp(key)}"[^>]*>`);
}

/**
 * Setzt die Vorschau-Tags eines HTML-Dokuments: Titel, Bild, Beschreibung
 * (oder keine) und Adresse. Fehlt ein Tag, das gesetzt werden soll, kommt es
 * ans Ende von <head> (z. B. die Beschreibung in d/index.html). Gibt das neue
 * HTML zurück und welche Tags im Ausgangs-HTML fehlten.
 */
export function previewHtml(html: string, preview: LinkPreview): { html: string; missing: string[] } {
  const title = escapeHtml(preview.title);
  const missing: string[] = [];
  let out = html;

  const replace = (pattern: RegExp, by: (...groups: string[]) => string) => {
    // Ersetzung als Funktion: Ein „$" im Namen des Bereichs bleibt so ein „$".
    out = out.replace(pattern, (_match: string, ...groups: string[]) => by(...groups));
  };
  const setMeta = (attr: 'name' | 'property', key: string, value: string) => {
    const pattern = metaPattern(attr, key);
    if (pattern.test(out)) {
      replace(pattern, (before, after) => `${before}${value}${after}`);
      return;
    }
    missing.push(key);
    replace(/(\s*)<\/head>/, (space) => `\n    <meta ${attr}="${key}" content="${value}" />${space}</head>`);
  };
  const removeMeta = (attr: 'name' | 'property', key: string) => {
    const pattern = metaTagPattern(attr, key);
    if (pattern.test(out)) replace(pattern, () => '');
    else missing.push(key);
  };

  if (/<title>[^<]*<\/title>/.test(out)) replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`);
  else missing.push('title');
  setMeta('property', 'og:title', title);
  setMeta('name', 'twitter:title', title);
  setMeta('property', 'og:image', escapeHtml(preview.imageUrl));
  setMeta('name', 'twitter:image', escapeHtml(preview.imageUrl));
  setMeta('property', 'og:image:alt', escapeHtml(preview.imageAlt));
  if (preview.description) {
    const description = escapeHtml(preview.description);
    setMeta('name', 'description', description);
    setMeta('property', 'og:description', description);
    setMeta('name', 'twitter:description', description);
  } else {
    removeMeta('name', 'description');
    removeMeta('property', 'og:description');
    removeMeta('name', 'twitter:description');
  }
  if (preview.url) setMeta('property', 'og:url', escapeHtml(preview.url));
  else removeMeta('property', 'og:url');

  return { html: out, missing };
}

/** Slug aus einem Bereichs-Link (`/s/<slug>` oder früher `/d/<slug>`). */
export function slugFromPath(pathname: string): string | null {
  const match = /^\/[sd]\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// Programme, die Link-Vorschauen erzeugen (WhatsApp, iMessage, Telegram,
// Signal, Facebook, Slack, Teams …) bzw. Suchmaschinen. Ein Treffer zu viel
// kostet nur eine kurze Abfrage – die Seite selbst bleibt dieselbe App.
const PREVIEW_AGENTS =
  /bot\b|bot\/|crawler|spider|preview|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|telegram|slack|discord|twitter|linkedin|skype|signal|threema|viber|snapchat|pinterest|mastodon|bluesky|embedly|iframely|vkshare|google|bing|yandex|duckduck|applebot/i;

/**
 * Stammt die Anfrage von einem Programm, das eine Link-Vorschau erstellt?
 * Browser, die eine Seite öffnen, schicken eine Mozilla-Kennung (und meist
 * `Sec-Fetch-Dest: document`) – für sie bleibt die Antwort unverändert.
 */
export function isLinkPreviewRequest(headers: Headers): boolean {
  const agent = headers.get('user-agent') ?? '';
  if (PREVIEW_AGENTS.test(agent)) return true;
  if (headers.get('sec-fetch-dest') === 'document') return false;
  return !agent.startsWith('Mozilla/');
}
