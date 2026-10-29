// Built-worker route checks: admin + badge desk + security batch (+ attendee routes with arg 'attendee').
// Run after `npm run build`:  node scripts/verify/smoke-routes.mjs attendee
// Built-worker smoke tests for the admin/desk batch and (when present) the attendee batch.
// No DB: routes must refuse unauthenticated callers before touching D1, and an
// authorised call that reaches D1 must land in onError as JSON, not crash.
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const env = new Proxy({ ADMIN_SECRET: 'smoke-secret', SESSION_SECRET: 'smoke-session' }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const base = 'https://bharataiinnovation.com';
const hit = async (path, init) => {
  const res = await worker.fetch(new Request(base + path, init), env, ctx);
  const text = await res.text();
  return { status: res.status, h: Object.fromEntries(res.headers), text };
};
const json = (method, body, auth) => ({ method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer smoke-secret' } : {}) }, body: JSON.stringify(body || {}) });
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <- ' + detail)); if (!ok) fails++; };
const phase = process.argv[2] || 'admin';

// ---- admin / desk batch ----
let r = await hit('/api/desk/walkin', json('POST', { name: 'A', email: 'a@b.co' }));
check('desk walk-in refuses without a desk session', r.status === 401, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/desk/reissue', json('POST', { email: 'a@b.co' }));
check('desk reissue refuses without a desk session', r.status === 401, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/admin/attendees/5/checkin-reset', json('POST', {}));
check('check-in reset refuses without admin', r.status === 401, r.status);
r = await hit('/api/admin/attendees/5/checkin-reset', json('POST', {}, true));
check('check-in reset with admin reaches the handler (JSON 500 without DB)', r.status === 500 && r.text.startsWith('{'), r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/admin/events/1/attendees/not-arrived.csv');
check('not-arrived CSV refuses without admin', r.status === 401, r.status);
r = await hit('/api/admin/staff');
check('staff list refuses without admin', r.status === 401, r.status);
r = await hit('/api/admin/attendees/bulk-update', json('POST', { ids: [1], changes: { badge_type: 'VIP Pass' } }));
check('bulk update refuses without admin', r.status === 401, r.status);
r = await hit('/admin');
check('/admin renders', r.status === 200 && r.text.includes('<html'), r.status);
check('/admin loads its code from a versioned /admin.js', /<script src="\/admin\.js\?v=[0-9a-f]{8}"><\/script>/.test(r.text), 'no versioned /admin.js tag');
{
  const js = await hit('/admin.js?v=00000000');
  check('/admin.js?v= is JavaScript a browser may keep for a year', js.status === 200 && /javascript/.test(js.h['content-type'] || '') && /immutable/.test(js.h['cache-control'] || ''), js.status + ' ' + js.h['content-type'] + ' ' + js.h['cache-control']);
  r.text += js.text;   // the admin page's code is its own file: a marker below is in one or the other
}
for (const marker of ['checkin-reset', 'not-arrived.csv', 'downloadCsvViaApi', 'PAYMENT_STATUSES', 'BADGE_TYPES', 'previewPanelEmail', 'Panel only (not opted in)']) {
  check('/admin carries ' + marker, r.text.includes(marker), 'missing');
}
check('/admin no longer puts the secret in a URL', !/export\?token=/.test(r.text), 'export?token= still present');
r = await hit('/api/company-logo?d=' + encodeURIComponent('evil.example/../x'));
check('the company-logo route takes a hostname and nothing else', r.status === 400, r.status);
r = await hit('/app');
check('/app asks no outside avatar service', !/ui-avatars\.com|gravatar\.com/.test(r.text + (await hit('/app.js')).text), 'an outside avatar URL is left');
check('/app asks Google for no company icon itself', !/s2\/favicons/.test((await hit('/app.js')).text), 'the app still loads favicons from Google');
r = await hit('/staff/scan', { redirect: 'manual' });
check('/staff/scan without a session redirects or renders, never 500', r.status !== 500, r.status);

// ---- security batch must still hold after the merge ----
r = await hit('/api/attendees/5/exhibitor');
check('exhibitor lookup still guarded', r.status === 401, r.status);
r = await hit('/api/rsvp?email=x%40y.com&status=declined&event=1', { redirect: 'manual' });
check('unsigned RSVP still a plain redirect', r.status === 302, r.status);
r = await hit('/health');
check('health route still present', r.status === 503 && r.text.includes('"db":"down"'), r.status);
r = await hit('/api/messages', json('POST', { event_id: 1, sender_id: 1, receiver_id: 2, content: 'x' }));
check('message gate still refuses without a session', r.status === 401, r.status);

// ---- attendee batch ----
if (phase === 'attendee') {
  r = await hit('/api/attendees/5/threads');
  check('threads route needs a session', r.status === 401, r.status + ' ' + r.text.slice(0, 80));
  r = await hit('/api/attendees/logout', json('POST', {}));
  const sc = r.h['set-cookie'] || '';
  check('logout expires the session cookie', r.status < 400 && /bai_session=;/.test(sc) && /Max-Age=0/i.test(sc), r.status + ' ' + sc);
  r = await hit('/api/exhibitors/3/visit', json('POST', { attendee_id: 5 }));
  check('booth visit refuses without a session', r.status === 401, r.status + ' ' + r.text.slice(0, 80));
  r = await hit('/app');
  check('/app renders', r.status === 200 && r.text.includes('<html'), r.status);
  check('/app loads its code from a versioned /app.js', /<script src="\/app\.js\?v=[0-9a-f]{8}"><\/script>/.test(r.text), 'no versioned /app.js tag');
  const appJs = await hit('/app.js?v=00000000');
  check('/app.js?v= is JavaScript a phone may keep for a year', appJs.status === 200 && /javascript/.test(appJs.h['content-type'] || '') && /immutable/.test(appJs.h['cache-control'] || ''), appJs.status + ' ' + appJs.h['content-type'] + ' ' + appJs.h['cache-control']);
  // The bare path is the service worker's offline fallback: ten minutes, never
  // immutable, or the edge keeps an old deploy's copy for a year (seen 29 Oct 2026).
  const bareJs = await hit('/app.js');
  check('bare /app.js is kept for minutes, not a year', bareJs.status === 200 && /max-age=600/.test(bareJs.h['cache-control'] || '') && !/immutable/.test(bareJs.h['cache-control'] || ''), bareJs.status + ' ' + bareJs.h['cache-control']);
  check('bare /app.js is the same code as the versioned one', bareJs.text === appJs.text, 'differ');
  r.text += appJs.text;   // the app's code is its own file: a marker below is in one or the other
  for (const marker of ['function parseDbTime', 'function apiFailed', 'function safeUrl', 'id="notif-sheet"', 'id="directory-chips"', 'aria-live="polite"', 'function closeTopModal', 'function loadThreads', 'answerMainEvent', 'conferenceAllowed', 'function openSocialCard']) {
    check('/app carries ' + marker, r.text.includes(marker), 'missing');
  }
}

console.log(fails ? `\n${fails} FAILED` : `\nall ${phase} smoke checks passed`);
process.exit(fails ? 1 : 0);
