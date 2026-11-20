// Built-worker checks for the entry times of the Free Visitor Pass (17 Nov 2026), on real
// SQLite (sql.js) with the production schema and 0056 (the waiting list): who gets which
// entry time (Friday morning for the keen local ones and their colleagues, either day for
// those far away, the rest shared evenly), that paid passes, the waiting list and an entry
// time already given are left alone, the preview that mints nothing, the run on the bulk
// pump (Friday morning first, no send gap, the clock ten a minute), the skips, the waiting
// list let in with "a place has opened up", the badge desk's on-time and not-their-time
// cards, the app's pass card line, and the event-week email's weekday.
// Elastic Email is stubbed; nothing is sent.
// Run after `npm run build`:  node scripts/verify/smoke-entry-slots.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

// Tuesday 17 Nov 2026, 19:30 IST: inside the 9am-9pm window.
const RealDate = Date;
let FAKE_NOW = RealDate.parse('2026-11-17T14:00:00Z');
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
  async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', ELASTIC_EMAIL_API_KEY: 'smoke-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (method, path, body, headers = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const ADMIN = { Authorization: 'Bearer smoke-admin' };
const q = (sql, ...a) => { const st = db.prepare(sql); st.bind(clean(a)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const count = (table) => q(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const slotOf = (id) => q('SELECT entry_slot FROM attendees WHERE id = ?', id)[0]?.entry_slot ?? null;
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

const FRI_AM = 'Friday 20 Nov, 8:30 am to 1 pm', FRI_PM = 'Friday 20 Nov, 1 pm to 5 pm', SAT_AM = 'Saturday 21 Nov, 8:30 am to 1 pm', SAT_PM = 'Saturday 21 Nov, 1 pm to 5 pm';
const ANY = 'Friday 20 or Saturday 21 Nov, any time from 8:30 am';

// ---- seed ----
db.run("INSERT INTO events (id, title, venue, start_date, end_date, status) VALUES (1, 'Bharat AI Innovation 2026', 'World Trade Center, Mumbai', '2026-11-20', '2026-11-21', 'upcoming')");
db.run("INSERT INTO app_settings (key, value) VALUES ('app_url', 'https://bharataiinnovation.com/app')");
const person = (id, name, email, extra = {}) => {
  const row = { id, event_id: 1, name, email, mobile: '98200' + String(id).padStart(5, '0'), badge_type: 'Visitor Pass', payment_status: 'paid',
    company: 'Solo Co ' + id, job_title: 'Analyst', city: 'Mumbai', industry: 'Tech', main_event: 1, role: 'attendee', avatar_url: '/api/uploads/avatars/' + id + '.jpg', ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Asha Rao', 'asha@example.com', { rsvp_status: 'confirmed' });                                   // keen, Mumbai -> Fri am
person(2, 'Ravi Kumar', 'ravi@example.com', { pass_downloaded_at: '2026-11-10 10:00:00', city: 'Thane' });   // pass saved, Thane -> Fri am
person(3, 'Colleague One', 'c1@example.com', { company: 'Oranje AI Pvt Ltd', rsvp_status: 'confirmed' });   // keen
person(4, 'Colleague Two', 'c2@example.com', { company: 'ORANJE AI', avatar_url: '' });                    // colleague of 3 -> Fri am
person(5, 'Far Away', 'far@example.com', { city: 'Bengaluru', rsvp_status: 'confirmed' });                 // outside -> any
person(6, 'Pune Person', 'pune@example.com', { city: 'Pune' });                                            // outside -> any
for (let i = 7; i <= 15; i++) person(i, 'Quiet ' + i, 'quiet' + i + '@example.com', { city: i % 2 ? 'Mumbai' : '', rsvp_status: i === 7 ? 'declined' : i === 8 ? 'maybe' : null });
person(16, 'College A1', 'a1@example.com', { company: 'Sardar Patel College' });                           // a group of 3, none keen
person(17, 'College A2', 'a2@example.com', { company: 'sardar patel college' });
person(18, 'College A3', 'a3@example.com', { company: 'Sardar Patel College.' });
person(20, 'Paid Delegate', 'paid@example.com', { badge_type: 'Delegate Pass', rsvp_status: 'confirmed' });
person(21, 'Unpaid VIP', 'unpaid@example.com', { badge_type: 'VIP Pass', payment_status: 'pending' });      // counts as free
person(22, 'Waiting Mumbai', 'wait1@example.com', { entry_status: 'waitlisted' });
person(23, 'Waiting Delhi', 'wait2@example.com', { entry_status: 'waitlisted', city: 'New Delhi' });
person(24, 'Already Told', 'told@example.com', { entry_slot: 'Day 2, 2 pm to 6 pm' });
person(25, 'Gone Away', 'gone@example.com', { unsubscribed_at: '2026-11-01 00:00:00' });
person(26, 'No Marketing', 'nomkt@example.com', { marketing_consent: 0 });
person(27, 'Campus Only', 'campus@example.com', { main_event: 0 });
person(28, 'Team Member', 'team@example.com', { badge_type: 'Organiser' });
person(29, 'WhatsApp Guest', 'wa919820000029@no-email.invalid');
person(30, 'Exhibitor', 'ex@example.com', { badge_type: 'Exhibitor', payment_status: 'waived' });
person(31, 'Exhibitor Guest', 'xguest@example.com', { registration_source: 'exhibitor:7', rsvp_status: 'confirmed' }); // given by an exhibitor: no entry time

// ---- the plan before anything is written ----
let st = await hit('GET', '/api/admin/entry-slots/status', undefined, ADMIN);
const by = (k) => (st.json?.slots || []).find(s => s.key === k) || {};
check('without admin the status is refused', (await hit('GET', '/api/admin/entry-slots/status')).status === 401, '');
check('status: 22 free holders without an entry time (campus-only, organiser, paid passes, the waiting list and the one already told left out); 2 on the waiting list',
  st.status === 200 && st.json.without === 22 && st.json.waiting === 2 && st.json.other === 1, JSON.stringify(st.json));
check('plan: Friday morning 4 (keen + pass saved + a colleague), either day 2 (Bengaluru, Pune)', by('fri-am').planned === 4 && by('any').planned === 2, JSON.stringify(st.json.slots));
check('plan: the other 16 shared evenly over three half-days (6/5/5 or so), the college of three kept together',
  [by('fri-pm').planned, by('sat-am').planned, by('sat-pm').planned].every(n => n >= 5 && n <= 6) && by('fri-pm').planned + by('sat-am').planned + by('sat-pm').planned === 16, JSON.stringify(st.json.slots));
check('plan: the waiting list, Mumbai and Delhi alike, to either day (the organiser, 19 Nov)', by('sat-am').waitlist === 0 && by('any').waitlist === 2, JSON.stringify(st.json.slots));
check('nothing written by the status', q("SELECT COUNT(*) AS n FROM attendees WHERE entry_slot IS NOT NULL")[0].n === 1, '');

// ---- the email can be read BEFORE the entry times are given (the organiser, 17 Nov 23:30:
// "show preview of email"): the sample's time comes from the plan, in memory only ----
let early = await hit('GET', '/api/admin/entry-slots/preview', undefined, ADMIN);
check('early preview: only the hand-told one to send, the plan counted per entry time, Friday morning shown first as Asha would get it',
  early.status === 200 && early.json.counts?.total === 1 && early.json.planned?.['fri-am'] === 4 && early.json.planned?.any === 2 && early.json.planned?.waitlist === 2 && early.json.slot === 'fri-am' && early.json.sample?.planned === true && early.json.sample?.name === 'Asha Rao',
  JSON.stringify({ counts: early.json?.counts, planned: early.json?.planned, slot: early.json?.slot, sample: early.json?.sample }));
check('early preview: the subject and the big entry time read Friday 20 Nov, 8:30 am to 1 pm', /^Asha, your entry time for Bharat AI Innovation: Friday 20 Nov, 8:30 am to 1 pm$/.test(early.json.subject) && early.json.html.includes(FRI_AM), early.json.subject);
early = await hit('GET', '/api/admin/entry-slots/preview?slot=waitlist', undefined, ADMIN);
check('early preview (waiting list): the "good news" version with either day, as the Mumbai one on the list would get it',
  early.json.slot === 'waitlist' && /good news: your Free Visitor Pass is confirmed for Friday 20 or Saturday 21 Nov, any time from 8:30 am$/.test(early.json.subject) && early.json.sample?.name === 'Waiting Mumbai' && early.json.html.includes('a place has opened up'), early.json.subject);
check('early previews wrote nothing', q("SELECT COUNT(*) AS n FROM attendees WHERE entry_slot IS NOT NULL")[0].n === 1 && q("SELECT entry_status FROM attendees WHERE id = 22")[0].entry_status === 'waitlisted' && count('login_tokens') === 0, '');

// ---- give the entry times ----
let r = await hit('POST', '/api/admin/entry-slots/assign', {}, ADMIN);
check('assign: 22 entry times given', r.status === 200 && r.json.assigned === 22, JSON.stringify(r.json));
check('keen Mumbai, pass-saved Thane and the colleague of a keen one: Friday morning', slotOf(1) === FRI_AM && slotOf(2) === FRI_AM && slotOf(3) === FRI_AM && slotOf(4) === FRI_AM, [slotOf(1), slotOf(2), slotOf(3), slotOf(4)].join(' | '));
check('Bengaluru and Pune: either day, any time', slotOf(5) === ANY && slotOf(6) === ANY, slotOf(5) + ' | ' + slotOf(6));
check('the college of three: one half-day for all', slotOf(16) && slotOf(16) === slotOf(17) && slotOf(17) === slotOf(18) && [FRI_PM, SAT_AM, SAT_PM].includes(slotOf(16)), [slotOf(16), slotOf(17), slotOf(18)].join(' | '));
check('declined and maybe still get one (everybody gets a chance)', [FRI_PM, SAT_AM, SAT_PM].includes(slotOf(7)) && [FRI_PM, SAT_AM, SAT_PM].includes(slotOf(8)), slotOf(7) + ' | ' + slotOf(8));
check('an unpaid VIP (a free pass for now) gets one; the unsubscribed and the no-marketing ones too', !!slotOf(21) && !!slotOf(25) && !!slotOf(26), '');
check('left alone: the paid Delegate, the exhibitor, the organiser, campus-only, the waiting list, and the entry time already told',
  slotOf(20) === null && slotOf(30) === null && slotOf(28) === null && slotOf(27) === null && slotOf(22) === null && slotOf(23) === null && slotOf(24) === 'Day 2, 2 pm to 6 pm', '');
check('an exhibitor\'s guest (a Visitor Pass from the exhibitor\'s dashboard) gets no entry time and is not counted', slotOf(31) === null, String(slotOf(31)));
check('assign wrote an audit row', q("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'entry_slots.assign'")[0].n === 1, '');
r = await hit('POST', '/api/admin/entry-slots/assign', {}, ADMIN);
check('assign again: nothing left to give, nobody moved', r.json.assigned === 0 && slotOf(1) === FRI_AM, JSON.stringify(r.json));

// ---- the preview ----
const before = { sent: sent.length, tokens: count('login_tokens'), camps: count('campaigns') };
let pv = await hit('GET', '/api/admin/entry-slots/preview', undefined, ADMIN);
check('preview: 21 to send (the unsubscribed, the WhatsApp guest left out; the no-marketing one in; the one told by hand in), Friday morning first',
  pv.status === 200 && pv.json.counts?.total === 21 && pv.json.slot === 'fri-am' && pv.json.counts['fri-am'] === 4, JSON.stringify(pv.json?.counts) + ' ' + pv.json?.slot);
check('preview: the entry time in big letters, Friday 20 Nov, the 9:30 am opening, the Free Visitor Pass named, ID and no on-spot registration',
  pv.json.html.includes(FRI_AM) && pv.json.html.includes('9:30 am') && pv.json.html.includes('Free Visitor Pass') && pv.json.html.includes('government photo ID') && pv.json.html.includes('no on-spot registration'), '');
check('preview: the subject names the entry time', /^Asha, your entry time for Bharat AI Innovation: Friday 20 Nov, 8:30 am to 1 pm$/.test(pv.json.subject), pv.json.subject);
check('preview: no Expo Pass offer (the organiser: it did not look good), the download button, no sign-in token, the Are you coming buttons not live', !pv.json.html.includes('Expo Pass') && pv.json.html.includes('action=download-pass') && !/[?&]token=/.test(pv.json.html) && pv.json.html.includes('Are you coming at this time?') && !pv.json.html.includes('/api/rsvp?'), '');
pv = await hit('GET', '/api/admin/entry-slots/preview?slot=any', undefined, ADMIN);
check('preview (either day): "Come on either day", the traveller line', pv.json.slot === 'any' && pv.json.html.includes(ANY) && pv.json.html.includes('Come on either day'), pv.json.slot);
pv = await hit('GET', '/api/admin/entry-slots/preview?slot=sat-am', undefined, ADMIN);
check('preview (Saturday morning): the 9 am line', pv.json.slot === 'sat-am' ? pv.json.html.includes('The day opens at <strong>9 am</strong>') : true, pv.json.slot);
pv = await hit('GET', '/api/admin/entry-slots/preview?slot=fri-am', undefined, ADMIN);
const noPhoto = await hit('GET', '/api/admin/entry-slots/preview?slot=fri-pm', undefined, ADMIN);
check('four previews sent nothing, minted no token and made no run', sent.length === before.sent && count('login_tokens') === before.tokens && count('campaigns') === before.camps, '');

// ---- the run ----
r = await hit('POST', '/api/admin/campaigns', { kind: 'entry_slot', audience: 'all' }, ADMIN);
const camp = r.json?.id;
check('a run of kind entry_slot: 21 people, titled', r.status === 201 && r.json.total === 21 && r.json.title === 'Free Visitor Pass: your entry time', JSON.stringify(r.json));
const order = q('SELECT attendee_id FROM campaign_recipients WHERE campaign_id = ? ORDER BY id', camp).map(x => x.attendee_id);
check('Friday morning first, then either day', order.slice(0, 4).sort((a, b) => a - b).join(',') === '1,2,3,4' && order.slice(4, 6).sort((a, b) => a - b).join(',') === '5,6', order.join(','));
r = await hit('POST', `/api/admin/campaigns/${camp}/pump`, { batch: 8 }, ADMIN);
check('one pump of 8 sends 8: no send gap', r.status === 200 && r.json.sent === 8 && sent.length === 8, JSON.stringify(r.json));
check('the first email: to Asha, the subject with her entry time, a sign-in token on the button', to(0).includes('asha@example.com') && subj(0).includes(FRI_AM) && /action=download-pass[^"]*token=/.test(body(0)), subj(0));
check('the sent email carries the unsubscribe footer', /unsubscribe/i.test(body(0)), '');
// "Are you coming?" (the organiser: most yeses are from October). Two signed one-tap links.
const yesLink = (body(0).match(/href="(https:\/\/bharataiinnovation\.com\/api\/rsvp\?[^"]*status=confirmed[^"]*)"/) || [])[1] || '';
const noLink = (body(0).match(/href="(https:\/\/bharataiinnovation\.com\/api\/rsvp\?[^"]*status=declined[^"]*)"/) || [])[1] || '';
check('the email asks "Are you coming at this time?" with signed Yes and Can\'t links', body(0).includes('Are you coming at this time?') && /sig=[0-9a-f]{32}/.test(yesLink) && /sig=[0-9a-f]{32}/.test(noLink), yesLink);
r = await hit('GET', yesLink.replace('https://bharataiinnovation.com', ''));
check('one tap on Yes records a fresh answer and lands on the answer page', r.status === 302 && !!q('SELECT rsvp_at FROM attendees WHERE id = 1')[0].rsvp_at, r.status + ' ' + q('SELECT rsvp_status, rsvp_at FROM attendees WHERE id = 1')[0].rsvp_at);
st = await hit('GET', '/api/admin/entry-slots/status', undefined, ADMIN);
check('status: Friday morning shows 1 fresh yes since the email went; the older yeses (Asha, the colleague) do not count', by('fri-am').yes_now === 1 && by('fri-am').no_now === 0 && !!st.json.asked_since, JSON.stringify(st.json.slots));
// Someone pays before their turn: skipped, not sent.
db.run("UPDATE attendees SET badge_type = 'Expo Pass', payment_status = 'paid' WHERE id = ?", [order[8]]);
const t = await hit('POST', '/api/cron/tick', {}, ADMIN);
const rec = q("SELECT status, COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? GROUP BY status", camp);
const n = (s) => (rec.find(x => x.status === s) || {}).n || 0;
check('the minute clock moves it ten at a time; the one who bought an Expo Pass is skipped', t.status === 200 && n('sent') === 17 && n('skipped') === 1 && n('pending') === 3, JSON.stringify(rec));
await hit('POST', '/api/cron/tick', {}, ADMIN);
await hit('POST', `/api/admin/campaigns/${camp}/pump`, { batch: 8 }, ADMIN);
check('the run finishes: 20 sent (one skipped), nobody twice', q("SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND status = 'sent'", camp)[0].n === 20 && new Set(sent.map(m => JSON.stringify(m.Recipients))).size === sent.length, String(sent.length));
r = await hit('POST', '/api/admin/campaigns', { kind: 'entry_slot', audience: 'all' }, ADMIN);
check('a second run finds nobody (nobody is sent it twice)', r.status === 400, JSON.stringify(r.json));
// Outside the window: the send waits.
FAKE_NOW = RealDate.parse('2026-11-17T16:00:00Z'); // 21:30 IST
r = await hit('POST', '/api/admin/attendees/1/send-entry-slot', {}, ADMIN);
check('after 9 pm IST a send waits (409, paused)', r.status === 409 && r.json?.paused === true, r.status + ' ' + JSON.stringify(r.json));
r = await hit('POST', '/api/admin/attendees/20/send-entry-slot', {}, ADMIN);
check('a paid pass is skipped', r.json?.skipped === true, JSON.stringify(r.json));
db.run("UPDATE attendees SET entry_slot = ? WHERE id = 31", [FRI_PM]);
r = await hit('POST', '/api/admin/attendees/31/send-entry-slot', {}, ADMIN);
check('an exhibitor\'s guest is never sent the entry-time email, even with a time typed by hand', r.json?.skipped === true, JSON.stringify(r.json));
db.run("UPDATE attendees SET entry_slot = NULL WHERE id = 31");
// From 8:30 am for this email only (the organiser: "start sending from morning 8:30 AM").
FAKE_NOW = RealDate.parse('2026-11-18T02:50:00Z'); // Wednesday 8:20 IST
r = await hit('POST', '/api/admin/attendees/1/send-entry-slot', {}, ADMIN);
check('8:20 am IST: still waits', r.status === 409 && r.json?.paused === true && /8:30am to 9pm IST/.test(JSON.stringify(r.json)), r.status + ' ' + JSON.stringify(r.json));
FAKE_NOW = RealDate.parse('2026-11-18T03:05:00Z'); // Wednesday 8:35 IST
r = await hit('POST', '/api/admin/attendees/1/send-entry-slot', {}, ADMIN);
check('8:35 am IST: it goes (this email opens at 8:30, not 9)', r.status === 200 && r.json?.success === true, r.status + ' ' + JSON.stringify(r.json));
r = await hit('POST', '/api/admin/attendees/1/send-event-week', {}, ADMIN);
check('8:35 am IST: the other bulk emails still wait for 9', r.status === 409 && r.json?.paused === true, r.status + ' ' + JSON.stringify(r.json));
FAKE_NOW = RealDate.parse('2026-11-19T03:45:00Z'); // Thursday 19 Nov, 9:15 IST

// ---- the waiting list, let in on the 19th ----
r = await hit('POST', '/api/admin/entry-slots/let-in-waitlist', {}, ADMIN);
check('let in: 2 confirmed, both to either day', r.status === 200 && r.json.let_in === 2 && slotOf(22) === ANY && slotOf(23) === ANY &&
  q("SELECT COUNT(*) AS n FROM attendees WHERE id IN (22, 23) AND entry_status = 'confirmed' AND entry_decided_at IS NOT NULL")[0].n === 2, JSON.stringify(r.json));
r = await hit('POST', '/api/admin/campaigns', { kind: 'entry_slot', audience: 'all' }, ADMIN);
check('the next run is only the two let in', r.status === 201 && r.json.total === 2, JSON.stringify(r.json));
const before2 = sent.length;
await hit('POST', `/api/admin/campaigns/${r.json.id}/pump`, { batch: 8 }, ADMIN);
const wlMail = sent.slice(before2).find(m => JSON.stringify(m.Recipients).includes('wait1@example.com'));
check('their email: "a place has opened up", confirmed for either day, in the subject too',
  !!wlMail && wlMail.Content.Body[0].Content.includes('a place has opened up') && /good news: your Free Visitor Pass is confirmed for Friday 20 or Saturday 21 Nov, any time from 8:30 am/.test(wlMail.Content.Subject), wlMail?.Content?.Subject);
st = await hit('GET', '/api/admin/entry-slots/status', undefined, ADMIN);
check('status after: nobody waiting, 2 let in, nothing left to send', st.json.waiting === 0 && st.json.let_in === 2 && st.json.to_send === 0 && st.json.without === 0, JSON.stringify(st.json));

// ---- "come on either day" for those who said they can't make their time (19 Nov) ----
const rsvpIn = (addr, status) => {
  const m = [...sent].reverse().find(x => JSON.stringify(x.Recipients).includes(addr));
  const b = m?.Content?.Body?.[0]?.Content || '';
  return ((b.match(new RegExp('href="(https://bharataiinnovation\\.com/api/rsvp\\?[^"]*status=' + status + '[^"]*)"')) || [])[1] || '').replace('https://bharataiinnovation.com', '');
};
const free1 = (slot) => q("SELECT id, email FROM attendees WHERE entry_slot = ? AND badge_type = 'Visitor Pass' AND unsubscribed_at IS NULL ORDER BY id LIMIT 1", slot)[0];
const noA = free1(FRI_PM), noB = free1(SAT_AM);
const ravi = q('SELECT id, email FROM attendees WHERE id = 2')[0], far = q('SELECT id, email FROM attendees WHERE id = 5')[0];
for (const p of [noA, noB, ravi, far]) await hit('GET', rsvpIn(p.email, 'declined'));
// SQLite's datetime('now') is the real clock, to the second: put the email run and these
// answers on Wednesday, so "after the either-day email" is not decided by the same second.
db.run("UPDATE campaigns SET created_at = '2026-11-18 03:00:00' WHERE kind = 'entry_slot'");
db.run('UPDATE attendees SET rsvp_at = ? WHERE id IN (?, ?, ?, ?)', ['2026-11-18 10:00:00', noA.id, noB.id, ravi.id, far.id]);
check('four tapped "I can\'t make it" from their email', q("SELECT COUNT(*) AS n FROM attendees WHERE id IN (?, ?, ?, ?) AND rsvp_status = 'declined' AND rsvp_at IS NOT NULL", noA.id, noB.id, ravi.id, far.id)[0].n === 4, [noA.id, noB.id, ravi.id, far.id].join(','));
st = await hit('GET', '/api/admin/entry-slots/status', undefined, ADMIN);
check('status: 3 to offer either day (the one already on either day is not)', st.json.reoffer?.to_send === 3 && st.json.reoffer?.sent === 0 && !st.json.reoffer?.open_run, JSON.stringify(st.json.reoffer));
const before3 = { sent: sent.length, tokens: count('login_tokens'), camps: count('campaigns') };
const rp = await hit('GET', '/api/admin/entry-slots/reoffer-preview', undefined, ADMIN);
check('preview: 3, from Friday morning, Friday afternoon and Saturday morning; the subject; the new time in the box; buttons not live',
  rp.status === 200 && rp.json.counts?.total === 3 && rp.json.counts['fri-am'] === 1 && rp.json.counts['fri-pm'] === 1 && rp.json.counts['sat-am'] === 1 &&
  /no problem: come any time on Friday 20 or Saturday 21 Nov$/.test(rp.json.subject) && rp.json.html.includes(ANY) && rp.json.html.includes('can&rsquo;t make it at the entry time we gave you') && rp.json.html.includes('Are you coming?') && !rp.json.html.includes('/api/rsvp?') && !rp.json.html.includes('Expo Pass'),
  JSON.stringify(rp.json?.counts) + ' ' + rp.json?.subject);
check('the preview sent nothing, minted no token, made no run and moved nobody', sent.length === before3.sent && count('login_tokens') === before3.tokens && count('campaigns') === before3.camps && slotOf(noA.id) === FRI_PM && slotOf(ravi.id) === FRI_AM, '');
r = await hit('POST', '/api/admin/campaigns', { kind: 'entry_reoffer', audience: 'all' }, ADMIN);
const roCamp = r.json?.id;
check('a run of kind entry_reoffer: 3 people, titled', r.status === 201 && r.json.total === 3 && r.json.title === 'Free Visitor Pass: come on either day', JSON.stringify(r.json));
await hit('GET', rsvpIn(ravi.email, 'confirmed'));
const before4 = sent.length;
r = await hit('POST', `/api/admin/campaigns/${roCamp}/pump`, { batch: 8 }, ADMIN);
const roRec = q("SELECT status, COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? GROUP BY status", roCamp);
const rn = (s) => (roRec.find(x => x.status === s) || {}).n || 0;
check('the run sends 2; Ravi said yes again before his turn and is skipped, his Friday morning kept', rn('sent') === 2 && rn('skipped') === 1 && slotOf(ravi.id) === FRI_AM, JSON.stringify(roRec));
check('the two sent now have either day', slotOf(noA.id) === ANY && slotOf(noB.id) === ANY, slotOf(noA.id) + ' | ' + slotOf(noB.id));
const roMail = sent.slice(before4).find(m => JSON.stringify(m.Recipients).includes(noA.email));
check('their email: the subject, either day in the box, signed Yes / Can\'t links, a sign-in token',
  !!roMail && /no problem: come any time on Friday 20 or Saturday 21 Nov$/.test(roMail.Content.Subject) && roMail.Content.Body[0].Content.includes(ANY) && /status=confirmed[^"]*sig=[0-9a-f]{32}/.test(roMail.Content.Body[0].Content) && /token=/.test(roMail.Content.Body[0].Content), roMail?.Content?.Subject);
await hit('GET', rsvpIn(noA.email, 'confirmed'));
st = await hit('GET', '/api/admin/entry-slots/status', undefined, ADMIN);
check('status: 2 offered, 1 said yes since; either day counts that yes, and the old "can\'t" of the other one is not counted against either day',
  st.json.reoffer?.sent === 2 && st.json.reoffer?.yes_after === 1 && st.json.reoffer?.to_send === 0 && by('any').yes_now === 1 && by('any').no_now === 1, JSON.stringify(st.json.reoffer) + ' ' + JSON.stringify(by('any')));
r = await hit('POST', '/api/admin/campaigns', { kind: 'entry_reoffer', audience: 'all' }, ADMIN);
check('a second "either day" run finds nobody', r.status === 400, JSON.stringify(r.json));
FAKE_NOW = RealDate.parse('2026-11-19T16:00:00Z'); // Thursday 21:30 IST
r = await hit('POST', `/api/admin/attendees/${noB.id}/send-entry-reoffer`, {}, ADMIN);
check('the "either day" email skips one already on either day', r.json?.skipped === true && /either day/.test(r.json?.reason || ''), JSON.stringify(r.json));

// ---- the badge desk ----
const passTok = (id) => id + '.' + createHmac('sha256', 'smoke-session').update('pass:' + id).digest('hex').slice(0, 24);
FAKE_NOW = RealDate.parse('2026-11-20T03:30:00Z'); // Friday 9:00 IST
r = await hit('POST', '/api/staff/scan', { token: passTok(1) }, ADMIN);
check('desk, Friday 9 am, a Friday-morning pass: checked in, on time', r.status === 200 && r.json.state === 'ok' && r.json.slot === FRI_AM && r.json.slot_now === true, JSON.stringify(r.json));
const late = order.find(id => slotOf(id) === SAT_PM);
r = await hit('POST', '/api/staff/scan', { token: passTok(late) }, ADMIN);
check('desk, Friday 9 am, a Saturday-afternoon pass: still checked in (the desk lead decides), marked not their time', r.json.state === 'ok' && r.json.slot === SAT_PM && r.json.slot_now === false, JSON.stringify(r.json));
r = await hit('POST', '/api/staff/scan', { token: passTok(5) }, ADMIN);
check('desk: "either day" is on time on Friday', r.json.slot_now === true, JSON.stringify(r.json));
r = await hit('POST', '/api/staff/scan', { token: passTok(20) }, ADMIN);
check('desk: a paid pass has no entry time on the scan', r.json.state === 'ok' && r.json.slot === undefined, JSON.stringify(r.json));
FAKE_NOW = RealDate.parse('2026-11-21T09:00:00Z'); // Saturday 14:30 IST
r = await hit('POST', '/api/staff/scan', { token: passTok(late) }, ADMIN);
check('desk, Saturday 2:30 pm: the Saturday-afternoon pass is on time', r.json.slot_now === true, JSON.stringify(r.json));
const scanPage = { text: read('dist/_worker.js'), status: 'built worker' };
check('the scan page draws the amber "not their time" card', scanPage.text.includes('CHECKED IN: NOT THEIR TIME') && scanPage.text.includes('NOT THEIR ENTRY TIME'), scanPage.status);

// ---- Saturday open to all (the organiser, 20 Nov 22:15: "allow every one tomorrow") ----
FAKE_NOW = RealDate.parse('2026-11-20T17:00:00Z'); // Friday 22:30 IST
st = await hit('GET', '/api/admin/entry-slots/status', undefined, ADMIN);
const satN = st.json.saturday?.to_send;
check('status: a Saturday email for the free passes that did not come on Friday', typeof satN === 'number' && satN > 0 && st.json.saturday.sent === 0 && !st.json.saturday.open_run, JSON.stringify(st.json.saturday));
const sp = await hit('GET', '/api/admin/entry-slots/sat-preview', undefined, ADMIN);
check('Saturday preview: the subject, "any time from 8:30 am" in the box, no "Are you coming?"',
  sp.status === 200 && sp.json.total === satN && /come any time on Saturday 21 Nov: your Free Visitor Pass works all day$/.test(sp.json.subject) && sp.json.html.includes('Saturday 21 Nov, any time from 8:30 am') && !sp.json.html.includes('Are you coming') && !sp.json.html.includes('Expo Pass'), sp.json?.subject);
r = await hit('POST', '/api/admin/campaigns', { kind: 'sat_open', audience: 'all' }, ADMIN);
const satCamp = r.json?.id;
check('a run of kind sat_open: the same count, titled', r.status === 201 && r.json.total === satN && r.json.title === 'Free Visitor Pass: Saturday open to all', JSON.stringify(r.json));
const satIds = q('SELECT attendee_id FROM campaign_recipients WHERE campaign_id = ?', satCamp).map(x => x.attendee_id);
check('not on it: those who came on Friday (Asha, the Bengaluru one), the paid Delegate, the exhibitor\'s guest', !satIds.includes(1) && !satIds.includes(5) && !satIds.includes(20) && !satIds.includes(31) && !satIds.includes(21) && satIds.includes(22), satIds.join(','));
const b5 = sent.length;
await hit('POST', `/api/admin/campaigns/${satCamp}/pump`, { batch: 50 }, ADMIN);
check('10:30 pm IST: it goes tonight (until 11:30 pm), nobody twice', sent.length - b5 === satN && new Set(sent.slice(b5).map(m => JSON.stringify(m.Recipients))).size === satN, String(sent.length - b5));
const wlSat = sent.slice(b5).find(m => JSON.stringify(m.Recipients).includes('wait1@example.com'));
check('the one let in from the waiting list gets the "good news" Saturday version', !!wlSat && /good news: your Free Visitor Pass is confirmed for Saturday 21 Nov, any time$/.test(wlSat.Content.Subject) && wlSat.Content.Body[0].Content.includes('a place has opened up'), wlSat?.Content?.Subject);
FAKE_NOW = RealDate.parse('2026-11-20T22:00:00Z'); // Saturday 3:30 IST
r = await hit('POST', '/api/admin/attendees/6/send-sat-open', {}, ADMIN);
check('3:30 am IST: a Saturday send waits for 6 am', r.status === 409 && r.json?.paused === true, r.status + ' ' + JSON.stringify(r.json));
FAKE_NOW = RealDate.parse('2026-11-21T03:00:00Z'); // Saturday 8:30 IST
r = await hit('POST', '/api/staff/scan', { token: passTok(2) }, ADMIN);
check('desk, Saturday 8:30 am, a Friday-morning pass: on time (Saturday is open to all)', r.json.state === 'ok' && r.json.slot === FRI_AM && r.json.slot_now === true, JSON.stringify(r.json));

// ---- the app and the event-week email ----
const appJs = await hit('GET', '/app.js');
check('the app pass card says the entry time', appJs.text.includes(' is a free pass with an entry time') && appJs.text.includes("'Your entry time: ' + slotText"), appJs.status);
check('from Saturday the app pass card says any time today', appJs.text.includes(' works any time today') && appJs.text.includes('Saturday 21 Nov is open to every free pass'), appJs.status);
const ew = await hit('GET', '/api/admin/event-week/preview?audience=free&kind=free', undefined, ADMIN);
check('the event-week email says Friday and Saturday, never Thursday', ew.status === 200 && !/Thursday/.test(ew.json?.html || '') && (ew.json?.html || '').includes('Friday 20 Nov'), ew.status);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
