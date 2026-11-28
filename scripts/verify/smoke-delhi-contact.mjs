// Integration and system (28 Nov 2026): after Mumbai, the ways in that were still
// Mumbai's take enquiries for Delhi 2027. The built worker on real SQLite with the
// production schema; the page's own script runs in node:vm with a small DOM, so what
// the form sends is what the browser sends. Both states: after Mumbai (the real date)
// and before it (MUMBAI_SALES_OPEN=1, which the older suites run under).
//  - /contact: every enquiry marked Delhi (subject "Delhi 2027 · ...", metadata.edition),
//    the group box at Delhi's prices with no online booking (/group is closed), the booth
//    link to /delhi-exhibit, no Media Pass form link, "See Delhi 2027" after sending.
//  - /media-pass: approving one issues a Mumbai app pass, so after Mumbai the page sends
//    people to the media enquiry on /contact and the route refuses with 410.
//  - /app: no "Upgrade your pass" card for Mumbai's Visitors (its checkout answers 410).
//  - the Inquiries desk: the first booth reply and the acknowledgement speak of Delhi.
// Run after `npm run build`:  node scripts/verify/smoke-delhi-contact.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
db.exec('PRAGMA foreign_keys = ON');
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
const waits = [];
const ctx = { waitUntil(p) { waits.push(p); }, passThroughOnException() {} };
const settled = async () => { await Promise.allSettled(waits.splice(0)); };
const ADMIN = { Authorization: 'Bearer smoke-admin' };

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

let mail = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { mail.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  throw new Error('no outside calls in this test: ' + url);
};
const toWorker = (url, init) => worker.fetch(new Request('https://bharataiinnovation.com' + url, init), env, ctx);
const get = async (path, headers = {}) => { const r = await toWorker(path, { headers }); return { status: r.status, text: await r.text(), location: r.headers.get('location') || '' }; };
const after = () => { delete process.env.MUMBAI_SALES_OPEN; };
const before = () => { process.env.MUMBAI_SALES_OPEN = '1'; };
const lastRow = () => rows('SELECT * FROM inquiries ORDER BY id DESC LIMIT 1')[0];

// The contact form's own script, with just enough DOM for it. Boxes the type adds
// (group size, pass, topic, budget) exist only once its extra HTML is written.
const DYNAMIC = ['cf-booth', 'cf-zone', 'cf-topic', 'cf-groupsize', 'cf-passtype', 'cf-budget'];
function contactPage(html) {
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function submitContactForm'));
  if (!code) throw new Error('no contact form script on the page');
  new vm.Script(code); // it parses, as a browser would
  const els = new Map();
  let extra = '';
  const el = (id) => ({ id, value: '', innerHTML: '', textContent: '', className: '', disabled: false, style: {}, hidden: false,
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); }, toggle(c, f) { (f ?? !this.s.has(c)) ? this.s.add(c) : this.s.delete(c); } },
    scrollIntoView() {}, reset() {}, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {} });
  const extraBox = Object.assign(el('cf-extra'), {});
  Object.defineProperty(extraBox, 'innerHTML', { get: () => extra, set: (v) => { extra = String(v); for (const d of DYNAMIC) els.delete(d); } });
  const document = {
    getElementById(id) {
      if (id === 'cf-extra') return extraBox;
      if (DYNAMIC.includes(id) && !extra.includes('id="' + id + '"')) return null;
      if (!els.has(id)) els.set(id, el(id));
      return els.get(id);
    },
    createElement: () => el(''), body: { appendChild() {} }, addEventListener() {},
  };
  const toasts = [];
  const sandbox = { document, window: { location: { hash: '' } }, setTimeout: () => 0, console,
    fetch: (url, init) => toWorker(url, init) };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const realToast = sandbox.showToast;
  sandbox.showToast = (m, t) => { toasts.push([m, t]); };
  return {
    choose: (type) => sandbox.selectType(type),
    extra: () => extra,
    fill: (v) => { for (const [k, val] of Object.entries(v)) document.getElementById(k).value = val; },
    send: async () => { await sandbox.submitContactForm({ preventDefault() {} }); await settled(); },
    sent: () => !!els.get('cf-success') && !els.get('cf-success').classList.contains('hidden') && els.get('contact-form').classList.contains('hidden'),
    toasts, realToast,
  };
}
const who = { 'cf-name': 'Ravi Menon', 'cf-email': 'Ravi.Menon@Example.com', 'cf-phone': '98200 55555', 'cf-org': 'Example Labs', 'cf-message': 'We are 12 people.' };

