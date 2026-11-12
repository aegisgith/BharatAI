// Built-worker checks of questions from the room (12 Nov 2026), on real SQLite (sql.js)
// with the production schema and migration 0060:
//  - before 0060 the app is told questions open shortly; signed out sees nothing;
//  - asking: a few words at least, 300 characters at most, not on a break, five a
//    session, one every 15 seconds, a double tap is one question;
//  - the app's list never carries who asked (no name, organisation, email or id);
//  - votes: one each, never your own, the same button takes it back;
//  - only the asker withdraws; withdrawn questions are gone for everyone;
//  - the moderator's key is per session; it sees names unless asked without one,
//    marks answered (listed after the waiting ones), hides (gone from the app) and
//    shows again; Admin lists every session with its counts and both links.
// Run after `npm run build`:  node scripts/verify/smoke-session-qa.mjs
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
globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const ADMIN = 'smoke-admin';
const SESSION = 'smoke-session';
const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SESSION, DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const admin = { Authorization: 'Bearer ' + ADMIN };
const as = (id) => ({ Cookie: sessionCookie(SESSION, id) });
const q = (sql, ...a) => rows(sql, clean(a));
const key = (sid) => crypto.createHmac('sha256', ADMIN).update('qa:' + sid).digest('hex').slice(0, 32);
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
const person = (id, name, extra = {}) => {
  const row = { id, event_id: 1, name, email: 'p' + id + '@example.com', mobile: '98300' + String(id).padStart(5, '0'), company: 'Co ' + id, job_title: 'Director', badge_type: 'Delegate Pass', payment_status: 'paid', main_event: 1, ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Asha Rao');
person(2, 'Ravi Kumar');
person(3, 'Vee Visitor', { badge_type: 'Visitor Pass', payment_status: '' });
db.run("INSERT INTO sessions (id, event_id, title, session_type, room, start_time, end_time) VALUES (10, 1, 'AI in Healthcare', 'panel', 'Bhabha', '2026-11-20T11:00', '2026-11-20T11:45'), (11, 1, 'Lunch', 'break', '', '2026-11-20T13:00', '2026-11-20T14:00'), (12, 1, 'Keynote', 'keynote', 'Kalam', '2026-11-20T10:00', '2026-11-20T10:30')");
const ask = (who, sid, body, anonymous) => hit('POST', '/api/sessions/' + sid + '/questions', { body, anonymous }, as(who));
const age = () => db.run("UPDATE session_questions SET created_at = datetime('now', '-1 minute')");

// ---- before 0060 ----
let r = await hit('GET', '/api/sessions/10/questions', undefined, as(1));
check('before 0060 the app is told questions open shortly', r.status === 200 && r.json?.ready === false && r.json?.session?.title === 'AI in Healthcare', r.status + ' ' + r.text);
r = await ask(1, 10, 'What is the hardest part of clinical validation?');
check('before 0060 asking says questions open shortly (503)', r.status === 503 && /open shortly/.test(r.json?.error || ''), r.status + ' ' + r.text);
db.exec(readFileSync(new URL('../../migrations/0060_session_questions.sql', import.meta.url), 'utf8'));

// ---- asking ----
r = await hit('GET', '/api/sessions/10/questions');
check('signed out sees nothing', r.status === 401, r.status + ' ' + r.text);
r = await hit('POST', '/api/sessions/10/questions', { body: 'A question from nobody at all' });
check('signed out cannot ask', r.status === 401, r.status + ' ' + r.text);
r = await ask(1, 10, 'Why?');
check('a few words at least', r.status === 400 && /few words/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await ask(1, 10, 'x'.repeat(301));
check('300 characters at most', r.status === 400 && /300/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await ask(1, 11, 'Is lunch vegetarian today?');
check('a break takes no questions', r.status === 400, r.status + ' ' + r.text);
r = await ask(1, 999, 'Where is this session?');
check('a session that does not exist', r.status === 404, r.status + ' ' + r.text);
r = await ask(1, 10, '  What is the hardest part   of clinical validation?  ');
const q1 = r.json?.id;
check('Asha asks; the spaces are tidied', r.status === 201 && !!q1 && q('SELECT body FROM session_questions WHERE id = ?', q1)[0]?.body === 'What is the hardest part of clinical validation?', r.status + ' ' + r.text);
r = await ask(1, 10, 'What is the hardest part of clinical validation?');
check('a double tap is one question', r.status === 200 && r.json?.id === q1 && q('SELECT COUNT(*) AS n FROM session_questions')[0].n === 1, r.status + ' ' + r.text);
r = await ask(1, 10, 'And how do you price it for hospitals?');
check('a second question within 15 seconds waits, in words', r.status === 429 && /few seconds ago/.test(r.json?.error || ''), r.status + ' ' + r.text);
age();
r = await ask(2, 10, '<img src=x onerror=alert(1)> Which datasets do you trust?', true);
const q2 = r.json?.id;
check('Ravi asks without his name (the text is stored as he typed it)', r.status === 201 && q('SELECT anonymous FROM session_questions WHERE id = ?', q2)[0]?.anonymous === 1, r.status + ' ' + r.text);
r = await ask(3, 10, 'Will the slides be shared after?');
const q3 = r.json?.id;
check('a Visitor can ask too', r.status === 201, r.status + ' ' + r.text);
for (let i = 0; i < 4; i++) { age(); await ask(1, 10, 'Another question, number ' + i); }
age();
r = await ask(1, 10, 'One more question, the sixth');
check('five questions a person a session', r.status === 429 && /5 questions/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await ask(1, 12, 'A question for the keynote instead');
check('the five are per session', r.status === 201, r.status + ' ' + r.text);

// ---- the app's list ----
r = await hit('GET', '/api/sessions/10/questions', undefined, as(2));
const list = r.json?.questions || [];
check("the app's list never says who asked", r.status === 200 && list.length === 7 && !/Asha|Ravi|Vee|Co 1|Co 2|example\.com|attendee_id|"who"/.test(r.text), r.text.slice(0, 300));
check('your own question is marked yours', list.find((x) => x.id === q2)?.own === true && list.find((x) => x.id === q1)?.own === false, JSON.stringify(list.slice(0, 2)));

// ---- votes ----
r = await hit('POST', '/api/questions/' + q2 + '/vote', {}, as(2));
check('you cannot vote for your own question', r.status === 400, r.status + ' ' + r.text);
r = await hit('POST', '/api/questions/' + q2 + '/vote', {}, as(1));
check('a vote counts once', r.status === 200 && r.json?.voted === true && r.json?.votes === 1, r.status + ' ' + r.text);
await hit('POST', '/api/questions/' + q2 + '/vote', {}, as(3));
r = await hit('POST', '/api/questions/' + q2 + '/vote', {}, as(1));
check('the same button takes the vote back', r.status === 200 && r.json?.voted === false && r.json?.votes === 1, r.status + ' ' + r.text);
await hit('POST', '/api/questions/' + q2 + '/vote', {}, as(1));
r = await hit('GET', '/api/sessions/10/questions', undefined, as(1));
check('most votes first, and your vote is shown as yours', r.json?.questions?.[0]?.id === q2 && r.json.questions[0].votes === 2 && r.json.questions[0].voted === true, JSON.stringify(r.json?.questions?.[0]));

// ---- withdraw ----
r = await hit('POST', '/api/questions/' + q3 + '/withdraw', {}, as(1));
check('only the asker can withdraw', r.status === 403, r.status + ' ' + r.text);
r = await hit('POST', '/api/questions/' + q3 + '/withdraw', {}, as(3));
r = await hit('GET', '/api/sessions/10/questions', undefined, as(2));
check('a withdrawn question is gone for everyone', !(r.json?.questions || []).some((x) => x.id === q3), JSON.stringify(r.json?.questions?.map((x) => x.id)));
r = await hit('POST', '/api/questions/' + q3 + '/vote', {}, as(1));
check('and takes no votes', r.status === 404, r.status + ' ' + r.text);

// ---- the moderator ----
r = await hit('GET', '/api/sessions/10/questions?k=' + key(12));
check("another session's key opens nothing", r.status === 401, r.status + ' ' + r.text);
r = await hit('GET', '/api/sessions/10/questions?k=' + key(10));
const mq = r.json?.questions || [];
check('the moderator sees first name and organisation, and no name when asked without one', r.status === 200 && r.json?.moderator === true && mq.find((x) => x.id === q1)?.who === 'Asha, Co 1' && mq.find((x) => x.id === q2)?.who === '' && !/example\.com/.test(r.text), JSON.stringify(mq.slice(0, 3)));
r = await hit('POST', '/api/questions/' + q2 + '/moderate', { k: key(12), status: 'answered' });
check("the moderator of another session cannot change this one", r.status === 401, r.status + ' ' + r.text);
r = await hit('POST', '/api/questions/' + q2 + '/moderate', { k: key(10), status: 'deleted' });
check('only answered, hidden or live', r.status === 400, r.status + ' ' + r.text);
r = await hit('POST', '/api/questions/' + q2 + '/moderate', { k: key(10), status: 'answered' });
r = await hit('GET', '/api/sessions/10/questions', undefined, as(1));
const after = r.json?.questions || [];
check('answered: still listed, after every waiting question', after[after.length - 1]?.id === q2 && after[after.length - 1]?.status === 'answered', JSON.stringify(after.map((x) => x.id + ':' + x.status)));
await hit('POST', '/api/questions/' + q1 + '/moderate', { k: key(10), status: 'hidden' });
r = await hit('GET', '/api/sessions/10/questions', undefined, as(2));
const mod = await hit('GET', '/api/sessions/10/questions?k=' + key(10));
check('hidden: gone from the app, still on the moderator screen to show again', !(r.json?.questions || []).some((x) => x.id === q1) && (mod.json?.questions || []).some((x) => x.id === q1 && x.status === 'hidden'), r.text.slice(0, 200));
await hit('POST', '/api/questions/' + q1 + '/moderate', { k: key(10), status: 'live' });
r = await hit('GET', '/api/sessions/10/questions', undefined, as(2));
check('shown again: back in the app', (r.json?.questions || []).some((x) => x.id === q1 && x.status === 'live'), '');

// ---- Admin ----
r = await hit('GET', '/api/admin/session-questions?event=1');
check('Admin needs a sign-in', r.status === 401 || r.status === 403, String(r.status));
r = await hit('GET', '/api/admin/session-questions?event=1', undefined, admin);
const s10 = (r.json?.sessions || []).find((x) => x.id === 10) || {};
check('Admin: sessions without breaks, by time, with counts', r.status === 200 && (r.json?.sessions || []).map((x) => x.id).join(',') === '12,10' && s10.live === 5 && s10.answered === 1, r.text.slice(0, 300));
check("Admin: each session's moderator link and hall link carry that session's key", s10.moderator_url === 'https://bharataiinnovation.com/live?s=10&k=' + key(10) && s10.stage_url === s10.moderator_url + '&view=stage', s10.moderator_url + ' ' + s10.stage_url);

console.log(fails ? `\n${fails} FAILED` : '\nall session question checks passed');
process.exit(fails ? 1 : 0);
