/**
 * Offline support for the Cricket Over Counter.
 *
 * Stale-while-revalidate: the app opens instantly from cache with no signal at
 * the ground, and quietly picks up a new deploy on the next load.
 *
 * Bump CACHE when the asset list changes.
 */

const CACHE = 'cricket-counter-v1';

const PRECACHE = [
  './',
  './index.html',
  './engine.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Start the refresh synchronously and hand it to waitUntil, so the browser
  // keeps this worker alive until cache.put lands. Kicking it off inside the
  // respondWith promise instead lets the worker be killed mid-write, and the
  // cache then never picks up a new deploy.
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  event.waitUntil(refresh);

  event.respondWith((async () => {
    // Serve from cache immediately — instant, and works with no signal.
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const fresh = await refresh;
    if (fresh) return fresh;

    // A navigation with no cache entry and no network still gets the app shell.
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  })());
});
