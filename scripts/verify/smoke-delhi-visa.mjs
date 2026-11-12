// Integration: a letter for a visa application, Delhi 2027 (13 Nov 2026), on the built worker
// with real SQLite and the production schema; the email service played here.
//  - every box is checked in words; the mobile may be foreign; the part in the event is
//    one of the list; no passport number is asked for or kept;
//  - a request lands on the Inquiries desk as visa_letter with its answers, the team is
//    emailed and the person gets a "we have your request" email with the official site;
//  - the same address again within a day is the same request, with no second email;
//  - twenty from one connection in an hour are enough; Admin counts them.
// Run after `npm run build`:  node scripts/verify/smoke-delhi-visa.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
      sql,
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { const out = []; for (const s of list) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); return out; },
};
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', ELASTIC_EMAIL_API_KEY: 'test-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const waits = [];
const ctx = { waitUntil(p) { waits.push(p); }, passThroughOnException() {} };
const settled = async () => { await Promise.allSettled(waits.splice(0)); };
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
let mail = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { mail.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  throw new Error('no outside calls in this test: ' + url);
};
const hit = async (path, init = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, init), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const ask = (o, ip = '10.1.1.1') => hit('/api/delhi/visa-letter', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(o) });
const GOOD = { name: 'Amelia Jane Watson', nationality: 'British', country: 'United Kingdom', company: 'Watson Analytics Ltd', job_title: 'Chief Data Officer', email: 'Amelia.Watson@Example.co.uk', mobile: '+44 7700 900123', role: 'buying', arrival: '2027-07-26', note: 'Two colleagues may travel with me.' };

for (const [what, o, word] of [
  ['no name', { name: '' }, 'name as in your passport'], ['no nationality', { nationality: '' }, 'nationality'], ['no country', { country: ' ' }, 'country you travel from'],
  ['no organisation', { company: '' }, 'organisation'], ['no designation', { job_title: '' }, 'designation'], ['no email', { email: '' }, 'email'],
  ['a bad email', { email: 'amelia@' }, 'check your email'], ['a short mobile', { mobile: '+44 77' }, 'country code'], ['no part chosen', { role: '' }, 'part in the event'],
  ['a part not on the list', { role: 'constructor' }, 'part in the event'],
]) {
  const r = await ask({ ...GOOD, ...o });
  check('refused, ' + what + ', in words, nothing saved', r.status === 400 && (r.json?.error || '').includes(word) && rows('SELECT COUNT(*) AS n FROM inquiries')[0].n === 0, r.text);
}

mail = [];
let r = await ask(GOOD);
await settled();
const row = rows("SELECT * FROM inquiries WHERE inquiry_type = 'visa_letter'")[0] || {};
const meta = JSON.parse(row.metadata || '{}');
check('a request lands on the Inquiries desk as a visa letter, new, with a reference', r.status === 201 && r.json?.ref === 'BHAI-INQ-' + String(row.id).padStart(5, '0') && row.status === 'new' && row.event_id === 1, r.text);
check('it keeps the answers: name, email lowercased, foreign mobile, organisation, subject', row.name === 'Amelia Jane Watson' && row.email === 'amelia.watson@example.co.uk' && row.phone === '+44 7700 900123' && row.organization === 'Watson Analytics Ltd' && row.subject === 'Delhi 2027 · Visa letter · British', JSON.stringify(row));
check('and in its details: nationality, country, part, arrival, designation', meta.nationality === 'British' && meta.country === 'United Kingdom' && meta.role === 'Going to buy a pass' && meta.arrival === '2027-07-26' && meta.designation === 'Chief Data Officer' && /Two colleagues/.test(row.message), JSON.stringify(meta));
check('no passport number is asked for or kept', !/passport no|passport number/i.test(row.message + row.metadata), row.message);
const team = mail.find((m) => !m.Recipients.To.includes('amelia.watson@example.co.uk'));
const theirs = mail.find((m) => m.Recipients.To.includes('amelia.watson@example.co.uk'));
check('the team is emailed the request', !!team && /Visa letter/.test(team.Content.Subject + team.Content.Body[0].Content), team ? team.Content.Subject : 'none');
check('the person gets "we have your request" with the reference and the official site, and no promise of a visa', !!theirs && theirs.Content.Subject.includes(r.json.ref) && /indianvisaonline\.gov\.in/.test(theirs.Content.Body[0].Content) && /Our team will reply by email/.test(theirs.Content.Body[0].Content) && !/guarantee|will get your visa|approved/i.test(theirs.Content.Body[0].Content), theirs ? theirs.Content.Subject : 'none');

mail = [];
r = await ask({ ...GOOD, email: 'AMELIA.watson@example.co.uk' });
await settled();
check('the same address again within a day: the same request, no second email', r.status === 200 && r.json?.already === true && rows("SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'visa_letter'")[0].n === 1 && mail.length === 0, r.text);

for (let i = 0; i < 19; i++) await ask({ ...GOOD, email: 'p' + i + '@example.com' }, '10.2.2.2');
r = await ask({ ...GOOD, email: 'p99@example.com' }, '10.2.2.2');
const r2 = await ask({ ...GOOD, email: 'p100@example.com' }, '10.2.2.2');
check('twenty from one connection in an hour are enough', r.status === 201 && r2.status === 429, r.status + ' ' + r2.status);
await settled();

r = await hit('/api/admin/delhi/visa-letters', { headers: { Authorization: 'Bearer smoke-admin' } });
check('Admin counts them: 21 requests, all open', r.status === 200 && r.json?.total === 21 && r.json?.open === 21, r.text);
r = await hit('/api/admin/delhi/visa-letters');
check('the count needs Admin', r.status === 401 || r.status === 403, String(r.status));

console.log(fails ? `\n${fails} FAILED` : '\nall visa letter checks passed');
process.exit(fails ? 1 : 0);
