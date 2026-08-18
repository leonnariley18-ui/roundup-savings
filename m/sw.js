/* Ledger mobile — service worker.
 *
 * Exists mainly so Chrome/Android treat this as an installable PWA rather
 * than a bare bookmark. Caches the static app shell only — anything that
 * isn't a same-origin GET under /m/ (Supabase calls, the CDN client, fonts)
 * passes straight through, never cached, so data is never served stale.
 */

const CACHE = 'ledger-mobile-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/mobile.css',
  './assets/js/main.js',
  './assets/js/shell.js',
  './assets/js/state.js',
  './assets/js/toast.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return res;
      }).catch(() => cached)
    )
  );
});
