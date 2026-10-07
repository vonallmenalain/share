// Netlify Edge Function: Link-Vorschau für Bereichs-Links je nach Modulen.
//
// WhatsApp, iMessage & Co. lesen beim Teilen eines Links nur das HTML (ohne
// JavaScript). Für einen Bereich zeigt die Vorschau dann knapp den Namen des
// Bereichs (z. B. „Lieder DKA 2026"): mit einem Modul dazu dessen Bild und
// keine Beschreibung, mit mehreren das share-Bild und die Module als kurze
// Beschreibung („Fotos & Videos · Finanzen"). Browser, die eine Seite öffnen,
// laufen ohne Umweg durch – nur für Vorschau-Programme wird der Bereich kurz
// beim Backend nachgeschlagen.
//
// Wirkt erst nach dem Veröffentlichen des Deploys (wie die übrige Seite).
import type { Config, Context } from '@netlify/edge-functions';
import {
  isLinkPreviewRequest,
  previewHtml,
  slugFromPath,
  spacePreview,
} from '../shared/linkPreview.ts';

/** Backend, falls VITE_API_BASE_URL hier nicht gesetzt ist. */
const DEFAULT_API = 'https://api.alae.app';
/** Länger wartet die Vorschau nicht auf das Backend – sonst die normale Seite. */
const API_TIMEOUT_MS = 2500;

interface SpaceInfo {
  name: string;
  modules: unknown;
}

async function fetchSpace(slug: string): Promise<SpaceInfo | null> {
  const api = (Netlify.env.get('VITE_API_BASE_URL') || DEFAULT_API).replace(/\/+$/, '');
  try {
    const res = await fetch(`${api}/api/spaces/by-slug/${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { space?: { name?: unknown; modules?: unknown } };
    const name = data.space?.name;
    if (typeof name !== 'string' || !name.trim()) return null;
    return { name: name.trim(), modules: data.space?.modules };
  } catch {
    return null;
  }
}

export default async function linkPreview(request: Request, context: Context) {
  if (!isLinkPreviewRequest(request.headers)) return;
  const url = new URL(request.url);
  const slug = slugFromPath(url.pathname);
  if (!slug) return;

  const [space, response] = await Promise.all([fetchSpace(slug), context.next()]);
  if (!space) return response;
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) {
    return response;
  }

  const { html } = previewHtml(await response.text(), {
    ...spacePreview(space.name, space.modules, url.origin),
    url: `${url.origin}${url.pathname}`,
  });
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(html, { status: response.status, headers });
}

export const config: Config = {
  path: ['/s/*', '/d/*'],
  method: 'GET',
  // Bei einem Fehler in dieser Funktion einfach die normale Seite ausliefern.
  onError: 'bypass',
};
