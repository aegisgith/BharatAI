// System: one planner's morning in Admin -> Conference (12 Nov 2026), across the parts
// of the platform that must agree, on the whole built worker and real SQLite:
//  1. an Innovation Talk with no time is placed on the programme from "To place": the
//     Innovation Talks tab, the app's talks list and the app's schedule all say the
//     same time and hall;
//  2. a session is dragged onto another: the attention list says it cannot run; "Find
//     a free slot" offers a place; moved there, the list is clean again and the app's
//     schedule has the new time;
//  3. a new speaker is added with email and mobile and given a Speaker pass: they are
//     on the app's speakers list with their session, and hold one registration;
//  4. Delhi is started and copied from Mumbai: planned in Admin, invisible in the app;
//  5. the missing-details email, by itself, writes to the talk's speaker once.
// Run after `npm run build`:  node scripts/verify/system-scheduler.mjs
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { join } from 'node:path';
import { makeWorld, ROOT } from './conference-world.mjs';

let fails = 0, passes = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); if (ok) passes++; else fails++; };
const D1 = '2026-11-20', AR = 'Aryabhata Theatre', BH = 'Homi J. Bhabha Hall', KA = 'Kalam Theatre';
const W = await makeWorld({ migrated: true });
W.db.exec(readFileSync(join(ROOT, 'migrations', '0052_innovation_talk_details.sql'), 'utf8'));
const admin = (m, p, b) => W.call(m, p, b);
const pub = (p) => W.call('GET', p, undefined, { admin: false });
const read = async (id = 1) => (await admin('GET', '/api/admin/events/' + id + '/conference')).json;
const toFix = (d) => d.issues.filter(i => i.level === 'bad');

// ---- 1. an Innovation Talk placed from "To place" ----
W.db.run("INSERT INTO innovation_talks (id, event_id, slot_no, company, speaker_name, speaker_title, topic, status, time_slot, speaker_email) VALUES (81, 1, 1, 'Phoebetal Technologies', 'Amritesh Kumar', 'Product Head', 'AVISA One', 'confirmed', 'To be announced', 'amritesh@phoebetal.test')");
let d = await read();
const t0 = d.talks.unplaced.find(t => t.id === 81);
check('the talk is waiting in "To place"', !!t0 && t0.speaker_name === 'Amritesh Kumar' && !t0.starts_at);
let r = await admin('POST', '/api/admin/events/1/conference/suggest', { day: D1, minutes: 8, hall: AR });
const slot = r.json.slots[0];
check('"Find a free slot" offers the Expo Hall first', slot && slot.hall === AR, slot);
r = await admin('POST', '/api/admin/sessions', { event_id: 1, title: 'Innovation Talk: ' + t0.company, session_type: 'talk', room: slot.hall, start_time: D1 + ' ' + slot.start, end_time: D1 + ' ' + slot.end,
  speakers: [], others: t0.speaker_name, speaker_title: [t0.speaker_title, t0.company].join(', ') });
const sid = r.json.id;
check('placed on the programme', r.status === 201 && Array.isArray(r.json.talk_synced));
const talksAdmin = (await admin('GET', '/api/events/1/innovation-talks')).json.find(t => t.id === 81);
const talksApp = (await pub('/api/events/1/innovation-talks')).json.find(t => t.id === 81);
const sched = (await pub('/api/events/1/sessions')).json.find(s => s.id === sid);
check('the Innovation Talks tab has the same start and hall', talksAdmin.starts_at === D1 + ' ' + slot.start && talksAdmin.hall === AR && talksAdmin.duration_min === 8, talksAdmin);
check("the app's talks list has them too, and none of his email", talksApp.starts_at === D1 + ' ' + slot.start && talksApp.hall === AR && / · /.test(talksApp.time_slot) && !('speaker_email' in talksApp), talksApp);
check("the app's schedule has the session at that time, in that hall, with both hall names to show", sched && sched.start_time === D1 + ' ' + slot.start && sched.room === AR && sched.venue_room === 'Expo Hall' && sched.speaker_name === 'Amritesh Kumar', sched);
d = await read();
check('nothing about this talk needs attention, and "To place" is empty', !d.issues.some(i => i.talk_id === 81) && d.talks.unplaced.length === 0);

