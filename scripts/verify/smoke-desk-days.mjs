// Built-worker checks of the badge desk over two days (migration 0051, 11 Nov 2026),
// on real SQLite (sql.js) with the production schema, with this process's clock moved
// to the event days:
//  - one check-in per person per day: on day two, someone admitted on day one is
//    checked in again, not "Already checked in", and both days are counted;
//  - the first arrival (attendees.checked_in_at) never moves;
//  - the scanner's one call verifies and admits; a refused pass admits nobody;
//  - a scan a phone recorded without internet arrives late and keeps its own time;
//  - the list a phone saves for working offline holds no token, email or mobile.
// Run after `npm run build`:  node scripts/verify/smoke-desk-days.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

// The clock, moved before anything reads it. at('2026-11-20', '10:00') is that time in India.
const Real = Date;
let off = 0;
globalThis.Date = class extends Real {
  constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
  static now() { return Real.now() + off; }
};
const at = (day, hhmm) => { off = Real.parse(`${day}T${hhmm}:00+05:30`) - Real.now(); };
at('2026-11-20', '10:00');

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Real.now(), import.meta.url).href)).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
const MIGRATION = readFileSync(new URL('../../migrations/0051_leads_and_daily_checkins.sql', import.meta.url), 'utf8');
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
globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
const SESSION = 'smoke-session', ADMIN = 'smoke-admin';
const env = new Proxy({ ADMIN_SECRET: ADMIN, SESSION_SECRET: SESSION, DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const req = new Request('https://bharataiinnovation.com' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const desk = { Authorization: 'Bearer ' + ADMIN };
const pass = (id) => id + '.' + crypto.createHmac('sha256', SESSION).update('pass:' + id).digest('hex').slice(0, 24);
const scan = (id, extra = {}) => hit('POST', '/api/staff/scan', { token: pass(id), ...extra }, desk);
const q = (sql, ...a) => rows(sql, clean(a));
const one = (sql, ...a) => q(sql, ...a)[0] || null;
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };

db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
const person = (id, name, extra = {}) => {
  const row = { id, event_id: 1, name, email: 'p' + id + '@example.test', mobile: '98200' + String(id).padStart(5, '0'), company: 'Co ' + id, job_title: 'Director', badge_type: 'Delegate Pass', payment_status: 'paid', main_event: 1, ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Asha Both Days', { avatar_url: '/api/uploads/avatars/1.jpg' });
person(2, 'Ravi Both Days');
person(3, 'Chitra Offline');
person(4, 'Una Unpaid', { badge_type: 'VIP Pass', payment_status: 'pending' });
person(5, 'Panel Only', { main_event: 0 });
person(6, 'Before The Table');

// ---- before 0051: one check-in for the whole event, as it always was ----
let r = await scan(6);
check('before 0051: the scan call admits', r.status === 200 && r.json.state === 'ok' && !!one('SELECT checked_in_at FROM attendees WHERE id = 6').checked_in_at, r.text);
r = await scan(6);
check('before 0051: a second scan says already', r.json.state === 'already' && / IST$/.test(r.json.at_ist), r.text);
db.exec(MIGRATION); db.exec(MIGRATION);

// ---- who may call ----
r = await hit('POST', '/api/staff/scan', { token: pass(1) });
check('the scan call needs a desk sign-in', r.status === 401 && !one('SELECT checked_in_at FROM attendees WHERE id = 1').checked_in_at, r.status);
r = await hit('GET', '/api/staff/roster');
check('so does the saved list', r.status === 401, r.status);

// ---- day one, 20 Nov ----
r = await scan(1);
check('day 1: a scan admits, with what the desk must check', r.json.state === 'ok' && r.json.name === 'Asha Both Days' && r.json.pass === 'Delegate Pass' && r.json.photo === '/api/uploads/avatars/1.jpg' && r.json.undoable === true && r.json.earlier.length === 0, r.text);
check('day 1: recorded for the 20th, and as the first arrival', one('SELECT day, checked_in_by FROM checkins WHERE attendee_id = 1')?.day === '2026-11-20' && one('SELECT checked_in_at FROM attendees WHERE id = 1').checked_in_at.startsWith('2026-11-20 04:30'), q('SELECT * FROM checkins'));
check('the reply carries no email or mobile', !/example\.test|98200/.test(r.text), r.text);
r = await scan(1);
check('day 1: scanned again says already today, with the time in India and who', r.json.state === 'already' && /^20 Nov 2026, 10:00 am IST$/.test(r.json.at_ist) && r.json.by === 'admin' && q('SELECT id FROM checkins WHERE attendee_id = 1').length === 1, r.text);
r = await hit('POST', '/api/staff/scan', { token: '1.' + 'f'.repeat(24) }, desk);
check('a forged pass: not valid, nobody admitted', r.json.state === 'invalid', r.text);
r = await scan(4);
check('an unpaid tier: payment pending, not admitted', r.json.state === 'payment_pending' && !one('SELECT checked_in_at FROM attendees WHERE id = 4').checked_in_at && q('SELECT id FROM checkins WHERE attendee_id = 4').length === 0, r.text);
r = await scan(5);
check('a campus-panel registration: not registered, not admitted', r.json.state === 'panel_only' && q('SELECT id FROM checkins WHERE attendee_id = 5').length === 0, r.text);
r = await hit('POST', '/api/verify/' + pass(2) + '/checkin', {}, desk);
check('day 1: the full page still checks in', r.json.success === true && one('SELECT day FROM checkins WHERE attendee_id = 2')?.day === '2026-11-20', r.text);
r = await hit('POST', '/api/verify/' + pass(2) + '/checkin', {}, desk);
check('day 1: and says already the second time', r.json.already === true && / IST$/.test(r.json.at_ist), r.text);
r = await hit('GET', '/verify/' + pass(1), undefined, desk);
check('day 1: the page shows Already checked in and offers the undo', /Already checked in 20 Nov 2026, 10:00 am IST/.test(r.text) && /id="undo"/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 200));
r = await hit('POST', '/api/verify/' + pass(1) + '/undo', {}, desk);
check('day 1: an undo takes the day and the first-arrival stamp back', r.json.success === true && q('SELECT id FROM checkins WHERE attendee_id = 1').length === 0 && one('SELECT checked_in_at FROM attendees WHERE id = 1').checked_in_at === null, r.text);
r = await scan(1);
check('day 1: and the person can be admitted again', r.json.state === 'ok', r.text);

// ---- a scan made with no internet, sent later ----
const offlineAt = Date.now() - 40 * 60000;
at('2026-11-20', '10:30');
r = await scan(3, { at: offlineAt });
check('a scan recorded offline keeps its own time, and cannot be undone from the card', r.json.state === 'ok' && r.json.undoable === false && one('SELECT checked_in_at FROM checkins WHERE attendee_id = 3').checked_in_at.startsWith('2026-11-20 03:50'), q('SELECT * FROM checkins WHERE attendee_id = 3'));
r = await scan(3, { at: offlineAt });
check('sent twice, it is recorded once', r.json.state === 'already' && q('SELECT id FROM checkins WHERE attendee_id = 3').length === 1, r.text);

// ---- day two, 21 Nov ----
at('2026-11-21', '09:30');
r = await hit('GET', '/verify/' + pass(2), undefined, desk);
check('day 2: the page offers Check in again, and says they came on the 20th', /id="ci"/.test(r.text) && !/class="warn">Already checked in/.test(r.text) && /Also came on 20 Nov\./.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 300));
r = await scan(1);
check('day 2: someone admitted on day 1 is admitted again, not "already"', r.json.state === 'ok' && r.json.earlier.join() === '20 Nov' && q('SELECT day FROM checkins WHERE attendee_id = 1 ORDER BY day').map(x => x.day).join() === '2026-11-20,2026-11-21', r.text);
check('day 2: the first arrival has not moved', one('SELECT checked_in_at FROM attendees WHERE id = 1').checked_in_at.startsWith('2026-11-20'), '');
r = await scan(1);
check('day 2: scanned again says already today', r.json.state === 'already' && /^21 Nov 2026, 9:30 am IST$/.test(r.json.at_ist), r.text);
r = await hit('POST', '/api/verify/' + pass(2) + '/checkin', {}, desk);
check('day 2: the full page admits again too', r.json.success === true && r.json.earlier.join() === '20 Nov', r.text);
r = await scan(6);
check('day 2: someone admitted before the table existed is admitted again, their old day remembered', r.json.state === 'ok' && r.json.earlier.length === 1, r.text);
r = await hit('POST', '/api/verify/' + pass(1) + '/undo', {}, desk);
check("day 2: an undo takes back today only; yesterday's check-in and the first arrival stay", r.json.success === true && q('SELECT day FROM checkins WHERE attendee_id = 1').map(x => x.day).join() === '2026-11-20' && one('SELECT checked_in_at FROM attendees WHERE id = 1').checked_in_at.startsWith('2026-11-20'), q('SELECT * FROM checkins WHERE attendee_id = 1'));
r = await scan(1);
r = await hit('GET', '/api/admin/checkin-stats', undefined, desk);
check('the stats count each day, and each person once in the total', r.status === 200 && r.json.checkedIn === 4 && JSON.stringify(r.json.days) === JSON.stringify([{ day: '2026-11-20', n: 3 }, { day: '2026-11-21', n: 3 }]), { checkedIn: r.json.checkedIn, days: r.json.days });
check("today's quarter hours include people back for a second day", r.json.buckets.length === 1 && r.json.buckets[0].bucket === '09:30' && r.json.buckets[0].n === 3, r.json.buckets);
r = await scan(3, { at: Date.now() + 3600000 });
check('a scan claiming a time in the future is recorded as now', r.json.state === 'ok' && one("SELECT checked_in_at FROM checkins WHERE attendee_id = 3 AND day = '2026-11-21'").checked_in_at.startsWith('2026-11-21 04:00'), q('SELECT * FROM checkins WHERE attendee_id = 3'));
r = await hit('POST', '/api/admin/attendees/1/checkin-reset', {}, desk);
check('an admin reset clears every day, and is in the audit log', r.json.success === true && q('SELECT id FROM checkins WHERE attendee_id = 1').length === 0 && one('SELECT checked_in_at FROM attendees WHERE id = 1').checked_in_at === null && !!one("SELECT id FROM admin_audit WHERE action = 'attendee.checkin-reset'"), r.text);

// ---- what a phone saves to work without internet ----
r = await hit('GET', '/api/staff/roster', undefined, desk);
const P = Object.fromEntries((r.json?.people || []).map(p => [p[0], p]));
const h10 = (id) => crypto.createHash('sha256').update(pass(id)).digest('hex').slice(0, 10);
check('the saved list has everyone, with name and pass', r.status === 200 && r.json.people.length === 6 && P[1][1] === 'Asha Both Days' && P[1][2] === 'Delegate Pass' && r.json.day === '2026-11-21', r.text.slice(0, 200));
check('it marks who must not be admitted', P[1][3] === 0 && P[4][3] === 1 && P[5][3] === 2, [P[1], P[4], P[5]]);
check("each entry's hash matches that person's real pass, and only theirs", P[1][4] === h10(1) && P[2][4] === h10(2) && P[1][4] !== P[2][4], [P[1][4], h10(1)]);
check('it holds no pass token, email or mobile', !r.text.includes(pass(1)) && !r.text.includes(pass(1).split('.')[1]) && !/example\.test|98200/.test(r.text), '');

// ---- the workshop certificate (promised on the Premium Delegate and VIP passes) ----
// A seat, a check-in at the venue on the workshop's day, and the workshop over.
const { sessionCookie } = await import('./pay-db.mjs');
const cert = async (id) => (await hit('GET', '/api/attendees/' + id + '/certificate-eligibility', undefined, { Cookie: sessionCookie(SESSION, id) })).json;
db.run("INSERT INTO workshops (id, event_id, slug, title, speaker, starts_at, ends_at) VALUES (1, 1, 'cxo-guide', 'The CXO Guide to AI', 'Dr. Vinay Kulkarni', '2026-11-21 10:00', '2026-11-21 13:00')");
db.run('INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, 2, 1), (1, 5, 1)');
let w = await cert(1);
check('no workshop seat: no workshop certificate is offered', w.workshop === null, w);
w = await cert(2);
check('before the workshop ends: the certificate is named and locked, with the reason', w.workshop?.title === 'The CXO Guide to AI' && w.workshop.speaker === 'Dr. Vinay Kulkarni' && w.workshop.eligible === false && /unlocks after the workshop/.test(w.workshop.reason), w.workshop);
at('2026-11-21', '13:30');
w = await cert(2);
check('after the workshop, checked in that day: the certificate is unlocked', w.workshop.eligible === true && w.workshop.reason === '', w.workshop);
w = await cert(5);
check('a seat but never checked in at the venue: locked, and told why', w.workshop?.eligible === false && /checked in at the venue on the day of the workshop/.test(w.workshop.reason), w.workshop);
db.run("DELETE FROM checkins WHERE attendee_id = 2 AND day = '2026-11-21'");
w = await cert(2);
check('checked in on day 1 only, workshop on day 2: locked', w.workshop.eligible === false, w.workshop);
r = await hit('GET', '/api/attendees/2/certificate-eligibility');
check("nobody reads another person's certificate status", r.status === 401 || r.status === 403, r.status);

// ---- the scanner page ----
// A staff account, for the page itself.
r = await hit('GET', '/staff/scan');
check('the scanner page still needs a desk sign-in', r.status === 302, r.status);

// ---- how long a desk sign-in lasts (12 Nov 2026): once, through the event ----
const rawHit = async (method, path, body, headers = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const sc = res.headers.get('set-cookie') || '';
  const m = /bhai_staff=(\d+)\.(\d+)\.([0-9a-f]+)/.exec(sc);
  return { status: res.status, text: await res.text(), sc, exp: m ? Number(m[2]) : null, maxAge: Number((/Max-Age=(\d+)/.exec(sc) || [])[1] || 0), cookie: m ? m[0] : '', location: res.headers.get('location') || '' };
};
const nowS = () => Math.floor(Date.now() / 1000);
const near = (a, b) => Math.abs(a - b) <= 3;
const staffTok = (id, exp) => 'bhai_staff=' + id + '.' + exp + '.' + crypto.createHmac('sha256', SESSION).update('staff:' + id + '.' + exp).digest('hex');
const DAY_AFTER = Real.UTC(2026, 10, 22, 18, 29, 59) / 1000; // 22 Nov 2026, 23:59:59 in India
const login = (username) => rawHit('POST', '/api/staff/login', { username, password: 'Desk-Pass-12345' });
for (const [name, username, role] of [['Desk Nine', 'desk9', 'desk'], ['Fin One', 'fin1', 'finance']]) await hit('POST', '/api/admin/staff', { name, username, password: 'Desk-Pass-12345', role }, desk);
const deskId = q("SELECT id FROM staff WHERE username = 'desk9'")[0].id, finId = q("SELECT id FROM staff WHERE username = 'fin1'")[0].id;

at('2026-11-12', '09:00');
r = await login('desk9');
check('sign-in: a desk account signed in on 12 Nov stays signed in to the end of 22 Nov, the day after the event', r.status === 200 && r.exp === DAY_AFTER && near(r.maxAge, DAY_AFTER - nowS()) && /HttpOnly/.test(r.sc) && /Secure/.test(r.sc), r.sc);
const longCookie = r.cookie;
r = await rawHit('GET', '/staff/scan', undefined, { Cookie: longCookie });
check('sign-in: the scanner opens with it, says until when, and hands out no second one', r.status === 200 && /Signed in as Desk Nine until 22 Nov\. Point the camera/.test(r.text) && /You stay signed in until 22 Nov\./.test(r.text) && !r.sc, r.sc + ' ' + (/Signed in as[^<]*/.exec(r.text) || [''])[0]);
r = await login('fin1');
check('sign-in: a finance account still lasts three days', r.status === 200 && near(r.exp, nowS() + 3 * 86400) && near(r.maxAge, 3 * 86400), r.sc);
r = await rawHit('GET', '/staff/scan', undefined, { Cookie: staffTok(deskId, nowS() + 2 * 86400) });
check('sign-in: a desk phone on an old three-day sign-in is carried through the event when it opens the scanner', r.status === 200 && r.exp === DAY_AFTER && /until 22 Nov\./.test(r.text), r.sc);
r = await rawHit('GET', '/staff/scan', undefined, { Cookie: staffTok(finId, nowS() + 86400) });
check('sign-in: finance is sent to its own page and is not carried', r.status === 302 && /\/finance$/.test(r.location) && !r.sc, r.status + ' ' + r.location + ' ' + r.sc);
r = await rawHit('GET', '/staff/scan', undefined, { Cookie: 'bhai_staff=' + deskId + '.' + (DAY_AFTER + 300 * 86400) + '.' + longCookie.split('.')[2] });
check('sign-in: a sign-in with its date changed by hand is refused', r.status === 302 && /\/staff$/.test(r.location), r.status + ' ' + r.location);
db.run("UPDATE staff SET active = 0 WHERE username = 'desk9'");
r = await rawHit('GET', '/staff/scan', undefined, { Cookie: longCookie });
check('sign-in: switching the account off in Admin ends the long sign-in at once', r.status === 302 && /\/staff$/.test(r.location), r.status + ' ' + r.location);
db.run("UPDATE staff SET active = 1 WHERE username = 'desk9'");

at('2026-10-01', '09:00');
r = await login('desk9');
check('sign-in: more than 30 days before the event it is the usual three days', near(r.exp, nowS() + 3 * 86400), r.sc);
r = await rawHit('GET', '/staff/scan', undefined, { Cookie: staffTok(deskId, nowS() + 86400) });
check('sign-in: away from the event a sign-in is not stretched by being used', r.status === 200 && !r.sc && /Signed in as Desk Nine until 2 Oct\./.test(r.text), r.sc + ' ' + (/Signed in as[^<]*/.exec(r.text) || [''])[0]);
at('2026-11-21', '20:00');
r = await login('desk9');
check('sign-in: on the last evening it is never shorter than three days', near(r.exp, nowS() + 3 * 86400), r.sc);
at('2026-11-23', '09:00');
r = await login('desk9');
check('sign-in: after the event it is three days again', near(r.exp, nowS() + 3 * 86400), r.sc);
r = await rawHit('GET', '/staff/scan', undefined, { Cookie: longCookie });
check('sign-in: the event-long sign-in has run out by 23 Nov', r.status === 302 && /\/staff$/.test(r.location), r.status + ' ' + r.location);

// ---- the desk as an app on the home screen ----
r = await rawHit('GET', '/staff');
check('the sign-in page carries the Badge Desk app and says the phone stays signed in', r.status === 200 && /<link rel="manifest" href="\/staff\.webmanifest">/.test(r.text) && /apple-mobile-web-app-title" content="Badge Desk"/.test(r.text) && /You sign in once\. This phone then stays signed in until the event is over\./.test(r.text), '');
const man = JSON.parse(readFileSync(new URL('../../public/staff.webmanifest', import.meta.url), 'utf8'));
check('the app opens on the scanner, full screen, under its own name', man.start_url === '/staff/scan' && man.id === '/staff/scan' && man.display === 'standalone' && man.short_name === 'Badge Desk' && man.scope === '/', JSON.stringify(man).slice(0, 200));
const pngSize = (rel) => { const b = readFileSync(new URL('../../public' + rel, import.meta.url)); return b.slice(1, 4).toString() === 'PNG' ? b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) : 'not a png'; };
check('every icon it names is a picture of the size it says', man.icons.length === 3 && man.icons.every(i => pngSize(i.src) === i.sizes) && man.icons.some(i => i.purpose === 'maskable'), man.icons.map(i => i.src + ' ' + pngSize(i.src)).join(', '));
const swSrc = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
check('the offline helper keeps the scanner page only, and never a pass check or the sign-in page', /url\.pathname === '\/staff\/scan'\) \{ event\.respondWith\(deskScanner\(request\)\)/.test(swSrc) && /startsWith\('\/verify\/'\) \|\| url\.pathname\.startsWith\('\/staff'\)/.test(swSrc) && /event\.data !== 'desk-keep'/.test(swSrc), '');

console.log(fails ? `\n${fails} FAILED` : '\nAll two-day desk checks passed');
process.exit(fails ? 1 : 0);
