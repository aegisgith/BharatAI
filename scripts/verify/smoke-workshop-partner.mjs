// Integration and system: the call for workshop partners against the built worker on real
// SQLite with the production schema (5 Nov 2026). The page's own script sends the request
// (workshop-partner-world.mjs), the real route saves it, the real admin routes list and
// count it, and the email service is played here.
// Run after `npm run build`:  node scripts/verify/smoke-workshop-partner.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GOOD, openPage } from './workshop-partner-world.mjs';
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
  const r = await openPage({ fetch: toWorker }).submit({ ...GOOD, email: 'Asha@VaaniLabs.example' });
  const row = lastRow();
  check('the real route takes what the page sends, one row', r.done && !r.error && count() === before + 1, JSON.stringify(r));
  check('saved as workshop_partner on the conference\'s list, email lowercased', row.inquiry_type === 'workshop_partner' && row.event_id === 1 && row.email === 'asha@vaanilabs.example' && row.status === 'new', JSON.stringify(row));
  check('the row has every box the form asked for', row.name === 'Dr. Asha Rao' && row.organization === 'Vaani Labs' && row.phone === GOOD.mobile && row.subject === 'Workshop · ' + GOOD.topic && [GOOD.brief, GOOD.audience, GOOD.attend, GOOD.prereq, GOOD.setup, 'Hands-on', '60 to 90 minutes'].every((w) => row.message.includes(w)), JSON.stringify(row));
  check('one email to the team, a reply reaches the person', mail.length === 1 && mail[0].Content.ReplyTo.includes('Asha@VaaniLabs.example') && mail[0].Content.Subject.includes('workshop partner enquiry'), JSON.stringify(mail[0]?.Content?.Subject));
  const b = mail[0].Content.Body[0].Content;
  check('the team email has everything needed to answer', ['Dr. Asha Rao', 'Vaani Labs', GOOD.mobile, GOOD.topic, GOOD.brief, GOOD.audience, GOOD.setup].every((w) => b.includes(w)), b.slice(0, 200));
}
{
  mailDown = true;
  const before = count();
  const r = await openPage({ fetch: toWorker }).submit({ ...GOOD, email: 'down@example.com' });
  mailDown = false;
  check('the email service failing loses nothing', r.done && count() === before + 1 && lastRow().email === 'down@example.com', JSON.stringify(r));
}
{
  const before = count();
  const r = await api('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inquiry_type: 'workshop_partner', name: 'No Email' }) });
  check('someone skipping the page without an email is refused, no row', r.status === 400 && count() === before, r.status);
}
{
  const nasty = '<img src=x onerror=alert(1)>';
  mail = [];
  await openPage({ fetch: toWorker }).submit({ ...GOOD, first: nasty, topic: nasty, brief: nasty, company: nasty, email: 'x@example.com' });
  const html = mail[0].Content.Body[0].Content;
  check('a script typed into a box reaches the team email harmless', !html.includes('<img src=x') && html.includes('&lt;img'), html.slice(0, 120));
}

// ======== system: one trainer, from a shared link to the organiser's screens ========
{
  mail = [];
  const p = openPage({ search: '?utm_source=linkedin&utm_campaign=trainers', fetch: toWorker });
  const first = await p.submit({ ...GOOD, as: 'Individual', company: '', email: 'trainer@example.com', format: '' });
  check('forgot hands-on or theory: told so, nothing saved yet', first.error.includes('hands-on or pure theory') && rows("SELECT * FROM inquiries WHERE email = 'trainer@example.com'").length === 0, first.error);
  const r = await p.submit({ ...GOOD, as: 'Individual', company: '', email: 'trainer@example.com', format: 'Pure theory', min: '45', max: '45' });
  check('with it: the thank-you names the person', r.done && p.els['wp-done-text'].textContent.includes('Dr. Asha Rao') && p.els['wp-done-text'].textContent.includes('trainer@example.com'));
  check('the team is told once', mail.length === 1, mail.length);

  const list = await api('/api/admin/inquiries?type=workshop_partner', { headers: ADMIN });
  const shown = (list.json?.inquiries || []).find((i) => i.email === 'trainer@example.com');
  check('the organiser finds it in Admin, Enquiries, under Workshop Partner', list.status === 200 && shown && shown.subject === 'Workshop · ' + GOOD.topic && (list.json.inquiries || []).every((i) => i.inquiry_type === 'workshop_partner'), list.text.slice(0, 200));
  check('Admin\'s filter pill has a count to show for the type', (list.json?.typeCounts || []).some((t) => t.inquiry_type === 'workshop_partner' && t.count >= 1), JSON.stringify(list.json?.typeCounts));
  const meta = JSON.parse(shown.metadata);
  check('and can see individual or company, the format, the time and where it came from', meta.applying_as === 'Individual' && meta.format === 'Pure theory' && meta.duration === '45 minutes' && meta.utm_source === 'linkedin' && meta.utm_campaign === 'trainers' && meta.page === '/training-workshop', shown.metadata);

  const board = await api('/api/admin/events/1/board', { headers: ADMIN });
  const onBoard = (board.json?.todo?.inquiries || []).find((t) => t.type === 'workshop_partner');
  check('the Overview board counts the new ideas', board.status === 200 && onBoard && onBoard.n === rows("SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'workshop_partner' AND status = 'new'")[0].n, board.text.slice(0, 300));

  const adminScript = await api('/admin.js');
  check('the served admin screen shows the type by its own name', adminScript.status === 200 && adminScript.text.includes("workshop_partner: { icon: 'fa-graduation-cap', color: 'teal', label: 'Workshop Partner' }"), adminScript.status);
  check('and the Overview line that opens it', adminScript.text.includes('workshop partner ideas to read') && adminScript.text.includes('function openEnquiriesOfType'));
  const stranger = await api('/api/admin/inquiries?type=workshop_partner');
  check('a stranger cannot read the list', stranger.status === 401 || stranger.status === 403, stranger.status);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