// ---- 2. a clash made by a drag, found, and fixed ----
const key = d.sessions.find(s => s.title === 'Keynote');
r = await admin('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' 14:10', end_time: D1 + ' 14:20', room: BH, force: true });
d = await read();
check('dragged onto the panel: the attention list says one thing cannot run', toFix(d).length === 1 && toFix(d)[0].kind === 'hall-clash' && d.clashes.room.length === 1, toFix(d));
r = await admin('POST', '/api/admin/events/1/conference/suggest', { day: D1, minutes: 10, hall: BH, speaker_ids: key.links.map(l => l.speaker_id), except_id: key.id });
const free = r.json.slots[0];
check('"Find it a free slot" offers a place in the same hall', free && free.hall === BH, free);
r = await admin('POST', '/api/admin/sessions/' + key.id + '/move', { start_time: D1 + ' ' + free.start, end_time: D1 + ' ' + free.end, room: free.hall });
d = await read();
check('moved there with no "anyway" needed: the list is clean again', r.status === 200 && r.json.clashes.length === 0 && toFix(d).length === 0);
check("the app's schedule shows the keynote at its new time", (await pub('/api/events/1/sessions')).json.find(s => s.id === key.id).start_time === D1 + ' ' + free.start);

// ---- 3. a new speaker, their session, their pass ----
r = await admin('POST', '/api/admin/speakers', { event_id: 1, name: 'Dr. Priya Menon', role: 'Chief Medical Officer', organisation: 'Apollo Hospitals', email: 'priya@apollo.test', phone: '98200 77777' });
const priya = r.json.id;
r = await admin('POST', '/api/admin/sessions', { event_id: 1, title: 'AI in Healthcare', session_type: 'talk', room: KA, start_time: D1 + ' 15:30', end_time: D1 + ' 16:00', speakers: [{ speaker_id: priya, role: 'speaker' }] });
const pass = await admin('POST', '/api/admin/speakers/' + priya + '/pass', {});
// The app's speakers list is for signed-in attendees: the seeded delegate's session.
const me = W.rows('SELECT id FROM attendees ORDER BY id LIMIT 1')[0].id;
const exp = Math.floor(Date.now() / 1000) + 3600;
const cookie = 'bai_session=' + me + '.' + exp + '.' + crypto.createHmac('sha256', 'h').update(me + '.' + exp).digest('hex');
const speakers = (await W.call('GET', '/api/events/1/speakers', undefined, { admin: false, headers: { Cookie: cookie } })).json;
check('signed out, the speakers list in the app is closed', (await pub('/api/events/1/speakers')).status === 401);
const pubPriya = (Array.isArray(speakers) ? speakers : speakers.speakers || []).find(s => s.name === 'Dr. Priya Menon');
check("she is on the app's speakers list with her designation, and without her email or mobile", pubPriya && pubPriya.role === 'Chief Medical Officer' && !('email' in pubPriya && pubPriya.email) && !('phone' in pubPriya && pubPriya.phone), pubPriya);
check("the app's schedule shows her session with her name and the line under it", (() => { const s = (W.rows("SELECT speaker_name, speaker_title FROM sessions WHERE title = 'AI in Healthcare'"))[0]; return s.speaker_name === 'Dr. Priya Menon' && s.speaker_title === 'Chief Medical Officer, Apollo Hospitals'; })());
const reg = W.rows("SELECT * FROM attendees WHERE email = 'priya@apollo.test'");
check('she holds one registration: a Speaker pass, nothing to pay', pass.status === 200 && reg.length === 1 && reg[0].badge_type === 'Speaker' && reg[0].payment_status === 'waived');
d = await read();
check('Admin shows the pass on her, one session, and asks only for her photo', d.speakers.find(s => s.id === priya).pass.badge_type === 'Speaker' && d.speakers.find(s => s.id === priya).slots === 1 && d.issues.some(i => i.speaker_id === priya && /no photo/.test(i.what) && !/no email/.test(i.what)));

// ---- 4. Delhi: planned in Admin, invisible in the app ----
await admin('POST', '/api/admin/conference/start-delhi', {});
r = await admin('POST', '/api/admin/events/2/conference/copy-from/1', {});
const delhi = await read(2);
check("Delhi has Mumbai's programme as drafts, on 28 and 29 July 2027", r.json.sessions === 6 && delhi.sessions.length === 6 && delhi.sessions.every(s => s.status === 'draft' && /^2027-07-2[89] /.test(s.start_time)), [r.json, delhi.sessions.length]);
check('with no speakers and no Innovation Talks of its own', delhi.speakers.length === 0 && delhi.talks.total === 0 && delhi.sessions.every(s => !s.links.length));
check('the app answers nothing for Delhi', (await pub('/api/events/2/sessions')).status === 404 && (await pub('/api/events/2/innovation-talks')).status === 404);
check("and Mumbai's app schedule has only Mumbai's six sessions", (await pub('/api/events/1/sessions')).json.length === 6);

// ---- 5. the missing-details email by itself ----
const Real = Date;
const pin = Real.parse('2026-11-13T11:00:00+05:30');
globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(pin); } static now() { return pin; } };
await admin('POST', '/api/admin/innovation-talks/auto', { on: true });
const before = W.sent.length;
r = await W.call('POST', '/api/cron/tick', {}, { admin: false, headers: { Authorization: 'Bearer h-admin' } });
const mail = W.sent.slice(before).find(m => /Innovation Talk/.test(JSON.stringify(m)));
const body = mail ? JSON.stringify(mail) : '';
check('the clock writes to the talk\'s speaker once, naming his time and both hall names', r.json.talk_requests.sent === 1 && /amritesh@phoebetal\.test/.test(body) && body.includes(AR + ' (Expo Hall') && /A clear photo of you/.test(body), r.json.talk_requests);
check('it asks for the photo, bio and mobile he is missing, not the topic he has sent', /Two or three lines about you/.test(body) && /Your mobile number/.test(body) && !/The title of your talk/.test(body));
globalThis.Date = Real;

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
