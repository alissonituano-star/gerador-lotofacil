const CACHE_PREFIX = "gerador-lotofacil-";
const CACHE_NAME = `${CACHE_PREFIX}v13`;
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=13",
  "./app.js?v=13",
  "./daily-model.js?v=13",
  "./diary.js?v=13",
  "./game-rating.js?v=13",
  "./lottery-math.js?v=13",
  "./manifest.webmanifest",
  "./data/lotofacil.json",
  "./assets/icon.svg?v=10",
  "./assets/icon-192.png?v=10",
  "./assets/icon-512.png?v=10",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: "reload" })))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const networkResponse = event.request.mode === "navigate"
    ? fetch(event.request, { cache: "no-cache" })
    : fetch(event.request);
  event.waitUntil(networkResponse.then((response) => {
    if (!response.ok) return;
    const copy = response.clone();
    return caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
  }).catch(() => {}));
  event.respondWith(networkResponse.catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    if (event.request.mode === "navigate") {
      return (await cache.match("./index.html")) ?? Response.error();
    }
    return Response.error();
  }));
});
