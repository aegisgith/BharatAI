// Built-worker checks for the AI Marketplace (/marketplace + /api/mp/*).
// Run after `npm run build`:  node scripts/verify/smoke-marketplace.mjs
//
// No DB, like smoke-routes.mjs: every guard here must refuse before touching D1, so
// a 403/401/400 proves the gate and a JSON 500 proves the caller got past it. The
// rules worth keeping: an unreviewed listing is not public, the admin routes take
// the event panel's sign-in but never a ?token= in the URL, and the pages carry the
// script versions the service worker needs to fetch afresh.
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;
const env = new Proxy({ ADMIN_SECRET: 'smoke-secret', SESSION_SECRET: 'smoke-session', MP_SESSION_SECRET: 'smoke-mp' }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const base = 'https://bharataiinnovation.com';
const hit = async (path, init) => {
  const res = await worker.fetch(new Request(base + path, init), env, ctx);
  return { status: res.status, h: Object.fromEntries(res.headers), text: await res.text() };
};
const post = (body, auth) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer smoke-secret' } : {}) }, body: JSON.stringify(body || {}) });
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <- ' + detail)); if (!ok) fails++; };

// ---- admin routes: closed to the public, open to the event admin panel ----
const ADMIN_GET = ['/api/mp/admin/listings', '/api/mp/admin/listings?status=pending', '/api/mp/admin/stats', '/api/mp/admin/inquiries', '/api/mp/admin/exhibitors', '/api/mp/admin/exhibitor-invites'];
for (const p of ADMIN_GET) {
  const r = await hit(p);
  check('refuses anonymous: ' + p, r.status === 403, r.status + ' ' + r.text.slice(0, 60));
}
for (const p of ['/api/mp/admin/listings/1/remind', '/api/mp/admin/exhibitors/1/invite', '/api/mp/admin/listings/bulk']) {
  const r = await hit(p, post({}));
  check('refuses anonymous: POST ' + p, r.status === 403, r.status + ' ' + r.text.slice(0, 60));
}
let r = await hit('/api/mp/admin/listings/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"status":"approved"}' });
check('refuses anonymous: PATCH listing status', r.status === 403, r.status);

// The panel's own check also accepts ?token=<secret>; the marketplace must not, or a
// link would carry the master secret into history, logs and every Referer.
for (const p of ['/api/mp/admin/listings?token=smoke-secret', '/api/mp/admin/exhibitor-invites?token=smoke-secret']) {
  r = await hit(p);
  check('refuses ?token= in the URL: ' + p.split('?')[0], r.status === 403, r.status);
}
r = await hit('/api/mp/auth/me?token=smoke-secret');
check('?token= does not make /me an event admin', r.status === 200 && JSON.parse(r.text).event_admin === false, r.text.slice(0, 80));
r = await hit('/api/mp/admin/listings', { headers: { Authorization: 'Bearer wrong' } });
check('wrong admin password refused', r.status === 403, r.status);
r = await hit('/api/mp/admin/exhibitor-invites', { headers: { Authorization: 'Bearer smoke-secret' } });
check('event admin reaches the handler (JSON 500 without DB)', r.status === 500 && r.text.startsWith('{'), r.status + ' ' + r.text.slice(0, 60));

// ---- company routes need a signed marketplace session ----
for (const p of ['/api/mp/dashboard/listings', '/api/mp/dashboard/stats', '/api/mp/dashboard/profile', '/api/mp/dashboard/inquiries', '/api/mp/dashboard/reviews']) {
  r = await hit(p);
  check('login required: ' + p, r.status === 401, r.status);
}
r = await hit('/api/mp/listings', post({ product_name: 'X', description: 'Y' }));
check('login required: submitting a listing', r.status === 401, r.status);
r = await hit('/api/mp/uploads', { method: 'POST' });
check('login required: uploads', r.status === 401, r.status);
r = await hit('/api/mp/auth/me', { headers: { Cookie: 'mp_session=1' } });
check('an unsigned session cookie is nobody', r.status === 200 && JSON.parse(r.text).user === null, r.text.slice(0, 80));

// ---- sign-in links: refused before the database is consulted ----
r = await hit('/marketplace/signin', { redirect: 'manual' });
check('sign-in landing without a token bounces to the marketplace', r.status === 302 && r.h.location === '/marketplace?signin=expired' && !r.h['set-cookie'], r.status + ' ' + r.h.location);
r = await hit('/marketplace/signin?t=1.4102444800.deadbeef', { redirect: 'manual' });
check('a forged sign-in token sets no session', r.status === 302 && !r.h['set-cookie'], r.status);
r = await hit('/api/mp/auth/link', post({ email: 'not-an-email' }));
check('sign-in link request rejects a bad address', r.status === 400, r.status);

// ---- input rules that must not need a database ----
r = await hit('/api/mp/auth/register', post({ company_name: 'A', email: 'not-an-email', password: 'secret123' }));
check('register rejects a bad email address', r.status === 400, r.status + ' ' + r.text.slice(0, 60));
r = await hit('/api/mp/auth/register', post({ company_name: 'A', email: 'a@b.co', password: '123' }));
check('register rejects a short password', r.status === 400, r.status);
r = await hit('/api/mp/inquiries', post({ inquirer_name: 'A' }));
check('inquiry needs a listing and an email', r.status === 400, r.status);
r = await hit('/api/mp/listings/not-a-number');
check('a non-numeric listing id is not found', r.status === 404, r.status);

// ---- pages ----
r = await hit('/marketplace');
check('/marketplace renders', r.status === 200 && r.text.includes('<html'), r.status);
for (const marker of ['marketplace-app.js?v=', 'open-listing-button', 'listings-container', 'id="link-form"']) {
  check('/marketplace carries ' + marker, r.text.includes(marker), 'missing');
}
r = await hit('/marketplace/admin');
check('/marketplace/admin renders', r.status === 200, r.status);
for (const marker of ['marketplace-admin.js?v=', 'data-section="exhibitors"', 'id="admin-exhibitors"', 'id="invite-all"', 'id="admin-pending-listings"']) {
  check('/marketplace/admin carries ' + marker, r.text.includes(marker), 'missing');
}
r = await hit('/marketplace/dashboard');
check('/marketplace/dashboard carries the completeness panel', r.text.includes('id="dash-complete"') && r.text.includes('id="edit-logo-file"'), 'missing');

// A slug is written into an inline script; a crafted link must not be able to close it.
r = await hit('/marketplace/listing/x%22%3Balert(1)%2F%2F%3C%2Fscript%3E/y');
const line = (r.text.match(/window\.__LISTING_COMPANY_SLUG = [^\n]*/) || [''])[0];
// Safe: every " inside the value is backslash-escaped and < is \u003c, so the string
// closes only where it should and the HTML parser sees no </script>.
check('a crafted listing link cannot open a script block', line.includes('\\u003c/script>') && !/[^\\]";alert/.test(line) && !line.includes('</script>'), line.slice(0, 120));

console.log(fails ? `\n${fails} FAILED` : '\nAll marketplace checks passed');
process.exit(fails ? 1 : 0);
