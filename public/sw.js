// Bharat AI Innovation — minimal service worker for PWA install + offline
// resilience during the event (venue WiFi is often flaky). Network-first for
// navigations and API reads, falling back to cache; stale-while-revalidate for
// static assets. Deliberately conservative so it never serves stale app code
// for more than the one load that refreshes it.

// Bump on any deploy that must reach returning visitors immediately: activate
// deletes every cache not ending in VERSION, so the next fetch repopulates.
// Bumped because pass-render.js (precached below) now reports a photo that
// failed to load and the page refuses to issue a pass on that flag; without
// this a returning visitor keeps the old renderer until it revalidates.
// Bumped again (v9) because API reads are cached here with no expiry and served
// whenever the network fails: a device that opened the Network tab before two
// speakers were removed from it kept the old list for offline use, and only a
// new VERSION deletes that cache.
// v10: the API cache is now an allowlist of public lists (below). Before this,
// every /api GET was stored - a person's inbox, connections and pass token
// included - and served offline to whoever picked up the phone next, sign-out
// or not. The bump throws away every copy already on a device.
// v11: the app's code left the /app page for its own file, /app.js (precached
// below, with an offline fallback in the fetch handler), the fonts moved onto
// this origin, and the precache keys now carry the ?v= the pages ask with.
// v12: the icon subset gained fa-unlock (fa-subset.css?v=2 and a new
// fa-solid-900.woff2 under the same name, which only a new VERSION replaces in
// this cache), and Tailwind's ?v= became a build hash, so it left the list.
// v17: the pass draws its own QR with /js/vendor/qrcode-generator.js (precached
// below, so a pass can still be made on venue WiFi) instead of fetching one from
// api.qrserver.com; pass-render.js?v=20261029 refuses to issue a pass without a QR.
// v18: the directory, connections and exhibitor leads stopped showing an unpaid
// paid tier as that pass (a VIP checkout left at CCAvenue now reads Visitor Pass),
// so the offline copies that still say VIP go.
// v20: the marketing nav changed (About to the footer, AI Marketplace added, the
// toggle menu below 1280px), so style.css?v=20261102 replaces 20261029d here.
// v21: pass-render.js?v=20261102 prints Exhibitor, Organiser, Jury, Media,
// Investor, Startup and Support Staff passes as themselves, not VISITOR PASS.
// v22: the edge cached the OLD pass-render.js under ?v=20261102 (fetched while the
// deploy was still spreading), so the renderer moved to ?v=20261102b.
// v23: pass-render.js?v=20261102c fits a long designation or organisation on the
// pass (smaller type, then an ellipsis) instead of running off both edges.
// 5 Nov 2026 (bhai-v26): style.css?v=20261105, the 13-link menu with Delhi 2027.
// 5 Nov 2026 (bhai-v27): style.css?v=20261105b, the 14-link menu with Govt.
// 6 Nov 2026 (bhai-v28): Dr. Vivek Bhoite off the speakers, so the offline list drops him.
// 6 Nov 2026 (bhai-v29): the app's new design and motion files join the offline list.
const VERSION = 'bhai-v30';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
// The badge desk's scanner page, kept so it opens with no internet (12 Nov 2026).
const DESK = `desk-${VERSION}`;

// The only API responses worth an offline copy: the event-wide lists that are
// the same for everyone. /api/events/:id itself is included because the Home
// tab cannot render without it. Everything else - anything under /attendees/,
// /messages/, connections, meetings, the pass token - is personal and goes
// straight to the network, never through a cache.
const API_CACHEABLE = /^\/api\/events\/[^/]+(\/(sessions|announcements|speakers|exhibitors)(\/[^/]*)?)?$/;
const API_PRIVATE = /\/(attendees|messages)\/|\/connections|\/meetings|my-pass-token/;

// Precache the essentials so the app opens offline. Same-origin only: addAll
// rejects the whole install if one entry fails, and a cross-origin CDN blip
// would then leave visitors with no service worker at all.
//
// The fetch handler matches on the full URL, so an entry must carry the ?v=
// the page asks with (a query-less key is one nobody ever asks for). Keep
// these in step with the script and stylesheet tags in public/*.html and
// src/index.tsx. /app.js is the exception: the page asks for /app.js?v=<hash>
// with a hash the worker computes, so it is stored here under its bare name
// and the fetch handler falls back to that copy when offline.
const PRECACHE = [
  '/app',
  '/app.js',                           // the app's code (GET /app.js in src/index.tsx)
  '/images/Bharat%20AI%20Innovation%20Logo.png',   // the pass and the social card draw it
  '/images/logo-nav.webp',             // every page's header
  '/images/icon-192.png',
  '/manifest.webmanifest',
  '/js/pass-render.js?v=20261102c',
  '/js/vendor/qrcode-generator.js?v=20261029',   // the pass draws its QR with it
  '/css/style.css?v=20261105b',        // marketing shell: /, /conference, /exhibition, ...
  '/js/main.js?v=20261029',
  '/js/carousel.js?v=20261027',
];

