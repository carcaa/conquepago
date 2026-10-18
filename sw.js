// Cache simple: app shell offline-first, promos network-first.
const V = 'cqp-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'src/app.js', 'src/emv.js', 'src/rubros.js', 'src/engine.js', 'src/analisis.js',
  'manifest.webmanifest', 'icon-180.png', 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.includes('overpass')) return;
  // Red primero (para recibir promos y versiones nuevas); caché si no hay conexión.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const c = r.clone(); caches.open(V).then((k) => k.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
