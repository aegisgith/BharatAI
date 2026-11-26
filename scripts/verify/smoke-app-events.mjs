// Integration: one event per sign-in, and the AI Agent Summit's networking app (27 Nov 2026),
// on the built worker with real SQLite and the production schema; email played here.
//  - /api/events/3/* opens only what the summit app needs; register, counts and glimpse stay shut;
//  - a Mumbai sign-in cannot list, open, connect with, message, meet or see the busy times of a
//    summit person, and a summit sign-in cannot reach Mumbai's;
//  - the summit app is for a paid Delegate or VIP, a confirmed Buyer or Investor, an exhibitor
//    or a speaker: the directory lists only them, the others get no sign-in link and no session;
//  - the event of a request is the sender's own, whatever the body says;
//  - summit meetings are on 16 April only, Mumbai's stay on 20 and 21 November;
//  - the summit's emails are its own (aiagentssummit.org/app, no Mumbai boardrooms or app block);
//  - a summit sign-in brings the profile from the same email's Mumbai registration;
//  - on 16 April the badge desk admits summit passes only, and the roster is the summit's.
// Run after `npm run build`:  node scripts/verify/smoke-app-events.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

// A clock the test can move: new Date() and Date.now() both read it.
const RealDate = Date;
let fakeNow = null;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0 && fakeNow !== null) super(fakeNow); else super(...a); }
  static now() { return fakeNow !== null ? fakeNow : RealDate.now(); }
}
globalThis.Date = FakeDate;

const worker = (await import(new URL('../../dist/_worker.js?' + RealDate.now(), import.meta.url).href)).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
db.exec('PRAGMA foreign_keys = ON');
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI Innovation 2026', '2026-11-20', '2026-11-21')");
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (3, 'AI Agent Summit 2027', '2027-04-16', '2027-04-16')");
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
const SECRET = 'smoke-session';
const ADMIN = 'smoke-admin';
const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SECRET, ELASTIC_EMAIL_API_KEY: 'test-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
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
const cookie = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const body = `${id}.${exp}`; return 'bai_session=' + body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('hex'); };
const hit = async (path, { as, method = 'GET', body, host = 'https://bharataiinnovation.com', admin = false } = {}) => {
  const headers = { 'CF-Connecting-IP': '10.9.9.9' };
  if (as) headers.Cookie = cookie(as);
  if (admin) headers.Authorization = 'Bearer ' + ADMIN;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request(host + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, cookie: res.headers.get('set-cookie') || '' };
};
const bodyOf = (m) => m.Content.Body[0].Content;
const to = (addr) => mail.filter((m) => m.Recipients.To.includes(addr));

