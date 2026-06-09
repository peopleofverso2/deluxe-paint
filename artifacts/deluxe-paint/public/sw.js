/* Deluxe Paint service worker — offline-first app shell.
 *
 * Strategy:
 * - Navigations (HTML):   network-first → fallback to cached shell.
 *   Online users always get the newest deploy; offline users get the
 *   last one they visited.
 * - /api/*:               network-only. Cloud features simply fail
 *   offline (the app alerts; drawing is unaffected).
 * - Same-origin assets:   cache-first. Vite hashes filenames, so any
 *   cached /assets/* file is immutable by construction.
 * - Google Fonts:         CSS stale-while-revalidate, font binaries
 *   cache-first (they're versioned URLs).
 *
 * Bump CACHE_VERSION to force-flush every client cache on next visit.
 */
const CACHE_VERSION = "dpaint-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API: never cache — let it hit the network (and fail honestly offline)
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  // Navigations: network-first with cached-shell fallback
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/", { ignoreSearch: true }))
    );
    return;
  }

  // Google Fonts CSS: stale-while-revalidate (family list can evolve)
  if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const fresh = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  // Font binaries + same-origin static assets: cache-first
  const cacheable =
    url.hostname === "fonts.gstatic.com" ||
    (url.origin === self.location.origin);
  if (!cacheable) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      // Cache successful (or opaque cross-origin font) responses
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    }).catch(() => caches.match(req))
  );
});
