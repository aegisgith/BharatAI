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
for (const marker of ['checkin-reset', 'not-arrived.csv', 'downloadCsvViaApi', 'PAYMENT_STATUSES', 'BADGE_TYPES', 'previewPanelEmail', 'Panel only (not opted in)']) {
  check('/admin carries ' + marker, r.text.includes(marker), 'missing');
}
check('/admin no longer puts the secret in a URL', !/export\?token=/.test(r.text), 'export?token= still present');
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
  for (const marker of ['function parseDbTime', 'function apiFailed', 'function safeUrl', 'id="notif-sheet"', 'id="directory-chips"', 'aria-live="polite"', 'function closeTopModal', 'function loadThreads', 'answerMainEvent', 'conferenceAllowed', 'function openSocialCard']) {
    check('/app carries ' + marker, r.text.includes(marker), 'missing');
  }
}

console.log(fails ? `\n${fails} FAILED` : `\nall ${phase} smoke checks passed`);
process.exit(fails ? 1 : 0);