// ---- the people ----
const full = { company: 'Acme Labs', job_title: 'CTO', industry: 'Software & SaaS', interests: 'agents, evals', bio: 'Builds agents', avatar_url: '/img/p.png', linkedin_url: 'https://linkedin.com/in/p' };
const people = [
  // id, event, name, email, badge, payment, profile
  [1, 1, 'Priya Shah', 'priya@example.com', 'Delegate Pass', 'paid', { ...full, avatar_url: '/img/priya.png', job_title: 'Head of AI', company: 'Shah Fintech', city: 'Pune' }],
  [2, 1, 'Ravi Kumar', 'ravi@example.com', 'Delegate Pass', 'paid', full],
  [10, 3, 'Priya Shah', 'priya@example.com', 'Delegate Pass', 'paid', { company: '', job_title: '', industry: '', interests: '', bio: '', avatar_url: '', linkedin_url: '' }],
  [11, 3, 'Meera Iyer', 'meera@example.com', 'Exhibitor', 'paid', full],
  [12, 3, 'Vik Rao', 'vik@example.com', 'Visitor Pass', 'paid', full],
  [13, 3, 'Bina Shah', 'bina@example.com', 'Buyer Pass', 'paid', full],
  [14, 3, 'Ian Dsouza', 'ian@example.com', 'Investor Pass', 'paid', full],
  [15, 3, 'Ada Nair', 'ada@example.com', 'Academic Pass', 'paid', full],
  [16, 3, 'Pen Das', 'pen@example.com', 'Delegate Pass', 'pending', full],
  [17, 3, 'Sam Speaker', 'sam@example.com', 'Visitor Pass', 'paid', { ...full }, 'speaker'],
];
for (const [id, ev, name, email, badge, pay, p, role] of people) {
  db.run(`INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, role, company, job_title, industry, interests, bio, avatar_url, linkedin_url, city)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ev, name, email, badge, pay, role || 'attendee', p.company, p.job_title, p.industry, p.interests, p.bio, p.avatar_url, p.linkedin_url, p.city || '']);
}
db.run("INSERT INTO admin_audit (actor, action, entity, entity_id) VALUES ('admin', 'summit.confirm', 'attendee', '14')");

// ---- the event 3 guard is an allowlist ----
let r = await hit('/api/events/3/registered-count');
check('event 3 count stays shut', r.status === 404, r.status);
r = await hit('/api/events/3/glimpse');
check('event 3 glimpse stays shut', r.status === 404, r.status);
r = await hit('/api/events/3/attendees/register', { method: 'POST', body: { name: 'X', email: 'x@example.com' } });
check('event 3 register stays shut (passes are sold on the summit pages)', r.status === 404, r.status);
r = await hit('/api/events/3/attendees');
check('event 3 directory needs a sign-in', r.status === 401, r.status);
r = await hit('/api/events/3/attendee-filters');
check('event 3 filters need a sign-in', r.status === 401, r.status);
r = await hit('/api/events/2/attendees', { as: 2 });
check('Delhi stays shut', r.status === 404, r.status);

// ---- sign-in: link only for passes with the app, profile carried from Mumbai ----
mail = [];
r = await hit('/api/events/3/attendees/send-magic-link', { method: 'POST', body: { email: 'vik@example.com' } });
await settled();
check('a summit Visitor gets the neutral reply and no link', r.status === 200 && r.json?.success === true && to('vik@example.com').length === 0, r.text + ' mails ' + mail.length);
r = await hit('/api/events/3/attendees/send-magic-link', { method: 'POST', body: { email: 'priya@example.com' } }, );
await settled();
const signin = to('priya@example.com')[0];
check('a summit Delegate gets the summit sign-in email', !!signin && /AI Agent Summit app/.test(signin.Content.Subject) && /https:\/\/aiagentssummit\.org\/app\?email=/.test(bodyOf(signin)), signin ? signin.Content.Subject : 'none');
check('the summit sign-in email has no Mumbai date or app block', !!signin && !/20&ndash;21 Nov|20–21 Nov|Bharat AI Connect|Save the Bharat AI app/.test(bodyOf(signin)) && /16 April 2027/.test(bodyOf(signin)), signin ? bodyOf(signin).slice(0, 200) : '');
const code = signin ? (bodyOf(signin).match(/letter-spacing:6px;font-weight:bold;color:#0d1013;">(\d{6})</) || [])[1] : '';
r = await hit('/api/events/3/attendees/login', { method: 'POST', body: { email: 'priya@example.com', code } });
check('the code signs the summit Delegate in, with a session', r.status === 200 && r.json?.id === 10 && /bai_session=10\./.test(r.cookie), r.status + ' ' + r.text.slice(0, 120));
check('their Mumbai profile came with them (photo, title, company, city)', r.json?.avatar_url === '/img/priya.png' && r.json?.job_title === 'Head of AI' && r.json?.company === 'Shah Fintech' && r.json?.city === 'Pune', JSON.stringify(r.json || {}).slice(0, 200));
check('the carry-over is written to the summit row and audited', rows('SELECT job_title FROM attendees WHERE id = 10')[0].job_title === 'Head of AI' && rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'profile.carried' AND entity_id = '10'")[0].n === 1);
check('the Mumbai row is untouched', rows('SELECT job_title FROM attendees WHERE id = 1')[0].job_title === 'Head of AI' && rows('SELECT COUNT(*) AS n FROM attendees WHERE id = 1 AND event_id = 1')[0].n === 1);
db.run("UPDATE attendees SET job_title = 'Chief AI Officer' WHERE id = 10");
r = await hit('/api/events/3/attendees/send-magic-link', { method: 'POST', body: { email: 'priya@example.com' } });
await settled();
const code2 = (bodyOf(to('priya@example.com').slice(-1)[0]).match(/color:#0d1013;">(\d{6})</) || [])[1];
r = await hit('/api/events/3/attendees/login', { method: 'POST', body: { email: 'priya@example.com', code: code2 } });
check('a field already written for the summit is never overwritten', r.json?.job_title === 'Chief AI Officer', r.json?.job_title);

// ---- the directory ----
r = await hit('/api/events/1/attendees', { as: 10 });
check('a summit sign-in cannot list Mumbai', r.status === 403 && r.json?.code === 'wrong_event', r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/events/3/attendees', { as: 1 });
check('a Mumbai sign-in cannot list the summit', r.status === 403 && r.json?.code === 'wrong_event', r.status);
r = await hit('/api/events/1/attendees', { as: 1 });
check('a Mumbai Delegate still lists Mumbai', r.status === 200 && (r.json || []).some((a) => a.id === 2), r.status);
r = await hit('/api/events/3/attendees?limit=50', { as: 10 });
const listed = (r.json || []).map((a) => a.id).sort((a, b) => a - b);
check('the summit directory lists only people with the app', r.status === 200 && JSON.stringify(listed.filter((id) => id !== 10)) === JSON.stringify([11, 14, 17]), r.status + ' ' + JSON.stringify(listed));
r = await hit('/api/events/3/attendees', { as: 12 });
check('a summit Visitor has no app', r.status === 403 && r.json?.code === 'no_app', r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/events/3/attendees', { as: 16 });
check('an unpaid summit Delegate has no app yet', r.status === 403 && r.json?.code === 'no_app', r.status);
r = await hit('/api/events/3/attendees', { as: 13 });
check('an unconfirmed Buyer has no app yet', r.status === 403 && r.json?.code === 'no_app', r.status);
r = await hit('/api/events/3/attendees', { as: 14 });
check('a confirmed Investor has the app', r.status === 200, r.status);
r = await hit('/api/events/3/attendees', { admin: true });
check('Admin lists every summit row', r.status === 200 && (r.json || []).length === 8, r.status + ' ' + (r.json || []).length);
r = await hit('/api/events/3/suggested-attendees', { as: 10 });
check('summit suggestions are people with the app', r.status === 200 && (r.json || []).length > 0 && (r.json || []).every((a) => [11, 14, 17].includes(a.id)), JSON.stringify((r.json || []).map((a) => a.id)));
r = await hit('/api/events/1/suggested-attendees', { as: 10 });
check('a summit sign-in gets no Mumbai suggestions', r.status === 403, r.status);

// ---- single profiles ----
r = await hit('/api/attendees/11', { as: 1 });
check('a Mumbai Delegate cannot open a summit profile (the leak of 26 Nov)', r.status === 404, r.status + ' ' + r.text.slice(0, 60));
r = await hit('/api/attendees/2', { as: 10 });
check('a summit Delegate cannot open a Mumbai profile', r.status === 404, r.status);
r = await hit('/api/attendees/12', { as: 10 });
check('a summit Visitor (no app) is not openable', r.status === 404, r.status);
r = await hit('/api/attendees/11', { as: 10 });
check('a summit exhibitor is openable by a summit Delegate', r.status === 200 && r.json?.name === 'Meera Iyer', r.status);
r = await hit('/api/attendees/10', { as: 10 });
check('my own profile always opens', r.status === 200, r.status);
r = await hit('/api/attendees/2', { as: 1 });
check('Mumbai to Mumbai unchanged', r.status === 200 && r.json?.name === 'Ravi Kumar', r.status);

// ---- connections ----
const reason = 'I would like to compare notes on agent evaluation.';
mail = [];
r = await hit('/api/connections', { as: 1, method: 'POST', body: { event_id: 3, from_attendee_id: 1, to_attendee_id: 11, message: reason } });
check('Mumbai to a summit person, even naming event 3: refused', r.status === 404 && rows('SELECT COUNT(*) AS n FROM connections')[0].n === 0, r.status + ' ' + r.text);
r = await hit('/api/connections', { as: 10, method: 'POST', body: { event_id: 1, from_attendee_id: 10, to_attendee_id: 2, message: reason } });
check('summit to a Mumbai person, even naming event 1: refused', r.status === 404, r.status + ' ' + r.text);
r = await hit('/api/connections', { as: 10, method: 'POST', body: { event_id: 1, from_attendee_id: 10, to_attendee_id: 12, message: reason } });
check('summit to a summit Visitor (no app): refused', r.status === 404 && /not on the summit app/.test(r.text), r.status + ' ' + r.text);
r = await hit('/api/connections', { as: 10, method: 'POST', body: { event_id: 1, from_attendee_id: 10, to_attendee_id: 11, message: reason } });
await settled();
check('summit to a summit exhibitor: saved under event 3 whatever the body said', r.status === 201 && rows('SELECT event_id FROM connections WHERE from_attendee_id = 10 AND to_attendee_id = 11')[0]?.event_id === 3, r.status + ' ' + r.text);
const connMail = to('meera@example.com')[0];
check('the request email is the summit\'s, with its accept link on its own domain', !!connMail && /AI Agent Summit 2027/.test(connMail.Content.Subject) && /https:\/\/aiagentssummit\.org\/c\//.test(bodyOf(connMail)) && !/Bharat AI Innovation 2026/.test(bodyOf(connMail)), connMail ? connMail.Content.Subject : 'none');
r = await hit('/api/connections', { as: 12, method: 'POST', body: { event_id: 3, from_attendee_id: 12, to_attendee_id: 11, message: reason } });
check('a summit Visitor cannot ask', r.status === 403, r.status);
mail = [];
r = await hit('/api/connections', { as: 1, method: 'POST', body: { event_id: 1, from_attendee_id: 1, to_attendee_id: 2, message: reason } });
await settled();
check('Mumbai to Mumbai unchanged, with Mumbai\'s email', r.status === 201 && /Bharat AI Innovation 2026/.test(to('ravi@example.com')[0]?.Content.Subject || ''), r.status + ' ' + (to('ravi@example.com')[0]?.Content.Subject || 'none'));

// connection accepted: summit wording, no Mumbai boardrooms
const connId = rows('SELECT id FROM connections WHERE from_attendee_id = 10 AND to_attendee_id = 11')[0].id;
mail = [];
r = await hit('/api/connections/' + connId, { as: 11, method: 'PUT', body: { status: 'accepted' } });
await settled();
const acc = to('priya@example.com')[0];
check('the accepted email is the summit\'s, without the WTC boardrooms', !!acc && /AI Agent Summit 2027/.test(acc.Content.Subject) && !/boardroom|20th or 21st/i.test(bodyOf(acc)) && /16 April/.test(bodyOf(acc)), acc ? acc.Content.Subject + ' ' + r.status : 'none ' + r.status + r.text);

// ---- messages ----
r = await hit('/api/messages', { as: 1, method: 'POST', body: { event_id: 3, sender_id: 1, receiver_id: 11, content: 'Hello from Mumbai' } });
check('Mumbai cannot message a summit person', r.status === 404 && rows('SELECT COUNT(*) AS n FROM messages')[0].n === 0, r.status + ' ' + r.text);
r = await hit('/api/messages', { as: 1, method: 'POST', body: { event_id: 1, sender_id: 1, receiver_id: 99999, content: 'Hello nobody' } });
check('a message to nobody is refused (it used to be written)', r.status === 404, r.status);
mail = [];
r = await hit('/api/messages', { as: 10, method: 'POST', body: { event_id: 1, sender_id: 10, receiver_id: 11, content: 'See you at the summit' } });
await settled();
check('summit to summit: saved under event 3', r.status === 201 && rows('SELECT event_id FROM messages WHERE sender_id = 10')[0]?.event_id === 3, r.status + ' ' + r.text);
const msgMail = to('meera@example.com')[0];
check('the message email points at the summit app', !!msgMail && /AI Agent Summit 2027/.test(msgMail.Content.Subject) && /aiagentssummit\.org\/app#inbox/.test(bodyOf(msgMail)) && /the AI Agent Summit app/.test(bodyOf(msgMail)), msgMail ? msgMail.Content.Subject : 'none');
r = await hit('/api/messages', { as: 10, method: 'POST', body: { sender_id: 10, receiver_id: 15, content: 'Hi' } });
check('summit to an Academic Pass (no app): refused', r.status === 404, r.status);

// ---- meetings ----
r = await hit('/api/meetings', { as: 10, method: 'POST', body: { event_id: 3, requester_id: 10, requestee_id: 11, title: 'Demo', meeting_time: '2026-11-20T10:00', duration_minutes: 15 } });
check('a summit meeting on a Mumbai day: refused with the 16 April sentence', r.status === 400 && /16 April/.test(r.text), r.status + ' ' + r.text);
mail = [];
r = await hit('/api/meetings', { as: 10, method: 'POST', body: { event_id: 1, requester_id: 10, requestee_id: 11, title: 'Demo', meeting_time: '2027-04-16T11:00', duration_minutes: 15 } });
await settled();
check('a summit meeting on 16 April: saved under event 3', r.status === 201 && rows('SELECT event_id FROM meetings WHERE requester_id = 10')[0]?.event_id === 3, r.status + ' ' + r.text);
check('the meeting email points at the summit app', /aiagentssummit\.org\/app#inbox/.test(bodyOf(to('meera@example.com')[0] || { Content: { Body: [{ Content: '' }] } })), (to('meera@example.com')[0] || {}).Content?.Subject || 'none');
r = await hit('/api/meetings', { as: 1, method: 'POST', body: { event_id: 3, requester_id: 1, requestee_id: 11, title: 'Demo', meeting_time: '2026-11-20T11:00' } });
check('Mumbai cannot ask a summit person to meet', r.status === 404, r.status + ' ' + r.text);
r = await hit('/api/meetings', { as: 1, method: 'POST', body: { event_id: 1, requester_id: 1, requestee_id: 2, title: 'Coffee', meeting_time: '2027-04-16T11:00' } });
check('a Mumbai meeting on the summit day: refused with Mumbai\'s sentence', r.status === 400 && /20 or 21 November/.test(r.text), r.status + ' ' + r.text);
r = await hit('/api/meetings', { as: 1, method: 'POST', body: { event_id: 1, requester_id: 1, requestee_id: 2, title: 'Coffee', meeting_time: '2026-11-20T11:00' } });
check('Mumbai meetings unchanged', r.status === 201, r.status + ' ' + r.text);
const summitMeeting = rows('SELECT id FROM meetings WHERE requester_id = 10')[0].id;
r = await hit('/api/meetings/' + summitMeeting + '/propose', { as: 11, method: 'POST', body: { meeting_time: '2026-11-21T10:00' } });
check('proposing a Mumbai day for a summit meeting: refused', r.status === 400 && /16 April/.test(r.text), r.status + ' ' + r.text);
r = await hit('/api/meetings/' + summitMeeting + '/propose', { as: 11, method: 'POST', body: { meeting_time: '2027-04-16T15:30' } });
check('proposing another time on 16 April: saved', r.status === 200, r.status + ' ' + r.text);

// ---- busy times ----
db.run("UPDATE meetings SET status = 'accepted'");
r = await hit('/api/meetings/busy?with=11', { as: 1 });
check('a Mumbai sign-in sees no busy times of a summit person', r.status === 200 && (r.json?.theirs || []).length === 0, r.text);
r = await hit('/api/meetings/busy?with=11', { as: 10 });
check('a summit sign-in sees a summit person\'s busy times', r.status === 200 && (r.json?.theirs || []).length === 1, r.text);

// ---- the badge desk on 16 April ----
const tokenOf = async (id) => (await hit('/api/my-pass-token?id=' + id, { admin: true })).json?.token;
const tMumbai = await tokenOf(2), tSummit = await tokenOf(11);
fakeNow = RealDate.parse('2027-04-16T04:30:00Z'); // 10:00 IST on the summit day
r = await hit('/api/staff/scan', { admin: true, method: 'POST', body: { token: tMumbai } });
check('on 16 April a Mumbai pass is refused at the desk', r.status === 200 && r.json?.state === 'other_event' && /Bharat AI Innovation 2026/.test(r.json?.note || ''), r.text.slice(0, 160));
r = await hit('/api/verify/' + tMumbai + '/checkin', { admin: true, method: 'POST', body: {} });
check('and cannot be checked in from the verify page', r.status === 400 && /AI Agent Summit 2027/.test(r.text), r.status + ' ' + r.text);
r = await hit('/api/staff/scan', { admin: true, method: 'POST', body: { token: tSummit } });
check('a summit pass checks in on 16 April', r.status === 200 && r.json?.state === 'ok', r.text.slice(0, 160));
r = await hit('/api/staff/roster', { admin: true });
check('the desk roster on 16 April is the summit\'s', r.status === 200 && (r.json?.people || []).length === 8 && (r.json?.people || []).every((p) => p[0] >= 10), r.status + ' ' + JSON.stringify((r.json?.people || []).map((p) => p[0])));
fakeNow = RealDate.parse('2026-12-01T04:30:00Z'); // any other day
r = await hit('/api/staff/scan', { admin: true, method: 'POST', body: { token: tMumbai } });
check('on any other day a pass checks in as before', r.status === 200 && r.json?.state === 'ok', r.text.slice(0, 160));
fakeNow = null;

// ---- the app page by host ----
r = await hit('/app', { host: 'https://aiagentssummit.org' });
check('aiagentssummit.org/app is the summit app (data-event 3, its title and address)', r.status === 200 && /<html lang="en" data-event="3">/.test(r.text) && /<title>AI Agent Summit 2027/.test(r.text) && /rel="canonical" href="https:\/\/aiagentssummit\.org\/app"/.test(r.text), r.status + ' ' + r.text.slice(0, 120));
check('the summit app has its own front screen, footer and sign-in words', /id="summit-home"/.test(r.text) && /Friday 16 April 2027, World Trade Center Mumbai/.test(r.text) && !/Log In \/ Register/.test(r.text) && !/&copy; 2026 Bharat AI Innovation/.test(r.text), 'markup');
check('the summit meeting picker offers 16 April only', /<option value="2027-04-16">Fri 16 Apr<\/option>/.test(r.text) && !/<option value="2026-11-20">/.test(r.text), 'options');
check('the summit page never names Mumbai 2026 in its head', !/Bharat AI Innovation 2026|20–21 Nov/.test(r.text.split('</head>')[0]), r.text.split('</head>')[0].match(/Bharat AI Innovation 2026|20–21 Nov/));
r = await hit('/app');
check('bharataiinnovation.com/app is still Mumbai', r.status === 200 && /<html lang="en">/.test(r.text) && !/data-event="3"/.test(r.text) && /<title>Bharat AI Innovation 2026/.test(r.text) && !/id="summit-home"/.test(r.text), r.text.slice(0, 120));

// ---- the networking pages of other routes: Mumbai unchanged ----
r = await hit('/api/events/1/attendees', { as: 2 });
check('Mumbai directory unchanged for a Mumbai Delegate', r.status === 200, r.status);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
