// Built-worker checks of meetings on the day (12 Nov 2026), on real SQLite (sql.js) with
// the production schema:
//  - no two accepted meetings at once: a request, an acceptance or a new proposed time
//    that overlaps an accepted meeting of either person is refused, in words;
//  - a request nobody has answered blocks nothing, and back-to-back meetings are fine;
//  - the busy times the time picker reads carry no names, titles or emails;
//  - about 15 minutes before an accepted meeting both people get one reminder email,
//    once, and an unanswered request gets none.
// Run after `npm run build`:  node scripts/verify/smoke-meeting-slots.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sessionCookie } from './pay-db.mjs';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
      _rows() { return rows(sql, args); },
    };
    return s;
  },
  async batch(list) { return list.map(s => ({ results: s._rows(), meta: {} })); },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
// No email goes anywhere: the mail service is answered here, and each send is kept.
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail')) { try { const b = JSON.parse(init.body); sent.push({ to: b.Recipients.To[0], subject: b.Content.Subject, html: b.Content.Body[0].Content }); } catch {} }
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const SESSION = 'smoke-session';
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SESSION, ELASTIC_EMAIL_API_KEY: 'smoke-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const as = (id) => ({ Cookie: sessionCookie(SESSION, id) });
const q = (sql, ...a) => rows(sql, clean(a));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
const person = (id, name) => {
  const row = { id, event_id: 1, name, email: 'p' + id + '@example.com', mobile: '98300' + String(id).padStart(5, '0'), company: 'Co ' + id,
    job_title: 'Director', industry: 'Software & SaaS', interests: 'ml', badge_type: 'Delegate Pass', payment_status: 'paid', main_event: 1 };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Asha Sender');
person(2, 'Ravi Receiver');
person(3, 'Meera Third');
const ask = (from, to, when, minutes = 15) => hit('POST', '/api/meetings', { event_id: 1, requester_id: from, requestee_id: to, title: 'Intro ' + from + '-' + to, meeting_time: when, duration_minutes: minutes, location: 'Hall', notes: '' }, as(from));
const status = (id) => q('SELECT status FROM meetings WHERE id = ?', id)[0]?.status;

// ---- a request, an acceptance, then clashes ----
let r = await ask(1, 2, '2026-11-20T11:00', 30);
const A = r.json?.id;
r = await hit('PUT', '/api/meetings/' + A, { status: 'accepted' }, as(2));
check('Ravi accepts Asha at 11:00 for 30 minutes', r.status === 200 && status(A) === 'accepted', r.status + ' ' + r.text);
r = await ask(1, 3, '2026-11-20T11:15');
check('Asha cannot ask for a meeting at 11:15: she is in one until 11:30', r.status === 409 && r.json?.code === 'meeting_clash' && r.json?.error === 'You already have a meeting at 11:00 that day. Pick another time.', r.status + ' ' + r.text);
r = await ask(3, 2, '2026-11-20T10:45', 30);
check('Meera cannot ask Ravi for 10:45 to 11:15: he is busy, and she is told without his details', r.status === 409 && r.json?.error === 'They already have a meeting at that time. Pick another time.', r.status + ' ' + r.text);
r = await ask(1, 3, '2026-11-20T11:30');
const B = r.json?.id;
check('right after, at 11:30, is fine', r.status === 201 && !!B, r.status + ' ' + r.text);
r = await ask(3, 2, '2026-11-21T11:00');
const r2 = await ask(1, 2, '2026-11-21T11:00');
check('two unanswered requests for the same time are both fine: only accepted meetings hold time', r.status === 201 && r2.status === 201, r.status + ' ' + r2.status);

// ---- accepting a clash ----
r = await ask(2, 3, '2026-11-20T11:30');
const C = r.json?.id;
check('Ravi asks Meera for 11:30 (he is free from 11:30)', r.status === 201 && !!C, r.status + ' ' + r.text);
r = await hit('PUT', '/api/meetings/' + B, { status: 'accepted' }, as(3));
check('Meera accepts Asha at 11:30', r.status === 200 && status(B) === 'accepted', r.status + ' ' + r.text);
r = await hit('PUT', '/api/meetings/' + C, { status: 'accepted' }, as(3));
check('Meera cannot then accept Ravi at 11:30 too; she is told to propose another time', r.status === 409 && r.json?.error === 'You already have a meeting at 11:30 that day. Propose another time instead.' && status(C) === 'pending', r.status + ' ' + r.text);

// ---- proposing a clash ----
r = await hit('POST', '/api/meetings/' + C + '/propose', { meeting_time: '2026-11-20T11:00' }, as(3));
check('Meera cannot propose 11:00 to Ravi: he is with Asha then', r.status === 409 && r.json?.error === 'They already have a meeting at that time. Pick another time.' && q('SELECT meeting_time FROM meetings WHERE id = ?', C)[0].meeting_time === '2026-11-20T11:30', r.status + ' ' + r.text);
r = await hit('POST', '/api/meetings/' + C + '/propose', { meeting_time: '2026-11-20T12:00' }, as(3));
check('she can propose 12:00', r.status === 200 && q('SELECT meeting_time FROM meetings WHERE id = ?', C)[0].meeting_time === '2026-11-20T12:00', r.status + ' ' + r.text);
r = await hit('PUT', '/api/meetings/' + A, { status: 'accepted' }, as(2));
check('accepting an accepted meeting again is not a clash with itself', r.status === 200, r.status + ' ' + r.text);

// ---- the busy times for the picker ----
r = await hit('GET', '/api/meetings/busy?with=2', undefined, as(1));
const mine = (r.json?.mine || []).map((b) => b.day + ' ' + b.start + '-' + b.end).sort();
const theirs = (r.json?.theirs || []).map((b) => b.day + ' ' + b.start + '-' + b.end).sort();
check('busy times: Asha 11:00-11:30 and 11:30-11:45 on the 20th; Ravi 11:00-11:30', r.status === 200 && JSON.stringify(mine) === JSON.stringify(['2026-11-20 660-690', '2026-11-20 690-705']) && JSON.stringify(theirs) === JSON.stringify(['2026-11-20 660-690']), r.status + ' ' + r.text);
check('busy times carry no names, titles or emails', !/Ravi|Asha|Meera|Intro|example\.com|Hall/.test(r.text), r.text);
r = await hit('GET', '/api/meetings/busy?with=2');
check('busy times need a sign-in', r.status === 401, r.status + ' ' + r.text);

// ---- the reminder, from the minute clock ----
const RealDate = Date;
const at = (iso) => { const T = RealDate.parse(iso); globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }; };
db.run("INSERT INTO meetings (event_id, requester_id, requestee_id, title, meeting_time, duration_minutes, status) VALUES (1, 2, 3, 'Unanswered', '2026-11-20T11:05', 15, 'pending')");
const tick = () => hit('POST', '/api/cron/tick', {}, { Authorization: 'Bearer smoke-admin' });
const reminders = () => sent.filter((m) => m.subject.startsWith('Starting soon'));
sent.length = 0;
at('2026-11-20T10:45:00+05:30');
r = await tick();
let rem = reminders();
check('at 10:45 the clock reminds Asha and Ravi of 11:00, and nobody else', r.status === 200 && rem.length === 2 && rem.some((m) => m.to === 'p1@example.com' && m.subject === 'Starting soon: your meeting with Ravi Receiver, 11:00 am IST') && rem.some((m) => m.to === 'p2@example.com' && m.subject === 'Starting soon: your meeting with Asha Sender, 11:00 am IST'), r.status + ' ' + JSON.stringify(rem.map((m) => m.to + ' ' + m.subject)) + ' ' + r.text.slice(0, 300));
check('the reminder says where, how long, and links to the meetings', /Hall/.test(rem[0]?.html || '') && /30 minutes/.test(rem[0]?.html || '') && /#inbox/.test(rem[0]?.html || ''), (rem[0]?.html || '').slice(0, 200));
r = await tick();
check('a second tick a moment later sends nothing again', reminders().length === 2, JSON.stringify(reminders().map((m) => m.to)));
at('2026-11-20T11:16:00+05:30');
r = await tick();
rem = reminders();
check('at 11:16 the 11:30 meeting is reminded to Asha and Meera; 11:00 is not sent twice; the unanswered request never', rem.length === 4 && rem.slice(2).every((m) => m.to === 'p1@example.com' || m.to === 'p3@example.com') && !rem.some((m) => /Unanswered/.test(m.html)), JSON.stringify(rem.map((m) => m.to + ' ' + m.subject)));
check('each reminder is claimed once in settings', q("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'meeting_reminder:%'")[0].n === 2, JSON.stringify(q("SELECT key FROM app_settings WHERE key LIKE 'meeting_reminder:%'")));
globalThis.Date = RealDate;

console.log(fails ? `\n${fails} FAILED` : '\nall meeting slot checks passed');
process.exit(fails ? 1 : 0);
