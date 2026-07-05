// Bharat AI Innovation — minimal service worker for PWA install + offline
// resilience during the event (venue WiFi is often flaky). Network-first for
// navigations and API reads, falling back to cache; cache-first for static
// assets. Deliberately conservative so it never serves stale app code for long.

const VERSION = 'bhai-v1';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;

// Precache the essentials so the app opens offline.
const PRECACHE = [
  '/app',
  '/images/Bharat%20AI%20Innovation%20Logo.png',
  '/images/icon-192.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // only same-origin

  // API reads (schedule, attendees): network-first, cache fallback for offline.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Navigations: network-first so users get fresh app code, cache fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/app'))
    );
    return;
  }

  // Static assets (images, css, js): cache-first, then network.
  event.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
        }
        return res;
      })
    )
  );
});
