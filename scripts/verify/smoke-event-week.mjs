// Built-worker checks for the event-week email (16 Nov 2026), "Get ready for 20 and 21
// Nov", on real SQLite (sql.js) with the production schema and 0056 (the waiting list):
// who is in each audience and in what order, the six kinds of body, a preview that
// mints nothing and marks nothing, a send with its sign-in token, tag and open picture,
// the open and click marks, the skips, a run on the bulk pump, the minute clock moving
// it ten at a time, the sending window, the counts, and the app's click line.
// Elastic Email is stubbed; nothing is sent.
// Run after `npm run build`:  node scripts/verify/smoke-event-week.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

// Monday 16 Nov 2026, 10:30 IST: inside the 9am-9pm window, four days to go.
const RealDate = Date;
let FAKE_NOW = RealDate.parse('2026-11-16T05:00:00Z');
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [FAKE_NOW])); }
  static now() { return FAKE_NOW; }
};

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const worker = (await import(new URL('dist/_worker.js?' + RealDate.now(), ROOT).href)).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(read('scripts/verify/prod-schema.sql'));
db.exec(read('migrations/0050_exhibitor_team.sql'));
db.exec(read('migrations/0056_free_pass_waitlist.sql'));

const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { const st = db.prepare(sql); st.bind(args); const r = st.step() ? st.getAsObject() : null; st.free(); return r; },
      async all() { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return { results: out }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { for (const s of list) await s.run(); return list.map(() => ({ results: [], meta: {} })); },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', ELASTIC_EMAIL_API_KEY: 'smoke-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const type = res.headers.get('Content-Type') || '';
  const text = type.startsWith('image/') ? '' : await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, type, text, json };
};
const ADMIN = { Authorization: 'Bearer smoke-admin' };
const q = (sql, ...a) => { const st = db.prepare(sql); st.bind(clean(a)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const count = (table) => q(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const marks = (action) => q("SELECT entity_id FROM admin_audit WHERE entity = 'attendee' AND action = ? ORDER BY CAST(entity_id AS INTEGER)", action).map(r => r.entity_id).join(',');
let fails = 0, passes = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(d ?? '').slice(0, 300))); if (ok) passes++; else fails++; };

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return realFetch(url, init);
};
const to = (i) => JSON.stringify(sent[i]?.Recipients || '');
const subj = (i) => sent[i]?.Content?.Subject || '';
const body = (i) => sent[i]?.Content?.Body?.[0]?.Content || '';

