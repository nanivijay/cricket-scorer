/**
 * Offline support for Cricket Scorer.
 *
 * Two strategies, because the app's own files and its icons want opposite
 * things:
 *
 *   - The shell (HTML and JavaScript) is **network-first with a short
 *     timeout**. Serving it from cache first meant a new deploy did not appear
 *     until the *second* load, so people saw a stale interface and reasonably
 *     concluded the app was broken. Freshness matters more than a few hundred
 *     milliseconds here. If the network does not answer within the timeout —
 *     no signal at the ground, or a hostile queue on the boundary rope — the
 *     cached copy is served immediately, so scoring never blocks.
 *
 *   - Everything else (icons, manifest) is **cache-first with a background
 *     refresh**. These rarely change and are the largest files, so there is
 *     nothing to gain by waiting on the network for them.
 *
 * Bump CACHE when the asset list changes.
 */

const CACHE = 'cricket-counter-v6';

/**
 * How long to wait for the network before falling back to cache. Long enough
 * for a normal connection to win, short enough that a dead one is not felt.
 */
const SHELL_TIMEOUT_MS = 2500;

const PRECACHE = [
  './',
  './index.html',
  './engine.js',
  './share.js',
  './qr.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
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

/** The app itself, as opposed to its icons: a stale one means a stale interface. */
function isShell(request) {
  return request.mode === 'navigate'
    || request.destination === 'document'
    || request.destination === 'script';
}

/** Fetch, but give up after `SHELL_TIMEOUT_MS` so a dead network is not felt. */
async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHELL_TIMEOUT_MS);
  try {
    return await fetch(request, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cached copy, or the precached shell for a navigation, or a plain failure. */
async function fallback(request, cache) {
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }
  return Response.error();
}

async function shellFirst(request) {
  const cache = await caches.open(CACHE);
  const response = await fetchWithTimeout(request);
  if (response && response.ok) {
    // Await the write: the worker may be shut down the moment we respond, and
    // a half-written cache entry is worse than none.
    await cache.put(request, response.clone());
    return response;
  }
  return (response && !response.ok) ? response : fallback(request, cache);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (isShell(request)) {
    event.respondWith(shellFirst(request));
    return;
  }

  // Assets: answer from cache at once and refresh in the background. The
  // refresh is started synchronously and handed to waitUntil so the browser
  // keeps this worker alive until cache.put lands — start it inside the
  // respondWith promise instead and the worker can be killed mid-write, in
  // which case the cache never picks up a new deploy at all.
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
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const fresh = await refresh;
    if (fresh) return fresh;
    return fallback(request, await caches.open(CACHE));
  })());
});
