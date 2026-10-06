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

export interface DocumentsPreview {
  /** Titel unter dem Vorschaubild – z. B. der Name des Bereichs. */
  title: string;
  /** Absolute URL des Vorschaubilds. */
  imageUrl: string;
  /** Adresse der Seite (og:url). Ohne Angabe wird og:url entfernt. */
  url?: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function metaPattern(attr: 'name' | 'property', key: string): RegExp {
  return new RegExp(`(<meta\\s+${attr}="${escapeRegExp(key)}"\\s+content=")[^"]*(")`);
}

function metaTagPattern(attr: 'name' | 'property', key: string): RegExp {
  return new RegExp(`\\s*<meta\\s+${attr}="${escapeRegExp(key)}"[^>]*>`);
}

/**
 * Passt die Vorschau-Tags eines HTML-Dokuments für einen reinen
 * Dokumente-Bereich an: eigener Titel, Dokumente-Bild, keine Beschreibung
 * (WhatsApp & Co. zeigen dann nur Bild, Titel und Domain). Gibt das neue HTML
 * zurück und welche Tags darin fehlten.
 */
export function documentsPreviewHtml(
  html: string,
  preview: DocumentsPreview,
): { html: string; missing: string[] } {
  const title = escapeHtml(preview.title);
  const image = escapeHtml(preview.imageUrl);
  const missing: string[] = [];
  let out = html;

  const apply = (name: string, pattern: RegExp, replace: (...groups: string[]) => string) => {
    if (!pattern.test(out)) {
      missing.push(name);
      return;
    }
    // Ersetzung als Funktion: Ein „$" im Namen des Bereichs bleibt so ein „$".
    out = out.replace(pattern, (_match: string, ...groups: string[]) => replace(...groups));
  };
  const setMeta = (attr: 'name' | 'property', key: string, value: string) =>
    apply(key, metaPattern(attr, key), (before, after) => `${before}${value}${after}`);
  const removeMeta = (attr: 'name' | 'property', key: string) =>
    apply(key, metaTagPattern(attr, key), () => '');

  apply('title', /<title>[^<]*<\/title>/, () => `<title>${title}</title>`);
  setMeta('property', 'og:title', title);
  setMeta('name', 'twitter:title', title);
  setMeta('property', 'og:image', image);
  setMeta('name', 'twitter:image', image);
  setMeta('property', 'og:image:alt', 'Dokumente');
  removeMeta('name', 'description');
  removeMeta('property', 'og:description');
  removeMeta('name', 'twitter:description');
  if (preview.url) setMeta('property', 'og:url', escapeHtml(preview.url));
  else removeMeta('property', 'og:url');

  return { html: out, missing };
}

/** Besteht der Bereich nur aus dem Dokumente-Modul? */
export function isDocumentsOnly(modules: unknown): boolean {
  return Array.isArray(modules) && modules.length === 1 && modules[0] === 'documents';
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
