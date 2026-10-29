// Production sweep, read-only, no credentials: pages, headers, guards, caches, new routes.
// node scripts/verify/prod-sweep.mjs
// Production sweep: every changed route answers as designed, public pages
// respond, and nothing that worked before stopped working.
const base = 'https://bharataiinnovation.com';
const hit = async (path, init = {}) => {
  const res = await fetch(base + path, { redirect: 'manual', ...init, headers: { 'cache-control': 'no-cache', ...(init.headers || {}) } });
  const text = await res.text();
  return { status: res.status, h: Object.fromEntries(res.headers), text };
};
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <- ' + detail)); if (!ok) fails++; };

let r = await hit('/health');
check('health is up', r.status === 200 && r.text.includes('"db":"up"'), r.status + ' ' + r.text.slice(0, 100));

r = await hit('/app');
check('/app 200 with security headers', r.status === 200 && r.h['x-content-type-options'] === 'nosniff' && r.h['x-frame-options'] === 'SAMEORIGIN', r.status + ' ' + JSON.stringify([r.h['x-content-type-options'], r.h['x-frame-options']]));
r = await hit('/admin');
check('/admin 200', r.status === 200, r.status);
for (const p of ['/', '/campus-djsanghvi', '/campus-series', '/marketplace', '/partner', '/about']) {
  r = await hit(p);
  check(`${p} 200`, r.status === 200, r.status);
}
r = await hit('/');
check('static site carries _headers', r.h['x-content-type-options'] === 'nosniff', JSON.stringify(r.h['x-content-type-options']));

r = await hit('/api/attendees/5/exhibitor');
check('exhibitor lookup needs a session (401)', r.status === 401, r.status + ' ' + r.text.slice(0, 80));

r = await hit('/api/rsvp?email=nobody%40example.com&status=declined&event=1');
check('unsigned RSVP link: 302 to confirmation, no oracle', r.status === 302 && String(r.h.location || '').includes('/rsvp-confirmed'), r.status + ' ' + r.h.location);
r = await hit('/api/rsvp?email=nobody%40example.com&status=bogus');
check('malformed RSVP 400', r.status === 400, r.status);

r = await hit('/unsubscribe?e=nobody%40example.com&t=0000000000000000000000000000abcd');
check('unsubscribe page rejects a bad token', r.status === 200 && r.text.includes('not valid'), r.status);

r = await hit('/api/events/1/announcements');
check('announcements: JSON, cache header, <= 20', r.status === 200 && /max-age=30/.test(r.h['cache-control'] || '') && JSON.parse(r.text).length <= 20, r.status + ' ' + r.h['cache-control']);

r = await hit('/api/events/1/stats');
check('stats: JSON with 60 s cache for the public', r.status === 200 && /max-age=60/.test(r.h['cache-control'] || ''), r.status + ' ' + r.h['cache-control']);

r = await hit('/api/events/1/sessions');
check('sessions still answer', r.status === 200 && r.text.startsWith('['), r.status);
r = await hit('/api/events/1/speakers');
check('speakers still sign-in gated (as before today)', r.status === 401, r.status);

r = await hit('/api/image-proxy?url=' + encodeURIComponent('https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=smoke'));
check('image proxy still serves the QR service', r.status === 200 && /image/.test(r.h['content-type'] || ''), r.status + ' ' + r.h['content-type']);
r = await hit('/api/image-proxy?url=https://evil.example/x.png');
check('image proxy allowlist holds', r.status === 403, r.status);

