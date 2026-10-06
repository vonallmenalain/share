// Tests für die Link-Vorschau (Build + Edge Function). Ausführen mit
// `npm test` im Ordner frontend (Node 22.18+ führt TypeScript direkt aus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  documentsPreviewHtml,
  escapeHtml,
  isLinkPreviewRequest,
  slugFromPath,
} from './linkPreview.ts';

const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

const WHATSAPP = 'WhatsApp/2.24.20.83 A';
const IMESSAGE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

test('linkPreview: Titel, Bild und keine Beschreibung für Dokumente-Bereiche', () => {
  const { html, missing } = documentsPreviewHtml(indexHtml, {
    title: 'Lieder DKA 2026',
    imageUrl: 'https://share.alae.app/og-docs.png?v=2',
    url: 'https://share.alae.app/s/lieder-dka-2026-hr09pdcr',
  });
  assert.deepEqual(missing, []);
  assert.match(html, /<title>Lieder DKA 2026<\/title>/);
  assert.match(html, /<meta property="og:title" content="Lieder DKA 2026" \/>/);
  assert.match(html, /<meta name="twitter:title" content="Lieder DKA 2026" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/share\.alae\.app\/og-docs\.png\?v=2" \/>/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/share\.alae\.app\/og-docs\.png\?v=2" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/share\.alae\.app\/s\/lieder-dka-2026-hr09pdcr" \/>/);
  assert.doesNotMatch(html, /description/);
  assert.doesNotMatch(html, /Fotos/);
});

test('linkPreview: ohne Adresse wird og:url entfernt (statische d/index.html)', () => {
  const { html, missing } = documentsPreviewHtml(indexHtml, {
    title: 'Dokumente',
    imageUrl: 'https://share.alae.app/og-docs.png?v=2',
  });
  assert.deepEqual(missing, []);
  assert.doesNotMatch(html, /og:url/);
  // Bereits angepasstes HTML (z. B. d/index.html) lässt sich erneut anpassen.
  const again = documentsPreviewHtml(html, {
    title: 'Lieder',
    imageUrl: 'https://share.alae.app/og-docs.png?v=2',
    url: 'https://share.alae.app/d/x',
  });
  assert.match(again.html, /<title>Lieder<\/title>/);
  assert.deepEqual(again.missing.sort(), ['description', 'og:description', 'og:url', 'twitter:description']);
});

test('linkPreview: Namen werden sicher eingesetzt', () => {
  assert.equal(escapeHtml(`<b>"A" & 'B'</b>`), '&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;');
  const { html } = documentsPreviewHtml(indexHtml, {
    title: 'Lieder "2026" <script>alert(1)</script> $1 $& Preis',
    imageUrl: 'https://share.alae.app/og-docs.png?v=2',
  });
  assert.match(html, /<title>Lieder &quot;2026&quot; &lt;script&gt;alert\(1\)&lt;\/script&gt; \$1 \$&amp; Preis<\/title>/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('linkPreview: Slug aus Bereichs-Links', () => {
  assert.equal(slugFromPath('/s/lieder-dka-2026-hr09pdcr'), 'lieder-dka-2026-hr09pdcr');
  assert.equal(slugFromPath('/d/lieder-dka-2026-hr09pdcr/'), 'lieder-dka-2026-hr09pdcr');
  assert.equal(slugFromPath('/s/ferien%20tessin'), 'ferien tessin');
  assert.equal(slugFromPath('/s/abc/docs'), null);
  assert.equal(slugFromPath('/s/'), null);
  assert.equal(slugFromPath('/admin'), null);
  assert.equal(slugFromPath('/s/%E0%A4%A'), null);
});

test('linkPreview: Vorschau-Programme vs. Browser', () => {
  const headers = (init: Record<string, string>) => new Headers(init);
  assert.equal(isLinkPreviewRequest(headers({ 'user-agent': WHATSAPP })), true);
  assert.equal(isLinkPreviewRequest(headers({ 'user-agent': IMESSAGE })), true);
  assert.equal(isLinkPreviewRequest(headers({ 'user-agent': 'TelegramBot (like TwitterBot)' })), true);
  assert.equal(isLinkPreviewRequest(headers({ 'user-agent': 'Signal/7.20' })), true);
  assert.equal(isLinkPreviewRequest(headers({})), true);
  assert.equal(
    isLinkPreviewRequest(headers({ 'user-agent': CHROME_ANDROID, 'sec-fetch-dest': 'document' })),
    false,
  );
  // Ältere Browser ohne Sec-Fetch-Kopfzeilen bleiben ebenfalls unberührt.
  assert.equal(isLinkPreviewRequest(headers({ 'user-agent': CHROME_ANDROID })), false);
});

// ---- Edge Function --------------------------------------------------------

type Handler = (request: Request, context: { next: () => Promise<Response> }) => Promise<Response | undefined>;

async function loadHandler(): Promise<Handler> {
  (globalThis as unknown as { Netlify: unknown }).Netlify = {
    env: { get: (name: string) => (name === 'VITE_API_BASE_URL' ? 'https://api.example.test/' : undefined) },
  };
  const mod = await import('../edge-functions/link-preview.ts');
  return mod.default as unknown as Handler;
}

function stubBackend(space: unknown, calls: string[], status = 200) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    if (status === 0) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ space }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const page = () =>
  new Response(indexHtml, {
    headers: { 'content-type': 'text/html; charset=UTF-8', 'content-length': String(indexHtml.length) },
  });

const realFetch = globalThis.fetch;

test('Edge Function: Dokumente-Bereich bekommt eigene Vorschau', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const handler = await loadHandler();
  const calls: string[] = [];
  stubBackend({ name: 'Lieder DKA 2026', modules: ['documents'] }, calls);
  const res = await handler(
    new Request('https://share.alae.app/s/lieder-dka-2026-hr09pdcr', {
      headers: { 'user-agent': WHATSAPP },
    }),
    { next: async () => page() },
  );
  assert.ok(res);
  assert.deepEqual(calls, ['https://api.example.test/api/spaces/by-slug/lieder-dka-2026-hr09pdcr']);
  assert.equal(res.headers.get('content-length'), null);
  const html = await res.text();
  assert.match(html, /<title>Lieder DKA 2026<\/title>/);
  assert.match(html, /og-docs\.png\?v=2/);
  assert.doesNotMatch(html, /description/);
});

test('Edge Function: Browser, Foto-Bereiche und Ausfälle bleiben unverändert', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const handler = await loadHandler();
  const calls: string[] = [];

  // Browser: keine Abfrage, Anfrage läuft unverändert weiter.
  stubBackend({ name: 'X', modules: ['documents'] }, calls);
  const browser = await handler(
    new Request('https://share.alae.app/s/abc', {
      headers: { 'user-agent': CHROME_ANDROID, 'sec-fetch-dest': 'document' },
    }),
    { next: async () => page() },
  );
  assert.equal(browser, undefined);
  assert.equal(calls.length, 0);

  // Foto-Bereich: normale Vorschau.
  stubBackend({ name: 'Ferien', modules: ['photos', 'documents'] }, calls);
  const photos = await handler(
    new Request('https://share.alae.app/s/ferien', { headers: { 'user-agent': WHATSAPP } }),
    { next: async () => page() },
  );
  assert.match(await photos!.text(), /<title>share · Fotos & Videos teilen<\/title>/);

  // Backend nicht erreichbar oder Bereich unbekannt: normale Seite.
  for (const status of [0, 404]) {
    stubBackend(null, calls, status);
    const res = await handler(
      new Request('https://share.alae.app/d/weg', { headers: { 'user-agent': WHATSAPP } }),
      { next: async () => page() },
    );
    assert.match(await res!.text(), /<title>share · Fotos & Videos teilen<\/title>/);
  }

  // Andere Seiten (z. B. ein Modul-Pfad) werden gar nicht nachgeschlagen.
  const before = calls.length;
  const other = await handler(
    new Request('https://share.alae.app/s/ferien/finance', { headers: { 'user-agent': WHATSAPP } }),
    { next: async () => page() },
  );
  assert.equal(other, undefined);
  assert.equal(calls.length, before);
});
