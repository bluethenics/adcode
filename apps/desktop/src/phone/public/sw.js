/*
 * ADCode Remote's service worker: the page opens instantly and offline, and never goes stale.
 *
 * - The page itself is network-first: a new release is picked up the moment there is a
 *   connection, and the cached copy is only for when there is none (a phone on a train still
 *   opens the app and says it is offline, instead of the browser's error page).
 * - Built assets have content hashes in their names, so they are cache-first and kept for good;
 *   each release's names are new, and old ones are dropped when this worker activates.
 * - Nothing else is touched: sign-in, the relay connection and every other origin go straight
 *   to the network. Nothing a person says is ever cached.
 */
const VERSION = "adcode-phone-v1";
const SHELL = ["/phone/", "/phone/manifest.webmanifest", "/phone/icon.svg", "/phone/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("adcode-phone-") && key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && url.pathname.startsWith("/phone")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) { const copy = response.clone(); void caches.open(VERSION).then((cache) => cache.put("/phone/", copy)); }
          return response;
        })
        .catch(() => caches.match("/phone/").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/phone/assets/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        if (response.ok) { const copy = response.clone(); void caches.open(VERSION).then((cache) => cache.put(request, copy)); }
        return response;
      })),
    );
  }
});
