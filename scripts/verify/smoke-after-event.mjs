// Built-worker checks of After the Event (12 Nov 2026), on real SQLite (sql.js) with the
// production schema and migrations 0050, 0051 and 0057:
//  - the survey link is signed per person; a wrong or borrowed signature opens nothing;
//    the app's sign-in also works; opening a link (an email scanner) saves nothing;
//  - answers are checked (the first question is required, unknown choices dropped) and
//    answering again replaces them; before 0057 the page says it opens shortly;
//  - the bulk run 'feedback' goes to the people who checked in and skips anyone who has
//    answered; the email's links carry the person's signature, the preview's do not;
//  - Admin's summary: the recommend score and its sums, Delhi yes/maybe, the comments,
//    and a CSV where an answer cannot run as a formula;
//  - exhibitor results: badges scanned with ratings, the team's accepted meetings, app
//    visits; the email goes to the booth contact with a signed link to the dashboard's
//    Leads, once unless sent again on purpose, never with a mobile number.
// Run after `npm run build`:  node scripts/verify/smoke-after-event.mjs
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
for (const m of ['0050_exhibitor_team.sql', '0051_leads_and_daily_checkins.sql']) db.exec(readFileSync(new URL('../../migrations/' + m, import.meta.url), 'utf8'));
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
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail')) { try { const b = JSON.parse(init.body); sent.push({ to: b.Recipients.To[0], subject: b.Content.Subject, html: b.Content.Body[0].Content }); } catch {} }
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const ADMIN = 'smoke-admin';
const SESSION = 'smoke-session';
const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SESSION, ELASTIC_EMAIL_API_KEY: 'smoke-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, headers: res.headers };
};
const admin = { Authorization: 'Bearer ' + ADMIN };
const as = (id) => ({ Cookie: sessionCookie(SESSION, id) });
const q = (sql, ...a) => rows(sql, clean(a));
const sig = (id) => crypto.createHmac('sha256', ADMIN).update('feedback:' + id).digest('hex').slice(0, 32);
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
const person = (id, name, extra = {}) => {
  const row = { id, event_id: 1, name, email: 'p' + id + '@example.com', mobile: '98300' + String(id).padStart(5, '0'), company: 'Co ' + id,
    job_title: 'Director', badge_type: 'Delegate Pass', payment_status: 'paid', main_event: 1, checked_in_at: '2026-11-20 04:00:00', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Asha Rao');
person(2, 'Ravi Kumar');
person(3, 'Neel Absent', { checked_in_at: null });
person(4, 'Exhibitor Owner');
person(5, 'Team Member');

// ---- before 0057 ----
let r = await hit('GET', '/api/feedback?a=1&k=' + sig(1));
check('before 0057, the page still opens with the first name and no answers', r.status === 200 && r.json?.first_name === 'Asha' && r.json?.answered === null, r.status + ' ' + r.text);
r = await hit('POST', '/api/feedback', { a: 1, k: sig(1), recommend: 9 });
check('before 0057, sending says the survey opens shortly (503), in words', r.status === 503 && /opens in a few minutes/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await hit('GET', '/api/admin/feedback/summary', undefined, admin);
check('before 0057, Admin is told the survey is not ready', r.status === 200 && r.json?.ready === false, r.status + ' ' + r.text);
db.exec(readFileSync(new URL('../../migrations/0057_feedback.sql', import.meta.url), 'utf8'));

// ---- the link ----
r = await hit('GET', '/api/feedback?a=1&k=0123456789abcdef0123456789abcdef');
check('a wrong signature opens nothing', r.status === 401 && /not complete/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await hit('GET', '/api/feedback?a=2&k=' + sig(1));
check("one person's signature does not open another person's survey", r.status === 401, r.status + ' ' + r.text);
r = await hit('GET', '/api/feedback');
check('no link and not signed in: refused', r.status === 401, r.status + ' ' + r.text);
r = await hit('GET', '/api/feedback', undefined, as(2));
check('signed in to the app, the survey opens for that person', r.status === 200 && r.json?.first_name === 'Ravi', r.status + ' ' + r.text);
r = await hit('GET', '/api/feedback?a=2&k=' + sig(2) + '&r=9');
check('opening the link (as an email scanner does) saves nothing', r.status === 200 && q('SELECT COUNT(*) AS n FROM feedback')[0].n === 0, r.status + ' ' + r.text);

// ---- answers ----
r = await hit('POST', '/api/feedback', { a: 1, k: sig(1) });
check('the first question is required, in words', r.status === 400 && r.json?.field === 'recommend' && /0 to 10/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await hit('POST', '/api/feedback', { a: 1, k: sig(1), recommend: 11 });
check('11 is refused', r.status === 400, r.status + ' ' + r.text);
r = await hit('POST', '/api/feedback', { a: 1, k: sig(1), recommend: 4.5 });
check('4.5 is refused', r.status === 400, r.status + ' ' + r.text);
r = await hit('POST', '/api/feedback', { a: 1, k: sig(1), recommend: 7, useful: ['talks', 'toString', 'people', 'talks', '<b>'], met: 'constructor', entry: 'good', delhi: 'maybe', fix: '  Longer lunch  ' });
let f1 = q('SELECT * FROM feedback WHERE attendee_id = 1')[0] || {};
check('answers are saved; unknown choices (even "toString", "constructor") are dropped; the text is trimmed', r.status === 200 && f1.recommend === 7 && f1.useful === 'talks,people' && f1.met === '' && f1.entry === 'good' && f1.delhi === 'maybe' && f1.fix === 'Longer lunch', r.status + ' ' + JSON.stringify(f1));
r = await hit('POST', '/api/feedback', { a: 1, k: sig(1), recommend: 10, useful: ['exhibition'], met: 'several', entry: 'okay', delhi: 'yes', fix: '=HYPERLINK("http://x","y")' });
f1 = q('SELECT * FROM feedback WHERE attendee_id = 1');
check('answering again replaces the answers, one row per person', r.status === 200 && f1.length === 1 && f1[0].recommend === 10 && f1[0].delhi === 'yes' && r.json?.delhi === 'yes', r.status + ' ' + JSON.stringify(f1));
r = await hit('GET', '/api/feedback?a=1&k=' + sig(1));
check('opening the link again shows the answers given', r.json?.answered?.recommend === 10 && JSON.stringify(r.json?.answered?.useful) === '["exhibition"]' && r.json?.answered?.met === 'several', r.text);
r = await hit('POST', '/api/feedback', { recommend: 6, useful: ['workshops'], met: 'one', entry: 'poor', delhi: 'maybe', fix: 'More seats in the main hall' }, as(2));
check('signed in to the app, answers save without a link', r.status === 200 && q('SELECT recommend FROM feedback WHERE attendee_id = 2')[0]?.recommend === 6, r.status + ' ' + r.text);

// ---- the email and the bulk run ----
sent.length = 0;
r = await hit('POST', '/api/admin/attendees/1/send-feedback', {}, admin);
check('someone who has answered is skipped, not asked again', r.status === 200 && r.json?.skipped === true && sent.length === 0, r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/attendees/2/send-feedback');
check('the send needs Admin', r.status === 401 || r.status === 403, String(r.status));
db.run('DELETE FROM feedback WHERE attendee_id = 2');
r = await hit('POST', '/api/admin/campaigns', { kind: 'feedback', audience: 'checked_in' }, admin);
const camp = r.json;
check('the bulk run goes to everyone checked in with an email (not the absent one)', r.status === 201 && camp?.total === 4 && camp?.title === 'Feedback survey', r.status + ' ' + r.text);
for (let i = 0; i < 4; i++) { r = await hit('POST', '/api/admin/campaigns/' + camp.id + '/pump', { batch: 8 }, admin); if (r.json?.finished || !r.json?.remaining) break; }
const to = sent.map((m) => m.to).sort();
check('it emails 2, 4 and 5 and skips Asha, who answered', JSON.stringify(to) === JSON.stringify(['p2@example.com', 'p4@example.com', 'p5@example.com']), JSON.stringify(to) + ' ' + r.text);
const m2 = sent.find((m) => m.to === 'p2@example.com') || { html: '', subject: '' };
check('the email: subject, first name, eleven numbers that carry his signature, and the button', m2.subject === 'Two minutes: how was Bharat AI Innovation 2026?' && /Hi <strong>Ravi<\/strong>/.test(m2.html)
  && (m2.html.match(new RegExp('/feedback\\?a=2&amp;k=' + sig(2) + '&amp;r=\\d+|/feedback\\?a=2&k=' + sig(2) + '&r=\\d+', 'g')) || []).length === 11 && /Answer the six questions/.test(m2.html), m2.html.slice(0, 400));
check("no one else's signature is in his email", !m2.html.includes(sig(1)) && !m2.html.includes(sig(4)), '');
r = await hit('GET', '/api/admin/feedback/preview', undefined, admin);
check('the preview links open the page in preview, with no signature', r.status === 200 && /feedback\?preview=1&(amp;)?r=0/.test(r.json?.html || '') && !/k=[0-9a-f]{32}/.test(r.json?.html || ''), (r.json?.html || '').slice(0, 300));
sent.length = 0;
r = await hit('POST', '/api/admin/feedback/test', { to: 'me@example.com' }, admin);
check('a test goes to the address typed, marked [Test], with preview links', r.status === 200 && sent.length === 1 && sent[0].to === 'me@example.com' && sent[0].subject.startsWith('[Test] ') && /preview=1/.test(sent[0].html), r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/feedback/test', { to: 'not an email' }, admin);
check('a test to a non-address is refused in words', r.status === 400, r.status + ' ' + r.text);

// ---- Admin summary and CSV ----
await hit('POST', '/api/feedback', { a: 2, k: sig(2), recommend: 6, delhi: 'maybe', fix: 'More seats in the main hall' });
await hit('POST', '/api/feedback', { a: 4, k: sig(4), recommend: 8, delhi: 'no' });
r = await hit('GET', '/api/admin/feedback/summary', undefined, admin);
const s = r.json || {};
check('summary: 3 answered of 4 checked in; score (1 promoter - 1 detractor) / 3 = 0; average 8', r.status === 200 && s.ready === true && s.answered === 3 && s.came === 4 && s.recommend?.score === 0 && s.recommend?.average === 8 && s.recommend?.by?.[10] === 1 && s.recommend?.by?.[6] === 1 && s.recommend?.passives === 1, r.text.slice(0, 400));
check('summary: Delhi yes and maybe listed with their details; "no" is not', (s.delhi_people || []).length === 2 && s.delhi_people.some((p) => p.email === 'p1@example.com' && p.delhi === 'yes') && !s.delhi_people.some((p) => p.email === 'p4@example.com'), JSON.stringify(s.delhi_people));
check('summary: the comments, newest first, and the counts per answer', (s.comments || []).length === 2 && s.useful?.find((x) => x.key === 'exhibition')?.n === 1 && s.delhi?.find((x) => x.key === 'maybe')?.n === 1, JSON.stringify(s.comments) + JSON.stringify(s.useful));
r = await hit('GET', '/api/admin/feedback.csv', undefined, admin);
const csv = r.text.replace(/^\uFEFF/, '');
check('the CSV: a header and one line per answer, in words', r.status === 200 && /text\/csv/.test(r.headers.get('content-type') || '') && csv.split('\r\n').length === 4 && csv.startsWith('Answered (India time),Name,Email') && /More seats in the main hall/.test(csv) && /The exhibition/.test(csv), csv.slice(0, 300));
check('the CSV: an answer that looks like a formula is kept as text', csv.includes(`"'=HYPERLINK(""http://x"",""y"")"`), csv.split('\r\n').find((l) => l.includes('HYPERLINK')) || '');
r = await hit('GET', '/api/admin/feedback.csv');
check('the CSV needs Admin', r.status === 401 || r.status === 403, String(r.status));

// ---- exhibitor results ----
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number, attendee_id) VALUES (10, 1, 'Acme AI', 'spoc@acme.example', 'B12', 4), (11, 1, 'Beta Labs', '', 'C3', NULL), (12, 1, 'Gamma Ltd', 'hello@gamma.example', 'D1', NULL)");
db.run("INSERT INTO exhibitor_team_settings (exhibitor_id, contact_name) VALUES (10, 'Kiran Mehta')");
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, email, attendee_id) VALUES (1, 10, 'Team', 'p5@example.com', 5)");
db.run("INSERT INTO exhibitor_leads (event_id, exhibitor_id, attendee_id, rating) VALUES (1, 10, 1, 'hot'), (1, 10, 2, 'warm'), (1, 10, 3, '')");
db.run('INSERT INTO booth_visits (exhibitor_id, attendee_id, event_id) VALUES (10, 1, 1), (10, 1, 1), (10, 2, 1)');
db.run("INSERT INTO meetings (event_id, requester_id, requestee_id, title, meeting_time, status) VALUES (1, 4, 1, 'a', '2026-11-20T10:00', 'accepted'), (1, 2, 5, 'b', '2026-11-20T11:00', 'accepted'), (1, 4, 2, 'c', '2026-11-20T12:00', 'pending'), (1, 4, 5, 'd', '2026-11-20T13:00', 'accepted')");
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (7, 'Acme AI', 'spoc@acme.example', 'x', 10)");
r = await hit('GET', '/api/admin/exhibitor-results', undefined, admin);
const acme = (r.json?.results || []).find((x) => x.id === 10) || {};
check('Acme: 3 badges scanned (1 hot, 1 warm), 3 team meetings accepted (a meeting inside the team counts once), 2 people visited in the app', acme.scanned === 3 && acme.hot === 1 && acme.warm === 1 && acme.cold === 0 && acme.meetings === 3 && acme.visits === 2 && acme.contact_name === 'Kiran Mehta' && acme.sent_count === 0, JSON.stringify(acme));
check('three exhibitors, by name', (r.json?.results || []).map((x) => x.company).join('|') === 'Acme AI|Beta Labs|Gamma Ltd', r.text.slice(0, 300));
r = await hit('GET', '/api/admin/exhibitor-results/10/preview', undefined, admin);
check('the preview: Dear Kiran, the numbers, the leads and Delhi, and no mobile number', r.status === 200 && r.json?.to === 'spoc@acme.example' && /Dear <strong>Kiran<\/strong>/.test(r.json?.html) && /badges your team scanned/.test(r.json?.html) && /1 hot &middot; 1 warm/.test(r.json?.html) && /See my leads/.test(r.json?.html) && /\/delhi-exhibit/.test(r.json?.html) && !/98300/.test(r.json?.html) && !/\/marketplace\/signin/.test(r.json?.html), (r.json?.html || '').slice(0, 300));
sent.length = 0;
r = await hit('POST', '/api/admin/exhibitor-results/10/send', {}, admin);
const em = sent[0] || { html: '' };
const signin = (em.html.match(/https:\/\/bharataiinnovation\.com\/marketplace\/signin\?t=[^"&]+&(amp;)?go=leads/) || [])[0] || '';
check('sending: one email to the booth contact, subject with the company, a signed link to Leads', r.status === 200 && sent.length === 1 && em.to === 'spoc@acme.example' && em.subject === 'Your results from Bharat AI Innovation 2026: Acme AI' && !!signin, r.status + ' ' + r.text + ' ' + em.html.slice(0, 200));
check('it is recorded in the audit log', q("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'exhibitor_results.sent' AND entity = 'exhibitor' AND entity_id = '10'")[0].n === 1, '');
r = await hit('GET', signin.replace('https://bharataiinnovation.com', '').replace('&amp;', '&'));
check('the link signs the contact in and lands on the dashboard Leads', r.status === 302 && r.headers.get('location') === '/marketplace/dashboard#leads' && /mp_session|bai_mp|=/.test(r.headers.get('set-cookie') || ''), r.status + ' ' + r.headers.get('location'));
r = await hit('POST', '/api/admin/exhibitor-results/10/send', {}, admin);
check('a second send without "again" is refused, in words', r.status === 409 && r.json?.already === true && /Already sent on/.test(r.json?.error || '') && sent.length === 1, r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/exhibitor-results/10/send', { again: true }, admin);
r = await hit('GET', '/api/admin/exhibitor-results', undefined, admin);
check('"Send again" sends once more and counts 2', sent.length === 2 && (r.json?.results || []).find((x) => x.id === 10)?.sent_count === 2, String(sent.length));
r = await hit('POST', '/api/admin/exhibitor-results/11/send', {}, admin);
check('no contact email: refused in words', r.status === 400 && /no booth contact email/.test(r.json?.error || ''), r.status + ' ' + r.text);
sent.length = 0;
await hit('POST', '/api/admin/exhibitor-results/12/send', {}, admin);
check('nothing recorded: the email says no badges were scanned and offers no leads button', /did not scan any badges/.test(sent[0]?.html || '') && !/See my leads/.test(sent[0]?.html || ''), (sent[0]?.html || '').slice(0, 200));
r = await hit('GET', '/api/admin/exhibitor-results');
check('exhibitor results need Admin', r.status === 401 || r.status === 403, String(r.status));

console.log(fails ? `\n${fails} FAILED` : '\nall after-the-event checks passed');
process.exit(fails ? 1 : 0);
