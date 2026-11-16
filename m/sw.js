/* Ledger mobile — service worker.
 *
 * Exists mainly so Chrome/Android treat this as an installable PWA rather
 * than a bare bookmark. Caches exactly the files listed in SHELL and
 * nothing else — everything not in that list (the screens, the shared
 * assets/js/* logic they import, Supabase calls, the CDN client, fonts)
 * passes straight through to the network every time, so a deploy is
 * never stuck behind a stale cached copy of something this worker was
 * never meant to own.
 */

const CACHE = 'ledger-mobile-shell-v3';
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
/* Absolute pathnames, resolved once against this worker's own scope — the
 * fetch handler below checks requests against this, not SHELL directly,
 * since a request's url.pathname is always absolute. */
const SHELL_PATHS = new Set(SHELL.map(p => new URL(p, self.registration.scope).pathname));

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
  /* Only the literal shell files are ever touched here — everything else
   * (the screens, the shared assets/js/* logic they import, anything new
   * a deploy adds) always goes straight to the network, same as Supabase
   * calls already do. */
  if (!SHELL_PATHS.has(url.pathname)) return;

  /* Network-first, not cache-first — a shell file's own *content* can
   * change (as main.js's just did) without sw.js itself changing, and
   * nothing short of a new cache name would ever notice that under a
   * cache-first strategy. Falling back to the cache only on a failed
   * fetch keeps the one thing SHELL actually exists for — working
   * offline — without ever preferring a stale copy while online. */
  event.respondWith(
    fetch(event.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request))
  );
});
