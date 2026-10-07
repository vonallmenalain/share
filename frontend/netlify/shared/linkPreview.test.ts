// Tests für die Link-Vorschau (Build + Edge Function). Ausführen mit
// `npm test` im Ordner frontend (Node 22.18+ führt TypeScript direkt aus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  PREVIEW_IMAGE_VERSION,
  PREVIEW_MODULES,
  SHARE_IMAGE,
  escapeHtml,
  isLinkPreviewRequest,
  previewHtml,
  slugFromPath,
  spacePreview,
} from './linkPreview.ts';

const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

const WHATSAPP = 'WhatsApp/2.24.20.83 A';
const IMESSAGE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

const ORIGIN = 'https://share.alae.app';
const V = `?v=${PREVIEW_IMAGE_VERSION}`;

test('spacePreview: ein Modul – Bild des Moduls, keine Beschreibung', () => {
  assert.deepEqual(spacePreview('Lieder DKA 2026', ['documents'], ORIGIN), {
    title: 'Lieder DKA 2026',
    imageUrl: `${ORIGIN}/og-docs.png${V}`,
    imageAlt: 'Dokumente',
  });
  assert.deepEqual(spacePreview('Ferien Tessin', ['photos'], ORIGIN), {
    title: 'Ferien Tessin',
    imageUrl: `${ORIGIN}/og-photos.png${V}`,
    imageAlt: 'Fotos & Videos',
  });
  assert.equal(spacePreview('WG', ['finance'], ORIGIN).imageUrl, `${ORIGIN}/og-finance.png${V}`);
  assert.equal(spacePreview('WG', ['shopping'], ORIGIN).imageUrl, `${ORIGIN}/og-shopping.png${V}`);
  assert.equal(spacePreview('WG', ['notes'], ORIGIN).imageUrl, `${ORIGIN}/og-notes.png${V}`);
  assert.equal(spacePreview('WG', ['calendar'], ORIGIN).imageUrl, `${ORIGIN}/og-calendar.png${V}`);
});

test('spacePreview: mehrere Module – share-Bild, Module als Beschreibung', () => {
  assert.deepEqual(spacePreview('Ferien Tessin', ['photos', 'finance', 'calendar'], ORIGIN), {
    title: 'Ferien Tessin',
    description: 'Fotos & Videos · Finanzen · Kalender',
    imageUrl: `${ORIGIN}/og-image.png${V}`,
    imageAlt: 'share',
  });
  // Reihenfolge wie in der App, Unbekanntes wird übergangen.
  assert.equal(
    spacePreview('X', ['calendar', 'foo', 'notes', 'photos'], ORIGIN).description,
    'Fotos & Videos · Notizen · Kalender',
  );
  // Nur ein bekanntes Modul zählt als „ein Modul".
  assert.equal(spacePreview('X', ['shopping', 'foo'], ORIGIN).imageUrl, `${ORIGIN}/og-shopping.png${V}`);
  // Ohne (gültige) Module: share-Bild und keine Beschreibung.
  for (const modules of [[], ['foo'], null, 'photos']) {
    const preview = spacePreview('X', modules, ORIGIN);
    assert.equal(preview.imageUrl, `${ORIGIN}/og-image.png${V}`);
    assert.equal(preview.description, undefined);
  }
});

test('linkPreview: Bilder und Version passen zu public/ und index.html', () => {
  for (const file of [SHARE_IMAGE, ...PREVIEW_MODULES.map((m) => m.image)]) {
    assert.ok(existsSync(new URL(`../../public/${file}`, import.meta.url)), `public/${file} fehlt`);
  }
  assert.match(indexHtml, new RegExp(`<meta property="og:image" content="[^"]*/og-image\\.png\\?v=${PREVIEW_IMAGE_VERSION}" />`));
  assert.match(indexHtml, new RegExp(`<meta name="twitter:image" content="[^"]*/og-image\\.png\\?v=${PREVIEW_IMAGE_VERSION}" />`));
});

