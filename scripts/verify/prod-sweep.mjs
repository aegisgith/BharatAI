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
check('admin page carries the new tools', r.text.includes('downloadCsvViaApi') && r.text.includes('checkin-reset') && !/export\?token=/.test(r.text), 'markers');
// ---- attendee batch ----
r = await hit('/api/attendees/1/threads');
check('threads need a session', r.status === 401, r.status);
r = await hit('/api/attendees/logout', { method: 'POST' });
check('logout expires the cookie', r.status < 400 && /Max-Age=0/i.test(r.h['set-cookie'] || ''), r.status + ' ' + r.h['set-cookie']);
r = await hit('/app');
check('app page carries the new client code', ['function parseDbTime', 'function safeUrl', 'id="notif-sheet"', 'function loadThreads', 'function closeTopModal'].every(m => r.text.includes(m)), 'markers');
r = await hit('/sw.js');
check('service worker is bhai-v10', r.status === 200 && r.text.includes("'bhai-v10'"), r.status);

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
check('the admin page runs panel email as server jobs', r.text.includes('function startMailJob') && r.text.includes('mail-jobs/tick') && !r.text.includes('pumpPanelReports'), 'markers');

console.log(fails ? `\n${fails} FAILED` : '\nall production checks passed');
process.exit(fails ? 1 : 0);
