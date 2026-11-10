// Lets PhatFrats install as an app on phones. Pages and files always come fresh from the network,
// with the last copy kept only as a fallback when there's no signal. Account data (/api) is never stored.
const CACHE = 'phatfrats-v2';
const SHELL = ['/', '/pricing.js', '/chapters.js', '/map-data.js', '/community.js', '/beacon.js', '/icon-192.png?v=2'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Only whole files are kept; songs load in pieces (206) and aren't stored.
        if (res.status === 200 && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/')))
  );
});
