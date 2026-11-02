// Built-worker checks of the networking write rules fixed on 2 Nov 2026, against
// real SQLite (sql.js) loaded with the production schema:
//  - only the person asked may accept or decline a connection or a meeting, and
//    only known statuses are stored (any string from either side was, and was
//    drawn into the other person's page);
//  - a meeting needs a real requestee in this event, not yourself, and its text
//    is clipped and its duration a whole number;
//  - the connections lists carry no other_email (requests collected addresses);
//  - opening a thread marks it read only for its receiver;
//  - an email scanner opening the one-use sign-in link spends nothing, so the
//    6-digit code in the same email still works.
// Run after `npm run build`:  node scripts/verify/smoke-networking-guards.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
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
// No email goes anywhere: the mail service is answered here.
globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const SESSION = 'smoke-session';
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SESSION, DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}, cf) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (cf) Object.defineProperty(req, 'cf', { value: cf });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const as = (id) => ({ Cookie: sessionCookie(SESSION, id) });
const q = (sql, ...a) => rows(sql, clean(a));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- seed: two paid delegates, a visitor, someone in another event ----
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (2, 'Other', '2027-01-01', '2027-01-02')");
const person = (id, name, extra = {}) => {
  const row = { id, event_id: 1, name, email: 'p' + id + '@example.com', mobile: '98300' + String(id).padStart(5, '0'), company: 'Co ' + id,
    job_title: 'Director', industry: 'Software & SaaS', interests: 'ml', badge_type: 'Delegate Pass', payment_status: 'paid', main_event: 1, ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Asha Sender');
person(2, 'Ravi Receiver');
person(3, 'Vee Visitor', { badge_type: 'Visitor Pass' });
person(4, 'Other Event', { event_id: 2 });

// ---- connections ----
let r = await hit('POST', '/api/connections', { event_id: 1, from_attendee_id: 1, to_attendee_id: 2, message: 'I would like twenty minutes on computer vision for retail shelf audits.' }, as(1));
const connId = r.json?.id || q('SELECT id FROM connections ORDER BY id DESC LIMIT 1')[0]?.id;
check('a delegate can send a connection request', (r.status === 200 || r.status === 201) && !!connId, r.status + ' ' + r.text);
r = await hit('PUT', '/api/connections/' + connId, { status: 'accepted' }, as(1));
check('the sender cannot accept their own request', r.status === 403 && q('SELECT status FROM connections WHERE id = ?', connId)[0].status === 'pending', r.status + ' ' + r.text);
r = await hit('PUT', '/api/connections/' + connId, { status: '<img src=x onerror=alert(1)>' }, as(2));
check('an unknown status is refused, not stored', r.status === 400 && q('SELECT status FROM connections WHERE id = ?', connId)[0].status === 'pending', r.status + ' ' + r.text);
r = await hit('PUT', '/api/connections/' + connId, { status: 'pending' }, as(2));
check('"pending" cannot be set back by hand', r.status === 400, r.status + ' ' + r.text);
r = await hit('PUT', '/api/connections/' + connId, { status: 'accepted' }, as(3));
check('someone outside the request cannot answer it', r.status === 403, r.status + ' ' + r.text);
r = await hit('PUT', '/api/connections/' + connId, { status: 'accepted' }, as(2));
check('the person asked can accept', r.status === 200 && q('SELECT status FROM connections WHERE id = ?', connId)[0].status === 'accepted', r.status + ' ' + r.text);
r = await hit('PUT', '/api/connections/' + connId, { status: 'accepted' });
check('signed out, nobody can answer', r.status === 401, r.status + ' ' + r.text);

r = await hit('GET', '/api/attendees/1/connections', undefined, as(1));
check('the connections list carries no email of the other person', r.status === 200 && Array.isArray(r.json) && r.json.length === 1 && !('other_email' in r.json[0]) && !r.text.includes('p2@example.com'), r.status + ' ' + r.text.slice(0, 200));
check('the connections list still names the other person, company and id', r.json?.[0]?.other_name === 'Ravi Receiver' && r.json?.[0]?.other_company === 'Co 2' && Number(r.json?.[0]?.other_id) === 2, JSON.stringify(r.json?.[0]));
r = await hit('GET', '/api/attendees/1/dashboard', undefined, as(1));
const rc = r.json?.recentConnections || [];
check('the dashboard recent connections carry no email either, and still list the person', r.status === 200 && rc.length === 1 && rc[0].other_name === 'Ravi Receiver' && !('other_email' in rc[0]) && !JSON.stringify(rc).includes('p2@example.com'), r.status + ' ' + JSON.stringify(rc));

// ---- meetings ----
const meet = (body, who = 1) => hit('POST', '/api/meetings', { event_id: 1, requester_id: 1, requestee_id: 2, title: 'Intro', meeting_time: '2026-11-20T11:00', duration_minutes: 15, location: 'Hall', notes: '', ...body }, as(who));
r = await meet({ requestee_id: 1 });
check('you cannot ask yourself for a meeting', r.status === 400, r.status + ' ' + r.text);
r = await meet({ requestee_id: 999 });
check('a meeting with someone who does not exist is refused', r.status === 404, r.status + ' ' + r.text);
r = await meet({ requestee_id: 4 });
check('a meeting with someone in another event is refused', r.status === 404, r.status + ' ' + r.text);
r = await meet({ requester_id: 3, requestee_id: 2 }, 3);
check('a Visitor still cannot ask for a meeting', r.status === 403, r.status + ' ' + r.text);
r = await meet({ title: 'T'.repeat(500), location: 'L'.repeat(500), notes: 'N'.repeat(5000), duration_minutes: '15<img src=x>' });
const m1 = q('SELECT * FROM meetings WHERE id = ?', r.json?.id)[0] || {};
check('a meeting is stored with its text clipped and a whole-number duration', r.status === 201 && m1.title.length === 120 && m1.location.length === 120 && m1.notes.length === 1000 && Number(m1.duration_minutes) === 15, r.status + ' ' + JSON.stringify({ t: (m1.title || '').length, d: m1.duration_minutes }));
r = await meet({ duration_minutes: 99999 });
check('a huge duration is capped at 240 minutes', r.status === 201 && Number(q('SELECT duration_minutes FROM meetings WHERE id = ?', r.json?.id)[0].duration_minutes) === 240, r.status + ' ' + r.text);
const mid = r.json?.id;
r = await hit('PUT', '/api/meetings/' + mid, { status: 'accepted' }, as(1));
check('the requester cannot accept their own meeting', r.status === 403 && q('SELECT status FROM meetings WHERE id = ?', mid)[0].status === 'pending', r.status + ' ' + r.text);
r = await hit('PUT', '/api/meetings/' + mid, { status: '<b>x</b>' }, as(2));
check('an unknown meeting status is refused', r.status === 400, r.status + ' ' + r.text);
r = await hit('PUT', '/api/meetings/' + mid, { status: 'accepted' }, as(2));
check('the person asked can accept the meeting', r.status === 200 && q('SELECT status FROM meetings WHERE id = ?', mid)[0].status === 'accepted', r.status + ' ' + r.text);
r = await hit('PUT', '/api/meetings/' + mid, { status: 'cancelled' }, as(1));
check('the requester can cancel', r.status === 200 && q('SELECT status FROM meetings WHERE id = ?', mid)[0].status === 'cancelled', r.status + ' ' + r.text);

// ---- messages: read marks belong to the receiver ----
db.run("INSERT INTO messages (event_id, sender_id, receiver_id, content, is_read) VALUES (1, 1, 2, 'hi Ravi', 0)");
const unread = () => q('SELECT is_read FROM messages WHERE sender_id = 1 AND receiver_id = 2')[0].is_read;
r = await hit('GET', '/api/messages/2/1', undefined, as(1));
check('the sender opening the thread from the other end does not mark it read', r.status === 200 && Number(unread()) === 0, r.status + ' is_read=' + unread());
r = await hit('GET', '/api/messages/1/2', undefined, as(1));
check("the sender reading their own side leaves the receiver's unread alone", r.status === 200 && Number(unread()) === 0, r.status + ' is_read=' + unread());
r = await hit('GET', '/api/messages/2/1', undefined, as(2));
check('the receiver opening it marks it read', r.status === 200 && Number(unread()) === 1, r.status + ' is_read=' + unread());

// ---- an email scanner and the one-use sign-in email ----
const LINK = crypto.randomBytes(32).toString('hex');
db.run("INSERT INTO login_tokens (event_id, email, token_hash, code_hash, expires_at, max_uses, created_at) VALUES (1, 'p2@example.com', ?, ?, datetime('now', '+15 minutes'), 1, datetime('now', '-5 minutes'))", [sha(LINK), sha('123456')]);
const tok = () => q("SELECT uses, used_at FROM login_tokens WHERE email = 'p2@example.com' ORDER BY id DESC LIMIT 1")[0];
const AZURE = { asn: 8075, asOrganization: 'Microsoft Corporation' };
r = await hit('POST', '/api/events/1/attendees/login', { email: 'p2@example.com', token: LINK }, {}, AZURE);
check('a scanner opening the one-use link spends nothing', r.status === 200 && !tok().used_at && Number(tok().uses || 0) === 0, r.status + ' ' + JSON.stringify(tok()));
r = await hit('POST', '/api/events/1/attendees/login', { email: 'p2@example.com', code: '123456' });
check('the person can still type the 6-digit code from the same email', r.status === 200 && Number(r.json?.id) === 2, r.status + ' ' + r.text.slice(0, 160));
r = await hit('POST', '/api/events/1/attendees/login', { email: 'p2@example.com', code: '123456' });
check('and the code is then spent (one use)', r.status === 401 || r.status === 400 || r.status === 403, r.status + ' ' + r.text.slice(0, 160));

// ---- booth text is clipped and the size is one of three ----
person(5, 'Exa Exhibitor', { badge_type: 'Exhibitor' });
r = await hit('PUT', '/api/attendees/5/exhibitor', { company_name: 'C'.repeat(300), description: 'D'.repeat(5000), booth_size: '<script>', booth_number: 'B'.repeat(50), category: 'AI' }, as(5));
const ex = q('SELECT * FROM exhibitors WHERE attendee_id = 5')[0] || {};
check('a booth is saved with clipped text and a known size', r.status === 200 && ex.company_name.length === 120 && ex.description.length === 2000 && ex.booth_size === 'standard' && ex.booth_number.length === 20, r.status + ' ' + JSON.stringify({ c: (ex.company_name || '').length, s: ex.booth_size }));
r = await hit('PUT', '/api/attendees/5/exhibitor', { company_name: '   ' }, as(5));
check('a booth with no company name is refused', r.status === 400, r.status + ' ' + r.text);

// ---- profile rules (2 Nov 2026) ----
person(6, 'Free Visitor', { badge_type: 'Visitor Pass', lunch_inclusion: 'No' });
person(7, 'Lunch Delegate', { lunch_inclusion: 'Yes' });
r = await hit('PUT', '/api/attendees/6/profile', { lunch_inclusion: 'Yes' }, as(6));
check('a free Visitor cannot give themselves lunch', r.status === 200 && q('SELECT lunch_inclusion FROM attendees WHERE id = 6')[0].lunch_inclusion === 'No', r.status + ' ' + JSON.stringify(q('SELECT lunch_inclusion FROM attendees WHERE id = 6')));
r = await hit('PUT', '/api/attendees/7/profile', { lunch_inclusion: 'No' }, as(7));
check('a Delegate may still say no to lunch', r.status === 200 && q('SELECT lunch_inclusion FROM attendees WHERE id = 7')[0].lunch_inclusion === 'No', r.status + ' ' + r.text.slice(0, 120));
r = await hit('PUT', '/api/attendees/7/profile', { networking_goals: 'hiring' }, as(7));
const p7 = q('SELECT name, company, mobile, networking_goals FROM attendees WHERE id = 7')[0];
check('saving the goals alone changes nothing else', r.status === 200 && p7.networking_goals === 'hiring' && p7.name === 'Lunch Delegate' && p7.company === 'Co 7' && p7.mobile === '9830000007', r.status + ' ' + JSON.stringify(p7));
r = await hit('PUT', '/api/admin/attendees/7', { email: '  Rahul.S@Infosys.COM ' }, { Authorization: 'Bearer smoke-admin' });
check('an email typed in Admin is saved trimmed and lowercased, so it can sign in', r.status === 200 && q('SELECT email FROM attendees WHERE id = 7')[0].email === 'rahul.s@infosys.com', r.status + ' ' + JSON.stringify(q('SELECT email FROM attendees WHERE id = 7')));
r = await hit('GET', '/api/attendees/1/dashboard', undefined, as(1));
check('the dashboard carries created_at (the Me page "Since" card read Invalid Date)', r.status === 200 && !!r.json?.profile?.created_at, r.status + ' ' + JSON.stringify(r.json?.profile || {}).slice(0, 160));

console.log(fails ? `\n${fails} FAILED` : '\nall networking guard checks passed');
process.exit(fails ? 1 : 0);