// ======== after Mumbai: /contact ========
after();
let r = await get('/contact');
check('after Mumbai, /contact opens', r.status === 200, r.status);
check('/contact: its script marks enquiries as Delhi', r.text.includes("const CF_EDITION = 'delhi-2027';"), '');
check('/contact: the booth button goes to the Delhi application, not Mumbai\'s form', r.text.includes('/delhi-exhibit?from=contact') && !r.text.includes('/inquiry#inquiry-form-card'), '');
check('/contact: no online group booking (/group is closed) and no Media Pass form link', !r.text.includes('href="/group"') && !r.text.includes('href="/media-pass"') && r.text.includes('Passes for your team or delegation'), '');
check('/contact: the group box shows Delhi\'s prices, not Mumbai\'s late ones', ['4,999', '9,999', '19,999', '999'].every(p => r.text.includes('&#8377;' + p + ' + GST')) && !r.text.includes('8,999') && !r.text.includes('24,999'), '');
check('/contact: after sending, "See Delhi 2027", not Mumbai\'s app', r.text.includes('See Delhi 2027</a>') && !r.text.includes('Go to App'), '');

{
  mail = [];
  const p = contactPage(r.text);
  p.choose('group_registration');
  check('group: the box asks for the team, with no Book for your group button', p.extra().includes('Bringing a team to Delhi 2027?') && !p.extra().includes('/group') && p.extra().includes('id="cf-groupsize"'), p.extra().slice(0, 200));
  p.fill({ ...who, 'cf-subject': '', 'cf-groupsize': '12', 'cf-passtype': 'Delegate' });
  await p.send();
  const row = lastRow(), meta = JSON.parse(row.metadata);
  check('group: the page says it is sent', p.sent() && p.toasts.some(t => t[1] === 'success'), JSON.stringify(p.toasts));
  check('group: saved as a group enquiry, the subject says Delhi 2027 and the type', row.inquiry_type === 'group_registration' && row.subject === 'Delhi 2027 · Group Registration', row.subject);
  check('group: marked Delhi in its details, with the size and the pass', meta.edition === 'delhi-2027' && meta.page === '/contact' && meta.group_size === '12' && meta.pass_type === 'Delegate', row.metadata);
  check('group: the team is emailed, and a reply reaches the person', mail.length === 1 && mail[0].Content.ReplyTo === 'Ravi.Menon@Example.com', JSON.stringify(mail.map(m => m.Content.Subject)));
}
{
  const p = contactPage(r.text);
  p.choose('exhibition');
  check('exhibition: Apply for a booth opens the Delhi application', p.extra().includes('href="/delhi-exhibit?from=contact"'), p.extra().slice(0, 300));
  p.fill({ ...who, 'cf-email': 'ravi.booth@example.com', 'cf-subject': 'Two booths?' });
  await p.send();
  const row = lastRow();
  check('exhibition: the subject keeps their words after "Delhi 2027 · "', row.inquiry_type === 'exhibition' && row.subject === 'Delhi 2027 · Two booths?' && JSON.parse(row.metadata).edition === 'delhi-2027', row.subject);
}

