/* Ledger desktop — service worker.
 *
 * Same purpose as the mobile one (m/sw.js): makes the app installable on
 * Chrome/ChromeOS rather than caching anything meaningfully. Caches the
 * static app shell only — Supabase calls and the CDN client pass straight
 * through, uncached, so data is never served stale.
 */

const CACHE = 'ledger-desktop-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/db.js',
  './assets/js/auth.js',
  './assets/js/shell.js',
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
  /* Scoped to exactly the root shell files — never intercepts /m/, which
     runs its own service worker under its own scope. */
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/m/')) return;

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
