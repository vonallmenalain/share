// Netlify Edge Function: Link-Vorschau für reine Dokumente-Bereiche.
//
// WhatsApp, iMessage & Co. lesen beim Teilen eines Links nur das HTML (ohne
// JavaScript). Für einen Bereich, der nur aus dem Dokumente-Modul besteht,
// zeigt die Vorschau dann den Namen des Bereichs (z. B. „Lieder DKA 2026"),
// das Dokumente-Bild und keine Beschreibung. Alle anderen Links bleiben wie
// sie sind. Browser, die eine Seite öffnen, laufen ohne Umweg durch – nur für
// Vorschau-Programme wird der Bereich kurz beim Backend nachgeschlagen.
//
// Wirkt erst nach dem Veröffentlichen des Deploys (wie die übrige Seite).
import type { Config, Context } from '@netlify/edge-functions';
import {
  documentsPreviewHtml,
  isDocumentsOnly,
  isLinkPreviewRequest,
  slugFromPath,
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
  if (!space || !isDocumentsOnly(space.modules)) return response;
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) {
    return response;
  }

  const { html } = documentsPreviewHtml(await response.text(), {
    title: space.name,
    imageUrl: `${url.origin}/og-docs.png?v=2`,
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
