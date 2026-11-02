// Offline support. The Worker replaces the VERSION placeholder with the deployment's
// version id, so every deploy installs a fresh, consistent cache.

const VERSION = '__BUILD__';
const CACHE = `studio-${VERSION}`;
const ASSETS = [
  '/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/css/studio.css',
  '/js/main.js', '/js/app.js', '/js/util.js', '/js/history.js', '/js/model.js', '/js/selection.js',
  '/js/filters.js', '/js/text.js', '/js/paint.js', '/js/transform.js', '/js/tools.js', '/js/ops.js',
  '/js/io.js', '/js/icons.js', '/js/commands.js', '/js/viewport.js',
  '/js/ui/widgets.js', '/js/ui/dialogs.js', '/js/ui/menu.js', '/js/ui/panels.js', '/js/ui/chrome.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('studio-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Cache first: all files of one version are served together.
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('/') : null);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  }));
});
