// Offline-Fähigkeit: App-Dateien und mitgelieferte Bibliotheken werden zwischengespeichert.
const VERSION = 'feder-v9';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/db.js', 'js/editor.js', 'js/import.js', 'js/sync.js', 'js/sanitize.js', 'js/transport.js', 'js/nextcloud.js', 'js/shapes.js', 'js/convert.js', 'js/sdocx.js', 'vendor/anthropic-sdk.js', 'vendor/katex/katex.min.js', 'vendor/katex/katex.min.css',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/jszip.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/api/')) return;                  // Sync immer live

  if (url.origin !== location.origin) return;

  // App-Dateien: sofort aus dem Cache, im Hintergrund aktualisieren
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response('Offline', { status: 503 });
  }));
});
