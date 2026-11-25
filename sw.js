importScripts("./notification-diary.js?v=20", "./draw-notification.js?v=20");

const CACHE_PREFIX = "gerador-lotofacil-";
const CACHE_NAME = `${CACHE_PREFIX}v21`;
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=21",
  "./app.js?v=21",
  "./push-settings.js?v=20",
  "./notification-config.js?v=20",
  "./notification-diary.js?v=20",
  "./draw-notification.js?v=20",
  "./caixa-results.js?v=19",
  "./clipboard.js?v=17",
  "./field-actions.js?v=17",
  "./report-screen.js?v=21",
  "./report-charts.js?v=18",
  "./report-pdf.js?v=18",
  "./assets/jspdf.umd.min.js?v=18",
  "./diary-report.js?v=18",
  "./contest-payout.js?v=16",
  "./contest-comparison.js?v=14",
  "./contest-simulation.js?v=15",
  "./daily-model.js?v=18",
  "./diary.js?v=20",
  "./game-rating.js?v=15",
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
  if (event.request.cache === "no-store" && new URL(event.request.url).origin !== self.location.origin) return;

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
