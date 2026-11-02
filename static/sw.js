/* Kaveh CMS service worker.
   - App files: network first, cached copy when offline (so updates always arrive).
   - Program list and photos: cached for read-only offline use; cleared on logout.
   - Everything that changes data always goes to the server. */
const SHELL_CACHE = 'kaveh-cms-shell-v2';
const DATA_CACHE = 'kaveh-cms-data';
const SHELL = ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(request, cacheName, markOffline) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: cacheName === SHELL_CACHE });
    if (!cached) throw err;
    if (!markOffline) return cached;
    const headers = new Headers(cached.headers);
    headers.set('X-KCMS-Offline', '1');
    return new Response(await cached.blob(), { status: cached.status, headers });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname === '/api/records' && !url.search) return e.respondWith(networkFirst(req, DATA_CACHE, true));
  if (url.pathname === '/api/status') return e.respondWith(networkFirst(req, DATA_CACHE, true));
  if (url.pathname.startsWith('/photos/') && !url.search) return e.respondWith(cacheFirst(req));
  if (url.pathname.startsWith('/api/')) return;
  if (SHELL.includes(url.pathname) || url.pathname === '/index.html' || req.mode === 'navigate') {
    e.respondWith(networkFirst(url.pathname === '/index.html' || req.mode === 'navigate' ? new Request('/') : req, SHELL_CACHE, false));
  }
});
