// Integration and system: the Delhi 2027 "Tell me first" form against the built worker
// on real SQLite with the production schema (5 Nov 2026). The page's own script sends
// the request (delhi-world.mjs), the real route saves it, the real admin route lists it,
// and the email service is played here. Then the build: Cloudflare must serve /delhi as
// a page, not hand it to the worker.
// Run after `npm run build`:  node scripts/verify/smoke-delhi.mjs
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openPage } from './delhi-world.mjs';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI Innovation 2026', '2026-11-20', '2026-11-21')");
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args = []) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { return Promise.all(list.map(s => s.all())); },
};
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', ELASTIC_EMAIL_API_KEY: 'test-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ADMIN = { Authorization: 'Bearer smoke-admin' };

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// The email service, played. Worker requests go to the worker, in this process.
let mail = [];
let mailDown = false;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) {
    if (mailDown) throw new Error('email service down');
    mail.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  }
  throw new Error('no outside calls in this test: ' + url);
};
const toWorker = (url, init) => worker.fetch(new Request('https://bharataiinnovation.com' + url, init), env, ctx);
const api = async (path, init) => { const r = await toWorker(path, init); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text }; };
const lastRow = () => rows('SELECT * FROM inquiries ORDER BY id DESC LIMIT 1')[0];
const count = () => rows('SELECT COUNT(*) AS n FROM inquiries')[0].n;

// ======== integration: page -> route -> table -> email ========
const filed = { attend: 'general', exhibit: 'exhibition', sponsor: 'sponsorship', speak: 'speaking' };
for (const [interest, type] of Object.entries(filed)) {
  mail = [];
  const before = count();
  const p = openPage({ fetch: toWorker });
  p.choose(interest);
  const r = await p.submit({ name: 'Asha ' + interest, email: `Asha.${interest}@Example.com`, phone: '98200 12345', org: 'Example Ltd' });
  const row = lastRow();
  check(`${interest}: the real route takes what the page sends, one row`, r.done && !r.error && count() === before + 1, JSON.stringify(r));
  check(`${interest}: saved as ${type} on the conference's list, email lowercased`, row.inquiry_type === type && row.event_id === 1 && row.email === `asha.${interest}@example.com` && row.organization === 'Example Ltd', JSON.stringify(row));
  check(`${interest}: the subject tells the team it is Delhi`, row.subject.startsWith('Delhi 2027 · ') && row.message.includes('29–30 July 2027') && JSON.parse(row.metadata).edition === 'delhi-2027', row.subject);
  check(`${interest}: one email to the team, a reply reaches the person`, mail.length === 1 && mail[0].Content.ReplyTo.includes(`Asha.${interest}@Example.com`) && mail[0].Content.Body[0].Content.includes('Delhi 2027'), JSON.stringify(mail[0]?.Content?.Subject));
}

{
  mailDown = true;
  const before = count();
  const p = openPage({ fetch: toWorker });
  const r = await p.submit({ name: 'Mail Down', email: 'down@example.com' });
  mailDown = false;
  check('the email service failing loses nothing: the person is told yes and the row is there', r.done && count() === before + 1 && lastRow().email === 'down@example.com', JSON.stringify(r));
}
{
  const before = count();
  const r = await api('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inquiry_type: 'general', name: 'No Email' }) });
  check('someone skipping the page without an email is refused, no row', r.status === 400 && count() === before, r.status);
  const r2 = await api('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inquiry_type: 'delhi', name: 'A', email: 'a@example.com' }) });
  check('an unknown type is refused, no row', r2.status === 400 && count() === before, r2.status);
}
{
  const nasty = '<img src=x onerror=alert(1)>';
  mail = [];
  const p = openPage({ fetch: toWorker });
  await p.submit({ name: nasty, email: 'x@example.com', org: nasty });
  const html = mail[0].Content.Body[0].Content;
  check('a script typed into a box reaches the team email harmless', !html.includes('<img src=x') && html.includes('&lt;img'), html.slice(0, 80));
}

// ======== system: one exhibitor, from an advert to the organiser's screen ========
{
  mail = [];
  const p = openPage({ search: '?interest=exhibit&utm_source=linkedin&utm_campaign=delhi-launch', fetch: toWorker });
  check('the advert\'s link opens the form on Exhibit and asks for the mobile', p.interest() === 'exhibit' && p.els['dl-phone-hint'].textContent.includes('call you'));
  const first = await p.submit({ name: 'Rahul Verma', email: 'rahul@acme.example' });
  check('no mobile: told so, nothing saved yet', first.error.includes('mobile') && rows("SELECT * FROM inquiries WHERE email = 'rahul@acme.example'").length === 0, first.error);
  const r = await p.submit({ name: 'Rahul Verma', email: 'rahul@acme.example', phone: '+91 98200 55555', org: 'Acme AI' });
  check('with it: the thank-you names them', r.done && p.els['dl-done-text'].textContent.includes('Rahul') && p.els['dl-done-text'].textContent.includes('rahul@acme.example'));
  check('the team is told once, by email, with the mobile', mail.length === 1 && mail[0].Content.Body[0].Content.includes('+91 98200 55555'), mail.length);
  const list = await api('/api/admin/inquiries?type=exhibition', { headers: ADMIN });
  const shown = (list.json?.inquiries || list.json?.results || list.json || []).find?.((i) => i.email === 'rahul@acme.example');
  check('the organiser finds it in Admin, Enquiries, under Exhibition, marked Delhi', list.status === 200 && shown && shown.subject === 'Delhi 2027 · Exhibit' && shown.phone === '+91 98200 55555', list.text.slice(0, 200));
  check('and can see where it came from', JSON.parse(shown.metadata).utm_source === 'linkedin' && JSON.parse(shown.metadata).utm_campaign === 'delhi-launch' && JSON.parse(shown.metadata).page === '/delhi', shown.metadata);
  const stranger = await api('/api/admin/inquiries');
  check('a stranger cannot read the list', stranger.status === 401 || stranger.status === 403, stranger.status);
}

// ---- the page's Mumbai buttons lead somewhere real ----
{
  const r = await api('/register?source=delhi-page');
  check('Before Delhi: /register opens from the page\'s button', r.status === 200 && r.text.includes('Passes'), r.status);
}

// ---- the build: Pages serves the page, the worker never sees it ----
const routes = JSON.parse(readFileSync(new URL('../../dist/_routes.json', import.meta.url), 'utf8'));
for (const p of ['/delhi', '/delhi.html', '/delhi-2027.ics', '/images/*']) check(`${p} is served by Cloudflare Pages, not the worker`, routes.exclude.includes(p), JSON.stringify(routes.exclude.slice(0, 5)));
check('still inside Cloudflare\'s 100-rule limit', routes.exclude.length + routes.include.length <= 100, routes.exclude.length);
check('/api/* still reaches the worker, so the form can post', !routes.exclude.some((x) => x.startsWith('/api')) && routes.include.includes('/*'));
for (const f of ['delhi.html', 'delhi-2027.ics', 'images/delhi/mandapam-dusk-phone.webp', 'images/delhi/mandapam-dusk-1600.webp', 'images/delhi/mandapam-dusk-2400.webp', 'images/delhi/mandapam-day.webp', 'images/delhi/mandapam-gate.webp', 'images/og/delhi.jpg']) {
  check(`the build carries ${f}`, existsSync(new URL('../../dist/' + f, import.meta.url)));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