// ---- seed ----
db.run("INSERT INTO events (id, title, venue, start_date, end_date, status) VALUES (1, 'Bharat AI Innovation 2026', 'World Trade Center, Mumbai', '2026-11-20', '2026-11-21', 'upcoming')");
db.run("INSERT INTO app_settings (key, value) VALUES ('app_url', 'https://bharataiinnovation.com/app')");
const person = (id, name, email, extra = {}) => {
  const row = { id, event_id: 1, name, email, mobile: '98200' + String(id).padStart(5, '0'), badge_type: 'Visitor Pass', payment_status: 'paid',
    company: 'Co ' + id, job_title: 'Head of ' + id, city: 'Mumbai', industry: 'Tech', main_event: 1, role: 'attendee', avatar_url: '/api/uploads/avatars/' + id + '.jpg', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Asha Rao', 'asha@example.com', { badge_type: 'Delegate Pass', pass_downloaded_at: '2026-11-10 10:00:00' });
person(2, 'Rohan Mehta', 'rohan@booth.example.com', { badge_type: 'Exhibitor', role: 'Exhibitor', avatar_url: '' });
person(3, 'Vikram Singh', 'vikram@example.com', { badge_type: 'Visitor Pass', social_card_downloaded_at: '2026-11-09 09:00:00' });
person(4, 'Neha Joshi', 'neha@example.com', { badge_type: 'Visitor Pass', entry_status: 'waitlisted' });
person(5, 'Farah Khan', 'farah@example.com', { badge_type: 'VIP Pass', payment_status: 'pending' });
person(6, 'Dev Patel', 'dev@example.com', { badge_type: 'Expo Pass' });
person(7, 'Team Member', 'team@example.com', { badge_type: 'Organiser' });
person(8, 'Gone Away', 'gone@example.com', { badge_type: 'Delegate Pass', unsubscribed_at: '2026-11-01 00:00:00' });
person(9, 'Campus Only', 'campus@example.com', { main_event: 0 });
person(10, 'Dr. Meera Iyer', 'meera@example.com', { badge_type: 'Speaker' });
person(11, 'WhatsApp Guest', 'wa919820000011@no-email.invalid', { badge_type: 'Delegate Pass' });
// Rohan's company, its booth and the team list that puts him at it.
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (5, 1, 'Oranje AI', 'spoc@booth.example.com', '')");
db.run("INSERT INTO booths (event_id, code, type_key, name, dim) VALUES (1, 'A12', 'innovator', 'Innovator Booth', '3m x 3m')");
const boothId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
db.run("INSERT INTO booth_allocations (event_id, booth_id, exhibitor_id, company_name, contact_name, status) VALUES (1, ?, 5, 'Oranje AI', 'SPOC', 'confirmed')", [boothId]);
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, email, attendee_id, pass) VALUES (1, 5, 'Rohan', 'Mehta', 'rohan@booth.example.com', 2, 'Exhibitor')");

// ---- who is in each audience ----
let st = await hit('GET', '/api/admin/event-week/status', undefined, ADMIN);
check('status: 4 on a paid or given pass (Delegate, Exhibitor, Expo, Speaker), 1 exhibitor, 3 on a free pass (free, waitlisted, unpaid), 7 in all; the organiser, the unsubscribed, the campus-only and the WhatsApp guest left out',
  st.status === 200 && st.json.left?.passes === 4 && st.json.left?.exhibitors === 1 && st.json.left?.free === 3 && st.json.left?.all === 7, JSON.stringify(st.json?.left));
check('status: one of each kind, two paid, and "4 days to go"', st.json.kinds?.exhibitor === 1 && st.json.kinds?.paid === 2 && st.json.kinds?.expo === 1 && st.json.kinds?.free === 1 && st.json.kinds?.waitlisted === 1 && st.json.kinds?.unpaid === 1 && st.json.days === '4 days to go', JSON.stringify(st.json?.kinds) + ' ' + st.json?.days);
check('status: no open run, nothing sent yet', st.json.open_run === null && st.json.stats?.sent === 0, JSON.stringify(st.json?.stats));
check('without admin the status is refused', (await hit('GET', '/api/admin/event-week/status')).status === 401, '');

// ---- the preview: every kind, and it mints and marks nothing ----
const before = { sent: sent.length, audit: count('admin_audit'), tokens: count('login_tokens'), camps: count('campaigns') };
let pv = await hit('GET', '/api/admin/event-week/preview?audience=passes', undefined, ADMIN);
check('preview (paid passes and exhibitors): 4 people, the exhibitor shown first', pv.status === 200 && pv.json.counts?.total === 4 && pv.json.kind === 'exhibitor' && pv.json.sample?.id === 2, JSON.stringify(pv.json?.counts) + ' ' + pv.json?.kind);
check('exhibitor: the booth number and company, the exhibitor dashboard, Booth Leads, and the subject about the booth',
  pv.json.html.includes('Booth A12') && pv.json.html.includes('Oranje AI') && pv.json.html.includes('/marketplace/dashboard') && pv.json.html.includes('action=leads') && /^Rohan, your booth, your team and your meetings/.test(pv.json.subject), pv.json.subject);
check('exhibitor: the photo step is open (no photo), the pass step is open, meetings may be booked', pv.json.html.includes('Add your photo') && pv.json.html.includes('Put your pass on your phone') && pv.json.html.includes('Book meetings with the people you want to meet') && pv.json.html.includes('action=network'), '');
check('the preview has no sign-in token, no ew= tag and no open picture', !/[?&]token=/.test(pv.json.html) && !/[?&]ew=/.test(pv.json.html) && !pv.json.html.includes('eventweek-open'), '');
check('the preview carries the unsubscribe footer and not the foot-of-email app block (the step is marked)', /unsubscribe/i.test(pv.json.html) && !pv.json.html.includes('Save the Bharat AI app on your phone') && pv.json.html.includes('Save the app on your phone'), '');
pv = await hit('GET', '/api/admin/event-week/preview?audience=passes&kind=paid', undefined, ADMIN);
check('paid (Delegate): pass and photo ticked, badge step open, "Star the sessions", the full subject', pv.json.sample?.id === 1 && pv.json.html.includes('Your pass is on your phone') && pv.json.html.includes('Your photo and details are in') && pv.json.html.includes('Make my badge') && pv.json.html.includes('Star the sessions you want') && pv.json.subject === 'Asha, get ready for 20 and 21 Nov: your pass, your badge and your meetings', pv.json.subject);
pv = await hit('GET', '/api/admin/event-week/preview?audience=passes&kind=expo', undefined, ADMIN);
check('Expo Pass: may book meetings, no sessions step', pv.json.sample?.id === 6 && pv.json.html.includes('Book meetings with the people') && !pv.json.html.includes('Star the sessions'), '');
pv = await hit('GET', '/api/admin/event-week/preview?audience=free&kind=free', undefined, ADMIN);
check('free: "Say yes when someone asks to meet you", the Expo Pass line, the badge step ticked (shared already), the Free Visitor Pass named, no booking step', pv.json.sample?.id === 3 && pv.json.html.includes('Say yes when someone asks to meet you') && pv.json.html.includes('get the Expo Pass') && pv.json.html.includes('Your badge is out there') && pv.json.html.includes('Free Visitor Pass') && !pv.json.html.includes('Book meetings with the people'), '');
pv = await hit('GET', '/api/admin/event-week/preview?audience=free&kind=waitlisted', undefined, ADMIN);
check('waitlisted: "Get your pass before you come", no download-pass button, the pass button goes to pay', pv.json.sample?.id === 4 && pv.json.html.includes('Get your pass before you come') && !pv.json.html.includes('action=download-pass') && pv.json.html.includes('action=pay') && /get your pass before you come/.test(pv.json.subject), pv.json.subject);
pv = await hit('GET', '/api/admin/event-week/preview?audience=free&kind=unpaid', undefined, ADMIN);
check('unpaid VIP: "Finish paying for your VIP Pass" with pass=vip', pv.json.sample?.id === 5 && pv.json.html.includes('Finish paying for your VIP Pass') && pv.json.html.includes('pass=vip') && /finish paying for your VIP Pass/.test(pv.json.subject), pv.json.subject);
pv = await hit('GET', '/api/admin/event-week/preview?audience=exhibitors&kind=free', undefined, ADMIN);
check('a kind nobody in the audience holds: no sample, the counts still there', pv.status === 200 && pv.json.sample === null && pv.json.counts?.total === 1, JSON.stringify(pv.json));
check('seven previews sent nothing, minted no token, wrote no mark and made no run',
  sent.length === before.sent && count('admin_audit') === before.audit && count('login_tokens') === before.tokens && count('campaigns') === before.camps, '');

// ---- one send by hand ----
let r = await hit('POST', '/api/admin/attendees/1/send-event-week', {}, ADMIN);
check('a send: one email to Asha, kind paid', r.status === 200 && r.json.success && r.json.kind === 'paid' && sent.length === 1 && to(0).includes('asha@example.com'), r.status + ' ' + JSON.stringify(r.json));
const links = [...body(0).matchAll(/href="(https:\/\/bharataiinnovation\.com\/app\?[^"]+)"/g)].map(m => m[1]);
const sig = (body(0).match(/ew=1\.([0-9a-f]+)/) || [])[1] || '';
check('every app button carries ew=1.<sig> and a sign-in token; one token for the whole email', links.length >= 4 && sig && links.every(h => h.includes('ew=1.' + sig) && /[?&](amp;)?token=[0-9a-f]+/.test(h)) && count('login_tokens') === before.tokens + 1, links.length + ' ' + (links[0] || ''));
check('the open picture and the app-on-phone mark; the marks clock started', body(0).includes('/api/eventweek-open?a=1&amp;s=' + sig) && body(0).includes('data-app-on-phone') && q("SELECT value FROM app_settings WHERE key = 'eventweek_marks_from'").length === 1, '');
check('the sent email has the unsubscribe footer and the badge-desk line', /unsubscribe/i.test(body(0)) && body(0).includes('8:30 am on Friday 20 Nov'), '');

// ---- opens and clicks ----
await hit('GET', '/api/eventweek-open?a=1&s=' + sig);
await hit('GET', '/api/eventweek-open?a=1&s=deadbeef');
await hit('POST', '/api/eventweek-click', { a: 1, s: sig });
await hit('POST', '/api/eventweek-click', { a: 2, s: sig });
check('the picture with the right signature marks an open; a wrong one does not; the click marks a click, only for the id it was signed for',
  marks('eventweek.open') === '1' && marks('eventweek.click') === '1', marks('eventweek.open') + ' / ' + marks('eventweek.click'));
await hit('GET', '/api/eventweek-open?a=1&s=' + sig);
check('a second open is not a second mark', q("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'eventweek.open'")[0].n === 1, '');

// ---- the skips ----
for (const [id, why] of [[7, 'On the organising team'], [8, 'Unsubscribed'], [9, 'Campus panel only']]) {
  r = await hit('POST', `/api/admin/attendees/${id}/send-event-week`, {}, ADMIN);
  check(`skipped, not sent: ${why}`, r.status === 200 && r.json.skipped && String(r.json.reason).startsWith(why) && sent.length === 1, JSON.stringify(r.json));
}

// ---- a run on the bulk pump ----
r = await hit('POST', '/api/admin/campaigns', { kind: 'event_week', audience: 'passes' }, ADMIN);
check('a run for paid passes and exhibitors: 4 people, titled', r.status === 201 && r.json.total === 4 && /Get ready for 20 and 21 Nov/.test(r.json.title), r.status + ' ' + JSON.stringify(r.json));
const camp = r.json.id;
const order = q('SELECT attendee_id FROM campaign_recipients WHERE campaign_id = ? ORDER BY id', camp).map(x => x.attendee_id).join(',');
check('its order: the exhibitor, then the paid passes, then the Expo Pass', order === '2,1,10,6', order);
r = await hit('POST', `/api/admin/campaigns/${camp}/pump`, { batch: 8 }, ADMIN);
check('one pump of 8 sends all 4 at once: no send gap for this email', r.status === 200 && r.json.sent === 4 && r.json.remaining === 0 && sent.length === 5, JSON.stringify(r.json));
check('the exhibitor\u2019s email went to him with his booth; the Speaker got the paid version, greeted Dr. Meera (the organiser, 23 Nov 2026)', to(1).includes('rohan@booth') && body(1).includes('Booth A12') && to(3).includes('meera@') && /^Dr. Meera, get ready/.test(subj(3)), subj(1) + ' | ' + subj(3));
st = await hit('GET', '/api/admin/event-week/status', undefined, ADMIN);
check('after the run nobody on a paid pass is left; the free audience is untouched', st.json.left?.passes === 0 && st.json.left?.free === 3 && st.json.open_run === null, JSON.stringify(st.json?.left));
r = await hit('POST', '/api/admin/campaigns', { kind: 'event_week', audience: 'passes' }, ADMIN);
check('a second run for the same audience has nobody to send to', r.status === 400, r.status + ' ' + JSON.stringify(r.json));
pv = await hit('GET', `/api/admin/event-week/preview?campaign=${camp}`, undefined, ADMIN);
check('the preview of a finished run shows who was on it', pv.status === 200 && pv.json.counts?.total === 4 && pv.json.counts?.exhibitor === 1, JSON.stringify(pv.json?.counts));

// ---- the minute clock moves the free run ten at a time ----
r = await hit('POST', '/api/admin/campaigns', { kind: 'event_week', audience: 'free' }, ADMIN);
const free = r.json.id;
check('a run for the free passes: 3 people (free, waitlisted, unpaid)', r.status === 201 && r.json.total === 3, JSON.stringify(r.json));
const t = await hit('POST', '/api/cron/tick', {}, ADMIN);
const mine = (t.json?.campaigns || []).find(x => x.id === free);
check('one tick of the clock sends all 3 (batch 10, not 1)', t.status === 200 && mine && mine.sent === 3 && mine.remaining === 0 && sent.length === 8, JSON.stringify(t.json?.campaigns || t.json));
const lastThree = [5, 6, 7].map(i => subj(i)).join(' | ');
check('Neha (waiting list) was told to get a pass; Farah to finish paying; Vikram to say yes', lastThree.includes('get your pass before you come') && lastThree.includes('finish paying for your VIP Pass') && [5, 6, 7].map(i => body(i)).join('').includes('Say yes when someone asks'), lastThree);

// ---- what came of it ----
db.run("UPDATE attendees SET pass_downloaded_at = '2026-11-16 12:00:00', social_card_downloaded_at = '2026-11-16 12:05:00' WHERE id = 2");
db.run("INSERT INTO connections (event_id, from_attendee_id, to_attendee_id, status, created_at) VALUES (1, 6, 1, 'pending', '2026-11-16 13:00:00')");
const sig2 = (body(1).match(/ew=2\.([0-9a-f]+)/) || [])[1] || '';
await hit('GET', '/api/eventweek-open?a=2&s=' + sig2);
st = await hit('GET', '/api/admin/event-week/status', undefined, ADMIN);
check('the counts: 7 sent by runs, 2 opened (Asha, sent by hand then on the run, and Rohan), 1 downloaded the pass after, 1 made the badge after, 1 asked to connect after',
  st.json.stats?.sent === 7 && st.json.stats?.opened === 2 && st.json.stats?.pass_after === 1 && st.json.stats?.shared_after === 1 && st.json.stats?.asked === 1, JSON.stringify(st.json?.stats));

// ---- outside the window ----
FAKE_NOW = RealDate.parse('2026-11-16T17:00:00Z'); // 10:30 pm IST
db.run("UPDATE attendees SET unsubscribed_at = NULL WHERE id = 8");
r = await hit('POST', '/api/admin/attendees/8/send-event-week', {}, ADMIN);
check('outside 9am-9pm IST the send waits (409 paused), nothing goes', r.status === 409 && r.json.paused && sent.length === 8, r.status + ' ' + JSON.stringify(r.json));
r = await hit('POST', '/api/admin/attendees/8/send-event-week?force=1', {}, ADMIN);
check('force=1 sends it anyway', r.status === 200 && sent.length === 9, r.status);

// ---- the pages ----
const appJs = (await hit('GET', '/app.js')).text;
check('/app.js counts a click from the email (ew= to /api/eventweek-click)', appJs.includes("urlParams.get('ew')") && appJs.includes('/api/eventweek-click'), '');
const adminHtml = (await hit('GET', '/admin', undefined, ADMIN)).text;
check('/admin loads event-week.js and talk-brief.js before /admin.js', adminHtml.indexOf('/static/event-week.js') > 0 && adminHtml.indexOf('/static/talk-brief.js') > 0 && adminHtml.indexOf('/static/event-week.js') < adminHtml.indexOf('/admin.js?v='), '');
for (const f of ['public/static/event-week.js', 'public/static/talk-brief.js']) {
  let ok = true; try { new vm.Script(read(f), { filename: f }); } catch (e) { ok = false; }
  check(`${f} parses`, ok, '');
}
const adminJs = (await hit('GET', '/admin.js', undefined, ADMIN)).text;
check('/admin.js draws the strip under the networking email and offers "Time & hall briefs" on the Innovation Talks tab', adminJs.includes('id="eventweek-strip"') && adminJs.indexOf('id="netmail-strip"') < adminJs.indexOf('id="eventweek-strip"') && adminJs.includes('TalkBrief.openList()'), '');

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
