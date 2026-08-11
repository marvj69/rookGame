const CACHE_NAME = "rook-game-cache-v7";
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const scopedPath = path => new URL(path, self.registration.scope).pathname;
const INDEX_PATH = scopedPath("index.html");
const SERVICE_WORKER_PATH = scopedPath("service-worker.js");
const ASSETS_TO_CACHE = [
  SCOPE_PATH,
  INDEX_PATH,
  scopedPath("manifest.webmanifest"),
  scopedPath("rook-icon.svg")
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
  if (requestUrl.pathname === SERVICE_WORKER_PATH) {
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
              .then(cache => Promise.all([cache.put(SCOPE_PATH, clone.clone()), cache.put(INDEX_PATH, clone)]))
              .catch(() => null)
          );
          return networkResponse;
        })
        .catch(() => caches.match(INDEX_PATH))
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
        .catch(() => caches.match(INDEX_PATH));
    })
  );
});