r = await hit('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: 1, sender_id: 1, receiver_id: 2, content: 'x' }) });
check('message without a session is refused', r.status === 401, r.status + ' ' + r.text.slice(0, 60));

r = await hit('/api/admin/settings');
check('settings without auth is 401', r.status === 401, r.status);

r = await hit('/js/social-card.js');
check('social card renderer served', r.status === 200 && r.text.includes('panel_attended'), r.status);
r = await hit('/webfonts/fa-solid-900.woff2');
check('regenerated icon font served (17960 bytes)', r.status === 200 && Number(r.h['content-length'] || r.text.length) >= 17000, r.status + ' ' + r.h['content-length']);

// ---- admin + desk batch ----
r = await hit('/api/desk/walkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
check('desk walk-in needs a desk session', r.status === 401, r.status);
r = await hit('/api/desk/reissue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
check('desk reissue needs a desk session', r.status === 401, r.status);
r = await hit('/api/admin/attendees/1/checkin-reset', { method: 'POST' });
check('check-in reset needs admin', r.status === 401, r.status);
r = await hit('/api/admin/events/1/attendees/not-arrived.csv');
check('not-arrived export needs admin', r.status === 401, r.status);
r = await hit('/admin');
// The admin page's code is its own file; read the one the page asks for (the bare
// /admin.js at the edge was a 30-hour-old immutable copy on 29 Oct 2026).
r.text += (await hit('/admin.js?v=' + ((/\/admin\.js\?v=([0-9a-f]{8})/.exec(r.text) || [])[1] || ''))).text;
check('admin page carries the new tools', r.text.includes('downloadCsvViaApi') && r.text.includes('checkin-reset') && !/export\?token=/.test(r.text), 'markers');
// ---- attendee batch ----
r = await hit('/api/attendees/1/threads');
check('threads need a session', r.status === 401, r.status);
r = await hit('/api/attendees/logout', { method: 'POST' });
check('logout expires the cookie', r.status < 400 && /Max-Age=0/i.test(r.h['set-cookie'] || ''), r.status + ' ' + r.h['set-cookie']);
r = await hit('/app');
// The app's code is its own file; read the one the page asks for, not the bare
// /app.js the edge may hold an older copy of.
r.text += (await hit('/app.js?v=' + ((/\/app\.js\?v=([0-9a-f]{8})/.exec(r.text) || [])[1] || ''))).text;
check('app page carries the new client code', ['function parseDbTime', 'function safeUrl', 'id="notif-sheet"', 'function loadThreads', 'function closeTopModal'].every(m => r.text.includes(m)), 'markers');
r = await hit('/sw.js');
check('service worker is bhai-v18 (unpaid tiers no longer cached as VIP; the QR encoder still precached)', r.status === 200 && r.text.includes("'bhai-v18'") && r.text.includes('/js/vendor/qrcode-generator.js?v=20261029'), r.status);

// ---- the 29 Oct 2026 audit: a passes page, and the app's Visitor fixes ----
r = await hit('/passes');
check('/passes is served with the comparison and the VIP gala row', r.status === 200 && ['Passes for Bharat AI Innovation 2026', 'CXO Gala Networking Evening, Day 1', 'class="pcmp"'].every(m => r.text.includes(m)), r.status);
// The hashed URL the page loads, not the bare /app.js: that one is the offline
// fallback and the edge may hold an older copy of it.
r = await hit('/app');
const appTag = /<script src="(\/app\.js\?v=[0-9a-f]{8})"><\/script>/.exec(r.text);
r = appTag ? await hit(appTag[1]) : { status: 0, text: '' };
check('app code carries the Visitor fixes', ['function inboxEmpty', 'function downloadAgendaIcs', 'function renderVisitorChecklist', 'function inviteColleague', "reason === 'passcard'"].every(m => r.text.includes(m)), (appTag ? appTag[1] : 'no versioned /app.js tag') + ' ' + r.status);
r = await hit('/');
check('home hero sells the Delegate Pass first', r.status === 200 && r.text.includes('hero-passline') && r.text.indexOf('/register#delegate') < r.text.indexOf('Free Visitor Pass') && !r.text.includes('5,000+'), r.status);

// ---- what a phone downloads, second pass (28 Oct 2026) ----
r = await hit('/admin');
const adminTag = /<script src="(\/admin\.js\?v=[0-9a-f]{8})"><\/script>/.exec(r.text);
check('/admin loads its code from a versioned /admin.js', !!adminTag, 'no versioned /admin.js tag');
if (adminTag) {
  r = await hit(adminTag[1]);
  check('/admin.js is JavaScript a browser may keep for a year', r.status === 200 && /javascript/.test(r.h['content-type'] || '') && /max-age=31536000/.test(r.h['cache-control'] || ''), r.status + ' ' + r.h['content-type'] + ' ' + r.h['cache-control']);
}
r = await hit('/app');
const twTag = /href="\/css\/tailwind\.css\?v=([0-9a-f]{10})"/.exec(r.text);
check('Tailwind is asked for by a hash of the build', !!twTag, 'no hashed tailwind.css link');
r = await hit('/css/fa-subset.css?v=2');
check('the icon subset draws the unlock icon', r.status === 200 && r.text.includes('.fa-unlock::before'), r.status);
r = await hit('/api/company-logo?d=infosys.com');
check('a known company icon comes through this site', r.status === 200 && /^image\//.test(r.h['content-type'] || ''), r.status + ' ' + r.h['content-type']);
r = await hit('/api/company-logo?d=no-such-company-xyz-4821.com');
check('an unknown company has no icon (a bare 404, so the card hides it)', r.status === 404 && r.text === '', r.status + ' ' + r.text.length);
r = await hit('/api/company-logo?d=' + encodeURIComponent('evil.example/../x'));
check('the company-logo route takes a hostname and nothing else', r.status === 400, r.status);

// ---- what a phone downloads (27 Oct 2026) ----
// The year is for the versioned URL the page asks for. The bare /app.js is the
// service worker's offline copy: ten minutes from the worker (the zone's Browser
// Cache TTL makes it four hours), never immutable. This check expected a year
// until 29 Oct 2026 and passed only while the edge still held a stale immutable copy.
r = await hit('/app');
r = await hit('/app.js?v=' + ((/\/app\.js\?v=([0-9a-f]{8})/.exec(r.text) || [])[1] || ''));
check('/app.js?v= is JavaScript a phone may keep for a year', r.status === 200 && /javascript/.test(r.h['content-type'] || '') && /max-age=31536000/.test(r.h['cache-control'] || ''), r.status + ' ' + r.h['content-type'] + ' ' + r.h['cache-control']);
r = await hit('/app.js');
check('bare /app.js is never kept for a year', r.status === 200 && /javascript/.test(r.h['content-type'] || '') && !/immutable|max-age=31536000/.test(r.h['cache-control'] || ''), r.status + ' ' + r.h['cache-control']);
r = await hit('/css/fonts.css?v=1');
check('the fonts come from this origin', r.status === 200 && r.text.includes('url(/fonts/manrope-latin-300-800.woff2)'), r.status);
r = await hit('/fonts/manrope-latin-300-800.woff2');
check('the body font is served and kept for a year', r.status === 200 && /immutable/.test(r.h['cache-control'] || ''), r.status + ' ' + r.h['cache-control']);
r = await hit('/css/style.css?v=20261004d');
check('stylesheets are kept for a week, not four hours', r.status === 200 && /max-age=604800/.test(r.h['cache-control'] || ''), r.status + ' ' + r.h['cache-control']);
r = await hit('/images/logo-nav.webp');
check('the small logo is served', r.status === 200 && /webp/.test(r.h['content-type'] || ''), r.status + ' ' + r.h['content-type']);
r = await hit('/favicon.ico');
check('/favicon.ico answers', r.status === 200, r.status);
r = await hit('/');
check('the home page fetches nothing from Google Fonts or the favicon service', r.status === 200 && !/fonts\.g(oogleapis|static)\.com|google\.com\/s2\/favicons/.test(r.text), r.status);

// ---- Campus Series insights reports ----
r = await hit('/insights');
check('/insights 200 with the form', r.status === 200 && r.text.includes('id="ir-form"') && r.text.includes('/api/reports/request'), r.status);
r = await hit('/reports/djsce-ai-and-employability-insights-report.pdf');
check('a report without a link is not served (302 to the form)', r.status === 302 && String(r.h.location || '').includes('/insights'), r.status + ' ' + r.h.location);
r = await hit('/reports/djsce-ai-and-employability-insights-report.pdf?t=l1.9999999999.000000000000000000000000');
check('a forged report link is refused the same way', r.status === 302, r.status);
r = await hit('/api/reports/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
check('the report form refuses an empty request (400, nothing kept)', r.status === 400 && /missing/.test(r.text), r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/admin/reports/summary');
check('report numbers need admin', r.status === 401, r.status);
r = await hit('/api/admin/panels/djsanghvi-21sep/send-next-reports', { method: 'POST' });
check('the reports pump needs admin', r.status === 401, r.status);
for (const [p, id] of [['/campus-djsanghvi', 'fIPXB3mTNOM'], ['/campus-jnu', '6tlYBxAPw3g']]) {
  r = await hit(p);
  check(`${p} embeds the recording, tracked`, r.status === 200 && r.text.includes('youtube-nocookie.com/embed/' + id + '?enablejsapi=1') && r.text.includes('js/watch-track.js'), r.status);
}
r = await hit('/r/djsce');
check('a report link without a token goes to the form', r.status === 302 && String(r.h.location || '').includes('/insights'), r.status + ' ' + r.h.location);
r = await hit('/w/jnu');
check('a recording link without a token still plays the video', r.status === 302 && String(r.h.location || '').includes('youtube.com/watch?v=6tlYBxAPw3g'), r.status + ' ' + r.h.location);
r = await hit('/api/reports/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: 'no-such-report' }) });
check('the play counter answers 204 and writes nothing for an unknown recording', r.status === 204, r.status);
r = await hit('/api/admin/reports/people?what=opened');
check('who opened and who watched need admin', r.status === 401, r.status);
r = await hit('/js/watch-track.js');
check('the play tracker is served', r.status === 200 && r.text.includes('/api/reports/watch'), r.status);

// ---- panel email as server jobs ----
r = await hit('/api/cron/tick', { method: 'POST' });
check('the scheduler door needs its secret', r.status === 401, r.status);
r = await hit('/api/admin/mail-jobs');
check('the jobs view needs admin', r.status === 401, r.status);
r = await hit('/api/admin/mail-jobs/tick', { method: 'POST' });
check('the page tick needs admin', r.status === 401, r.status);
r = await hit('/admin');
// The admin page's code is its own file; read the one the page asks for (the bare
// /admin.js at the edge was a 30-hour-old immutable copy on 29 Oct 2026).
r.text += (await hit('/admin.js?v=' + ((/\/admin\.js\?v=([0-9a-f]{8})/.exec(r.text) || [])[1] || ''))).text;
check('the admin page runs panel email as server jobs', r.text.includes('function startMailJob') && r.text.includes('mail-jobs/tick') && !r.text.includes('pumpPanelReports'), 'markers');
check('the admin Overview has the Pass & badge card with Send the steps', r.text.includes('function loadHelpFunnel') && r.text.includes('/api/admin/help-mail/send'), 'markers');

// The way in (29 Oct 2026): the startup check, the doors it and the app use, and
// /app.js kept for a year only under its own version. Nothing is written: every
// request below is refused before it reaches a table.
r = await hit('/app');
const appV = (/\/app\.js\?v=([0-9a-f]{8})/.exec(r.text) || [])[1];
check('/app carries the startup check before its code, and the sign-in note', r.text.includes('window.__bhaiBoot') && r.text.indexOf('window.__bhaiBoot') < r.text.indexOf('/app.js?v=') && r.text.includes('id="signin-note"'), 'markers');
r = await hit('/app.js?v=' + appV);
check('/app.js under its own version: kept for a year, and starts the check', /immutable/.test(r.h['cache-control'] || '') && r.text.includes('window.__bhaiBoot.start()'), r.h['cache-control']);
r = await hit('/app.js?v=00000000');
check('/app.js under another version: answered, never kept', r.status === 200 && r.h['cache-control'] === 'no-store', r.h['cache-control']);
r = await hit('/api/app-boot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'live-check' }) });
check('the startup report refuses an unknown stage (400)', r.status === 400, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/attendees/1/track-step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'card', step: 'open' }) });
check('a badge or pass step needs the person signed in (401)', r.status === 401, r.status + ' ' + r.text.slice(0, 80));
for (const [m, p] of [['GET', '/api/admin/help-stats'], ['POST', '/api/admin/help-mail/send'], ['POST', '/api/admin/help-mail/auto'], ['GET', '/api/admin/help-mail/preview']]) {
  r = await hit(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'POST' ? '{}' : undefined });
  check(`${m} ${p} needs admin (401)`, r.status === 401, r.status);
}

console.log(fails ? `\n${fails} FAILED` : '\nall production checks passed');
process.exit(fails ? 1 : 0);
