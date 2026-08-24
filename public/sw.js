// Bharat AI Innovation — minimal service worker for PWA install + offline
// resilience during the event (venue WiFi is often flaky). Network-first for
// navigations and API reads, falling back to cache; stale-while-revalidate for
// static assets. Deliberately conservative so it never serves stale app code
// for more than the one load that refreshes it.

// Bump on any deploy that must reach returning visitors immediately: activate
// deletes every cache not ending in VERSION, so the next fetch repopulates.
const VERSION = 'bhai-v3';
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

// Web Push: show a notification when the server pushes one (VAPID backend is a
// follow-up; this handler is ready for it). Clicking focuses/opens the app.
self.addEventListener('push', (event) => {
  let data = { title: 'Bharat AI Innovation 2026', body: 'New update' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body, icon: '/images/icon-192.png', badge: '/images/icon-192.png', tag: 'bhai-push',
    })
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((cs) => {
      for (const c of cs) { if (c.url.includes('/app') && 'focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('/app');
    })
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

  // Static assets (images, css, js): stale-while-revalidate. Serve the cached
  // copy immediately (venue WiFi), but always refetch in the background so the
  // next load has fresh code. Plain cache-first never re-checked the network,
  // which pinned js/main.js and css/style.css at whatever version a visitor
  // first saw -- deploys silently never reached returning users.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
        }
        return res;
      });
      // Offline with a cached copy: swallow the rejection, we already have a
      // response to return. Offline with none: let it propagate as the failure.
      if (cached) { network.catch(() => {}); return cached; }
      return network;
    })
  );
});