test('linkPreview: Titel, Bild und keine Beschreibung für ein Modul', () => {
  const { html, missing } = previewHtml(indexHtml, {
    ...spacePreview('Lieder DKA 2026', ['documents'], ORIGIN),
    url: 'https://share.alae.app/s/lieder-dka-2026-hr09pdcr',
  });
  assert.deepEqual(missing, []);
  assert.match(html, /<title>Lieder DKA 2026<\/title>/);
  assert.match(html, /<meta property="og:title" content="Lieder DKA 2026" \/>/);
  assert.match(html, /<meta name="twitter:title" content="Lieder DKA 2026" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/share\.alae\.app\/og-docs\.png\?v=\d+" \/>/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/share\.alae\.app\/og-docs\.png\?v=\d+" \/>/);
  assert.match(html, /<meta property="og:image:alt" content="Dokumente" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/share\.alae\.app\/s\/lieder-dka-2026-hr09pdcr" \/>/);
  assert.doesNotMatch(html, /description/);
});

test('linkPreview: mehrere Module – kurze Beschreibung mit den Modulen', () => {
  const { html, missing } = previewHtml(indexHtml, {
    ...spacePreview('Ferien Tessin', ['photos', 'finance'], ORIGIN),
    url: 'https://share.alae.app/s/ferien-tessin',
  });
  assert.deepEqual(missing, []);
  assert.match(html, /<title>Ferien Tessin<\/title>/);
  assert.match(html, /<meta name="description" content="Fotos &amp; Videos · Finanzen" \/>/);
  assert.match(html, /<meta property="og:description" content="Fotos &amp; Videos · Finanzen" \/>/);
  assert.match(html, /<meta name="twitter:description" content="Fotos &amp; Videos · Finanzen" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/share\.alae\.app\/og-image\.png\?v=\d+" \/>/);
  assert.match(html, /<meta property="og:image:alt" content="share" \/>/);
});

test('linkPreview: ohne Adresse wird og:url entfernt (statische d/index.html)', () => {
  const { html, missing } = previewHtml(indexHtml, spacePreview('Dokumente', ['documents'], ORIGIN));
  assert.deepEqual(missing, []);
  assert.doesNotMatch(html, /og:url/);
  // Bereits angepasstes HTML (z. B. d/index.html) lässt sich erneut anpassen.
  const again = previewHtml(html, {
    ...spacePreview('Lieder', ['documents'], ORIGIN),
    url: 'https://share.alae.app/d/x',
  });
  assert.match(again.html, /<title>Lieder<\/title>/);
  assert.match(again.html, /<meta property="og:url" content="https:\/\/share\.alae\.app\/d\/x" \/>\s*<\/head>/);
  assert.deepEqual(again.missing.sort(), ['description', 'og:description', 'og:url', 'twitter:description']);
  // Fehlt die Beschreibung (d/index.html), wird sie für mehrere Module ergänzt.
  const multi = previewHtml(html, spacePreview('Lager', ['documents', 'calendar'], ORIGIN));
  assert.match(multi.html, /<meta name="description" content="Dokumente · Kalender" \/>/);
  assert.match(multi.html, /<meta property="og:description" content="Dokumente · Kalender" \/>/);
  assert.match(multi.html, /<meta name="twitter:description" content="Dokumente · Kalender" \/>/);
  assert.equal(multi.html.match(/<\/head>/g)?.length, 1);
});

test('linkPreview: Namen werden sicher eingesetzt', () => {
  assert.equal(escapeHtml(`<b>"A" & 'B'</b>`), '&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;');
  const { html } = previewHtml(indexHtml, spacePreview('Lieder "2026" <script>alert(1)</script> $1 $& Preis', ['documents'], ORIGIN));
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

const page = (html = indexHtml) =>
  new Response(html, {
    headers: { 'content-type': 'text/html; charset=UTF-8', 'content-length': String(html.length) },
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
  assert.match(html, /og-docs\.png\?v=\d+/);
  assert.doesNotMatch(html, /description/);
});

test('Edge Function: Vorschau je nach Modulen', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const handler = await loadHandler();
  const calls: string[] = [];
  const preview = async (path: string, html = indexHtml) => {
    const res = await handler(new Request(`https://share.alae.app${path}`, { headers: { 'user-agent': WHATSAPP } }), {
      next: async () => page(html),
    });
    return res!.text();
  };

  // Nur Fotos: Foto-Bild, keine Beschreibung.
  stubBackend({ name: 'Ferien Tessin', modules: ['photos'] }, calls);
  const photos = await preview('/s/ferien-tessin');
  assert.match(photos, /<meta property="og:title" content="Ferien Tessin" \/>/);
  assert.match(photos, /<meta property="og:image" content="https:\/\/share\.alae\.app\/og-photos\.png\?v=\d+" \/>/);
  assert.doesNotMatch(photos, /description/);

  // Mehrere Module: share-Bild und die Module als Beschreibung.
  stubBackend({ name: 'Ferien', modules: ['photos', 'documents', 'finance'] }, calls);
  const multi = await preview('/s/ferien');
  assert.match(multi, /<title>Ferien<\/title>/);
  assert.match(multi, /<meta property="og:description" content="Fotos &amp; Videos · Dokumente · Finanzen" \/>/);
  assert.match(multi, /<meta property="og:image" content="https:\/\/share\.alae\.app\/og-image\.png\?v=\d+" \/>/);
  assert.match(multi, /<meta property="og:url" content="https:\/\/share\.alae\.app\/s\/ferien" \/>/);

  // Früherer /d/-Link (d/index.html ohne Beschreibung) eines inzwischen
  // erweiterten Bereichs: Beschreibung wird ergänzt.
  const dIndex = previewHtml(indexHtml, spacePreview('Dokumente', ['documents'], 'https://share.alae.app')).html;
  stubBackend({ name: 'Lager', modules: ['documents', 'calendar'] }, calls);
  const legacy = await preview('/d/lager', dIndex);
  assert.match(legacy, /<meta property="og:description" content="Dokumente · Kalender" \/>/);
  assert.match(legacy, /<meta property="og:url" content="https:\/\/share\.alae\.app\/d\/lager" \/>/);
});

test('Edge Function: Browser, Ausfälle und andere Seiten bleiben unverändert', async (t) => {
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

  // Backend nicht erreichbar oder Bereich unbekannt: normale Seite.
  for (const status of [0, 404]) {
    stubBackend(null, calls, status);
    const res = await handler(
      new Request('https://share.alae.app/d/weg', { headers: { 'user-agent': WHATSAPP } }),
      { next: async () => page() },
    );
    assert.equal(await res!.text(), indexHtml);
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
