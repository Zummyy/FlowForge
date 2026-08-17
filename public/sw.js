/* FlowForge service worker — offline-first app shell.
 *
 * Strategy:
 *   • precache  — the app shell ("/"), manifest + icons at install, so the
 *     PWA opens even before the first visit
 *   • navigations — network-first, fall back to the cached response, then to
 *     the cached "/" shell (the client-side localStorage mirrors + db-sync
 *     render the user's data from there)
 *   • static assets (/ _next/static, stems, media) — stale-while-revalidate:
 *     instant offline loads, refreshed in the background
 *   • /api/recordings — network-only: never serve stale audio bytes
 *   • everything else GET — network-first with cache fallback
 */
const CACHE_NAME = "flowforge-v2";
const SHELL = `${CACHE_NAME}-shell`;
const RUNTIME = `${CACHE_NAME}-runtime`;
const PRECACHE = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(CACHE_NAME)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Only same-origin requests — let cross-origin (fonts, etc.) hit the network.
  if (url.origin !== self.location.origin) return;

  // Recordings API: always fresh, never cached.
  if (url.pathname.startsWith("/api/recordings/")) {
    event.respondWith(fetch(request));
    return;
  }

  const cachePut = (cacheName, req, response) => {
    if (!response || !response.ok) return;
    const clone = response.clone();
    caches.open(cacheName).then((cache) => cache.put(req, clone));
  };

  // Navigations: network-first → cache → cached app shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cachePut(RUNTIME, request, response);
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/stems/") ||
    url.pathname.endsWith(".wav") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".woff2");
  if (isStatic) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            cachePut(RUNTIME, request, response);
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Default: network-first with cache fallback.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        fetch(request)
          .then((response) => {
            cachePut(RUNTIME, request, response);
            return response;
          })
          .catch(() => cached || new Response("Offline", { status: 503 }))
    )
  );
});
