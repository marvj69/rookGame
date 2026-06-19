const CACHE_NAME = "rook-game-cache-v5";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/rook-icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === "/service-worker.js") {
    return;
  }

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          const clone = networkResponse.clone();
          event.waitUntil(
            caches
              .open(CACHE_NAME)
              .then(cache => Promise.all([cache.put("/", clone.clone()), cache.put("/index.html", clone)]))
              .catch(() => null)
          );
          return networkResponse;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request)
        .then(networkResponse => {
          const clone = networkResponse.clone();
          event.waitUntil(
            caches
              .open(CACHE_NAME)
              .then(cache => cache.put(request, clone))
              .catch(() => null)
          );
          return networkResponse;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});
