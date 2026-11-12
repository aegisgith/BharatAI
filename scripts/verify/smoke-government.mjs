// Integration and system: the /government nomination form against the built worker on
// real SQLite with the production schema (5 Nov 2026). The page's own script sends the
// request (government-world.mjs), the real route saves it, the real admin route lists
// it, and the email service is played here. Then the build: Cloudflare must serve
// /government as a page, not hand it to the worker.
// Run after `npm run build`:  node scripts/verify/smoke-government.mjs
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GOOD, openPage } from './government-world.mjs';
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
{
  mail = [];
  const before = count();
  const p = openPage({ fetch: toWorker });
  const r = await p.submit({ ...GOOD, email: 'Asha.Rao@Example.gov.in' }, ['Closed-Door Roundtable']);
  const row = lastRow();
  check('the real route takes what the page sends, one row', r.done && !r.error && count() === before + 1, JSON.stringify(r));
  check('saved as government on the conference\'s list, email lowercased', row.inquiry_type === 'government' && row.event_id === 1 && row.email === 'asha.rao@example.gov.in', JSON.stringify(row));
  check('the row carries the Ministry, the number and the initiative', row.organization === GOOD.org && row.phone === GOOD.phone && row.subject === 'Govt AI · Adi Vaani' && row.message.includes('Translates tribal languages') && row.message.includes('Closed-Door Roundtable'), JSON.stringify(row));
  check('it stays out of the speaking list, where hundreds of requests wait', rows("SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'speaking'")[0].n === 0);
  check('one email to the team, a reply reaches the officer', mail.length === 1 && mail[0].Content.ReplyTo.includes('Asha.Rao@Example.gov.in') && mail[0].Content.Subject.includes('government enquiry'), JSON.stringify(mail[0]?.Content?.Subject));
  const b = mail[0].Content.Body[0].Content;
  check('the team email has everything needed to answer', ['Asha Rao', GOOD.org, GOOD.phone, 'Govt AI', 'Translates tribal languages', 'Deputy Secretary', 'Closed-Door Roundtable'].every((w) => b.includes(w)), b.slice(0, 200));
}
{
  mailDown = true;
  const before = count();
  const r = await openPage({ fetch: toWorker }).submit({ ...GOOD, email: 'down@example.gov.in' });
  mailDown = false;
  check('the email service failing loses nothing: the officer is told yes and the row is there', r.done && count() === before + 1 && lastRow().email === 'down@example.gov.in', JSON.stringify(r));
}
{
  const before = count();
  const r = await api('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inquiry_type: 'government', name: 'No Email' }) });
  check('someone skipping the page without an email is refused, no row', r.status === 400 && count() === before, r.status);
  const r2 = await api('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inquiry_type: 'ministry', name: 'A', email: 'a@example.com' }) });
  check('other unknown types are still refused, no row', r2.status === 400 && count() === before, r2.status);
}
{
  const nasty = '<img src=x onerror=alert(1)>';
  mail = [];
  await openPage({ fetch: toWorker }).submit({ ...GOOD, name: nasty, org: nasty, about: nasty, initiative: nasty, email: 'x@example.gov.in' });
  const html = mail[0].Content.Body[0].Content;
  check('a script typed into a box reaches the team email harmless', !html.includes('<img src=x') && html.includes('&lt;img'), html.slice(0, 120));
}

// ======== system: one Ministry, from the letter's link to the organiser's screen ========
{
  mail = [];
  const p = openPage({ search: '?utm_source=letter&utm_campaign=ministries', fetch: toWorker });
  const first = await p.submit({ ...GOOD, email: 'nodal@example.gov.in', phone: '' });
  check('no contact number: told so, nothing saved yet', first.error.includes('contact number') && rows("SELECT * FROM inquiries WHERE email = 'nodal@example.gov.in'").length === 0, first.error);
  const r = await p.submit({ ...GOOD, email: 'nodal@example.gov.in' }, ['Innovation Talk & Showcase', 'Exhibition Pavilion']);
  check('with it: the thank-you names the officer', r.done && p.els['gv-done-text'].textContent.includes('Asha Rao') && p.els['gv-done-text'].textContent.includes('nodal@example.gov.in'));
  check('the team is told once', mail.length === 1, mail.length);
  const list = await api('/api/admin/inquiries?type=government', { headers: ADMIN });
  const shown = (list.json?.inquiries || []).find((i) => i.email === 'nodal@example.gov.in');
  check('the organiser finds it in Admin, Enquiries, under Government', list.status === 200 && shown && shown.subject === 'Govt AI · Adi Vaani' && shown.organization === GOOD.org, list.text.slice(0, 200));
  check('Admin\'s filter pill has a count to show for the type', (list.json?.typeCounts || []).some((t) => t.inquiry_type === 'government' && t.count >= 1), JSON.stringify(list.json?.typeCounts));
  const meta = JSON.parse(shown.metadata);
  check('and can see the format, the designation and where it came from', meta.formats === 'Innovation Talk & Showcase, Exhibition Pavilion' && meta.designation === 'Deputy Secretary' && meta.utm_source === 'letter' && meta.utm_campaign === 'ministries' && meta.page === '/government', shown.metadata);
  const adminScript = await api('/admin.js');
  // Since 12 Nov 2026 the Inquiries screen is its own file, loaded by /admin.js.
  const desk = readFileSync(new URL('../../public/js/admin-inquiries.js', import.meta.url), 'utf8');
  check('the served admin screen shows the type by its own name', adminScript.status === 200 && adminScript.text.includes('INQ_DESK_VERSION') && /government:\s*\{ label: 'Government', icon: 'fa-building-columns'/.test(desk), adminScript.status);
  check('the icon it uses exists', readFileSync(new URL('../../public/css/fa-subset.css', import.meta.url), 'utf8').includes('.fa-building-columns:'));
  const stranger = await api('/api/admin/inquiries?type=government');
  check('a stranger cannot read the list', stranger.status === 401 || stranger.status === 403, stranger.status);
}

// ---- the build: Pages serves the page, the worker never sees it ----
const routes = JSON.parse(readFileSync(new URL('../../dist/_routes.json', import.meta.url), 'utf8'));
for (const p of ['/government', '/government.html', '/images/*']) check(`${p} is served by Cloudflare Pages, not the worker`, routes.exclude.includes(p), JSON.stringify(routes.exclude.slice(0, 5)));
check('still inside Cloudflare\'s 100-rule limit', routes.exclude.length + routes.include.length <= 100, routes.exclude.length);
check('/api/* still reaches the worker, so the form can post', !routes.exclude.some((x) => x.startsWith('/api')) && routes.include.includes('/*'));
for (const f of ['government.html', 'images/government/governance-panel-820.webp', 'images/government/governance-panel-1400.webp', 'images/og/government.jpg']) {
  check(`the build carries ${f}`, existsSync(new URL('../../dist/' + f, import.meta.url)));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