// The acknowledgement, when the organisers switch it on.
{
  db.run("INSERT INTO app_settings (key, value) VALUES ('inquiry_autoack', '1')");
  mail = [];
  const p = contactPage(r.text);
  p.choose('sponsorship');
  p.fill({ ...who, 'cf-email': 'meera@example.org', 'cf-subject': '' });
  await p.send();
  const ack = mail.find(m => m.Recipients?.To?.[0] === 'meera@example.org');
  check('acknowledgement: its subject names Delhi 2027, not 2026', !!ack && /^We have your enquiry \(BHAI-INQ-\d{5}\) - Bharat AI Innovation Delhi 2027$/.test(ack.Content.Subject), JSON.stringify(mail.map(m => [m.Recipients?.To, m.Content.Subject])));
  check('acknowledgement: Delhi\'s dates and the partnership link, no Mumbai', !!ack && ack.Content.Body[0].Content.includes('28&ndash;29 July 2027') && ack.Content.Body[0].Content.includes('/partner#delhi') && !/World Trade|WTC|20[–-]21 Nov/.test(ack.Content.Body[0].Content), '');
  db.run("DELETE FROM app_settings WHERE key = 'inquiry_autoack'");
}

// ======== after Mumbai: the desk ========
{
  const s = await toWorker('/api/admin/inquiries', { headers: ADMIN });
  const j = await s.json();
  const t = j.settings.templates;
  const booth = t.find(x => x.id === 'booth');
  check('desk: the first booth reply is for Delhi 2027 and points to the Delhi application', !!booth && booth.subject.includes('Delhi 2027') && booth.body.includes('28 and 29 July 2027') && booth.body.includes('/delhi-exhibit') && !/World Trade|days away/.test(booth.body), JSON.stringify(booth));
  check('desk: only the reply named "(Mumbai)" still speaks of Mumbai', t.filter(x => /World Trade|WTC/.test(x.body)).every(x => x.name.includes('(Mumbai)')), t.filter(x => /World Trade|WTC/.test(x.body)).map(x => x.name).join(', '));
  const prev = await (await toWorker('/api/admin/inquiries/ack-preview?type=sponsorship', { headers: ADMIN })).json();
  check('desk: the acknowledgement preview shows the Delhi subject', prev.subject === 'We have your enquiry (BHAI-INQ-00573) - Bharat AI Innovation Delhi 2027', prev.subject);
}

// ======== after Mumbai: the Media Pass form and the app ========
r = await get('/media-pass?as=influencer');
check('after Mumbai, /media-pass sends people to the media enquiry on /contact', r.status === 302 && r.location === '/contact#media', r.status + ' ' + r.location);
{
  const n = rows('SELECT COUNT(*) AS n FROM inquiries')[0].n;
  const p = await toWorker('/api/media-pass-application', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'media', name: 'Late Reporter', email: 'late@example.com' }) });
  const j = await p.json();
  check('after Mumbai, the Media Pass route refuses with 410, says where to go, saves nothing', p.status === 410 && j.code === 'closed' && j.error.includes('/contact#media') && j.error.includes('Delhi 2027') && rows('SELECT COUNT(*) AS n FROM inquiries')[0].n === n, p.status + ' ' + JSON.stringify(j));
}
r = await get('/app');
check('after Mumbai, the app has no Upgrade your pass card (Mumbai\'s checkout answers 410)', r.status === 200 && !r.text.includes('id="home-upgrade-card"') && r.text.includes('Get your Delhi pass'), r.status);

// ======== before Mumbai ended: as it was ========
before();
r = await get('/contact');
check('before: /contact as it was (Mumbai\'s booth form, group booking online, the Media Pass link)', r.text.includes("const CF_EDITION = '';") && r.text.includes('/inquiry#inquiry-form-card') && r.text.includes('href="/group"') && r.text.includes('href="/media-pass"') && r.text.includes('Go to App'), '');
{
  const p = contactPage(r.text);
  p.choose('general');
  p.fill({ ...who, 'cf-email': 'old@example.com', 'cf-subject': 'Parking' });
  await p.send();
  const row = lastRow();
  check('before: the subject is theirs alone and no edition is added', row.subject === 'Parking' && !JSON.parse(row.metadata).edition, row.subject + ' ' + row.metadata);
}
r = await get('/media-pass');
check('before: /media-pass is the form', r.status === 200 && r.text.includes('Media'), r.status);
r = await get('/app');
check('before: the app keeps its Upgrade your pass card', r.text.includes('id="home-upgrade-card"'), '');
after();

console.log(fails ? `\n${fails} failed` : '\nall Delhi contact checks passed');
process.exit(fails ? 1 : 0);