// Assets from the self-hosting workstream (Tailwind compiled at build time,
// Font Awesome subset, the fonts since 27 Oct 2026). Warmed separately and
// best-effort ON PURPOSE: these are generated by the build, and a single 404
// inside addAll would abort the install permanently rather than cost us one
// uncached file.
//
// The ?v= must match what the pages actually request (TW_CSS / FA_CSS in
// src/index.tsx): the fetch handler below matches on the full URL, so a
// query-less entry here caches a key nobody ever asks for. Bump these with
// those. The woff2 URLs inside fa-subset.css and fonts.css carry no query, so
// they don't.
const PRECACHE_OPTIONAL = [
  // No tailwind.css: its ?v= is a hash of the build (TW_CSS), so no key written
  // here could match; the first page that loads it puts it in this cache.
  '/css/fa-subset.css?v=2',
  '/css/fonts.css?v=1',             // the marketing site
  '/css/fonts-app.css?v=1',         // /app, /admin and the other worker pages
  '/css/app-design.css?v=20261106', // /app: the website's design
  '/css/app-motion.css?v=20261106', // /app: its motion
  '/js/app-motion.js?v=20261106',   // /app: its motion
  '/fonts/manrope-latin-300-800.woff2',           // the body font everywhere
  '/fonts/bricolage-grotesque-latin-400-800.woff2', // the app's headings
  '/js/social-card.js?v=20261102',
  '/images/favicon-64.png',
  '/webfonts/fa-solid-900.woff2',
  '/webfonts/fa-brands-400.woff2',
  '/webfonts/fa-regular-400.woff2',   // the hollow half of the marketplace rating stars
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(PRECACHE).then(() =>
        Promise.all(PRECACHE_OPTIONAL.map((u) => c.add(u).catch(() => {})))
      ))
      .then(() => self.skipWaiting())
  );
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

// The badge desk with no signal. A pass check that did not reach the server is
// NOT a check: one red screen, said plainly, with the way out. It tries the same
// pass again by itself the moment the phone is back online.
function deskOffline(isPassCheck) {
  const title = isPassCheck ? 'This pass was NOT checked.' : 'The badge desk needs internet.';
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>No internet</title>'
    + '<style>html,body{margin:0;height:100%;background:#B91C1C;color:#fff;font-family:Arial,sans-serif}'
    + 'main{min-height:100%;display:flex;flex-direction:column;justify-content:center;padding:28px;box-sizing:border-box;text-align:center}'
    + 'h1{font-size:34px;margin:0 0 14px}p{font-size:22px;line-height:1.4;margin:0 0 12px}'
    + 'a,button{display:block;width:100%;max-width:420px;margin:10px auto 0;padding:16px;border-radius:12px;font-size:19px;font-weight:bold;border:0;text-decoration:none;box-sizing:border-box}'
    + 'a{background:#fff;color:#B91C1C}button{background:rgba(255,255,255,0.18);color:#fff}</style></head>'
    + '<body><main><h1>No internet</h1><p><strong>' + title + '</strong></p>'
    + '<p>Move to better signal and scan again.</p>'
    + (isPassCheck ? '<button onclick="location.reload()">Check this pass again</button>' : '')
    + '<a href="/staff/scan">Scan again</a></main>'
    + '<script>addEventListener("online",function(){location.reload()})</script></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// The scanner page itself (12 Nov 2026). With the list of passes saved on the phone the
// scanner can work with no internet, but only if the page can open: a phone that had
// reloaded it, or opened it from the home screen, got the red page instead. So the last
// copy served to a signed-in desk is kept and used ONLY when the network does not
// answer. The server sending the phone to the sign-in page, or refusing it, throws the
// copy away, and so does signing out (the page deletes this cache). /verify/ and the
// sign-in page are never served from a copy.
function deskScanner(request) {
  return fetch(request).then((res) => {
    if (res.ok && !res.redirected) {
      const copy = res.clone();
      caches.open(DESK).then((c) => c.put('/staff/scan', copy));
    } else if (res.type === 'opaqueredirect' || res.redirected || res.status === 401 || res.status === 403) {
      caches.open(DESK).then((c) => c.delete('/staff/scan'));
    }
    return res;
  }).catch(() => caches.open(DESK).then((c) => c.match('/staff/scan')).then((hit) => hit || deskOffline(false)));
}
// The scanner page asks for its copy as soon as this worker is in charge, so a desk
// phone is ready after opening the scanner once, not twice.
self.addEventListener('message', (event) => {
  if (event.data !== 'desk-keep') return;
  event.waitUntil(
    fetch('/staff/scan', { credentials: 'same-origin' })
      .then((res) => (res.ok && !res.redirected ? caches.open(DESK).then((c) => c.put('/staff/scan', res)) : null))
      .catch(() => {})
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // only same-origin

  // The Campus Series insights reports are PDFs behind a signed link, several
  // MB each: never a copy in the shell cache, and never served to the next
  // person who picks up the phone.
  if (url.pathname.startsWith('/reports/')) return;

  // API reads: network-first with an offline fallback, but only for the public
  // lists in API_CACHEABLE, and only 2xx bodies - a 401 or a 500 must never
  // become the copy that is served when the venue WiFi drops.
  if (url.pathname.startsWith('/api/')) {
    if (API_PRIVATE.test(url.pathname) || !API_CACHEABLE.test(url.pathname)) return;
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Navigations: network-first so users get fresh app code, cache fallback.
  // Not for the badge desk (organiser, 2 Nov 2026): a pass check that could not
  // reach the server showed the attendee app, which reads as neither valid nor
  // invalid, so a person could be waved in unchecked. It now says so, in red.
  if (request.mode === 'navigate') {
    if (url.pathname === '/staff/scan') { event.respondWith(deskScanner(request)); return; }
    if (url.pathname.startsWith('/verify/') || url.pathname.startsWith('/staff')) {
      event.respondWith(fetch(request).catch(() => deskOffline(url.pathname.startsWith('/verify/'))));
      return;
    }
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
      // /app.js?v=<hash> never fetched through here, and no network: the copy
      // precached as /app.js came from the same deploy as the precached /app
      // that is asking for it, so the two agree.
      if (url.pathname === '/app.js') return network.catch(() => caches.match('/app.js'));
      return network;
    })
  );
});
