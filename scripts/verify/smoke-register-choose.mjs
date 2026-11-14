// Built-worker checks for the form-first /register (13-14 Nov 2026), the routes together on real
// SQLite (sql.js) with the production schema and migrations 0056 and 0063:
//  - "I am a..." (attendees.attendee_type, 0063): kept from the fixed list only, never
//    anything else a form posts; a buyer who came straight to a Student or an Academic
//    pass has said it already; before 0063 a registration is still kept;
//  - the person is saved (and, free passes being full, on the waiting list) before any
//    pass is chosen;
//  - GET /api/events/1/registered-count, the line under the form (14 Nov 2026: a number,
//    not one line per sign-up): every row of the event once, the main event and the
//    campus panels together, nothing else in the answer, cached for a minute.
// Run after `npm run build`:  node scripts/verify/smoke-register-choose.mjs
import { readFileSync } from 'node:fs';
import { waitlistWorld, settle } from './waitlist-world.mjs';
import { checker } from './talks-world.mjs';
const { check, done } = checker();
const W = await waitlistWorld({ on: true });
const count = async () => (await W.hit('GET', '/api/events/1/registered-count'));
const rows = () => W.q('SELECT COUNT(*) AS n FROM attendees WHERE event_id = 1')[0].n;
const typeOf = (email) => (W.q('SELECT * FROM attendees WHERE email = ?', email)[0] || {}).attendee_type;

// ---- before 0063 ----
let r = await W.register({ email: 'early@gmail.com', attendee_type: 'student', city: 'pune' });
check('before 0063: the registration is kept, on the waiting list, the answer simply not stored', r.status === 201 && r.json.entry_status === 'waitlisted' && !('attendee_type' in r.json), r.json);

// ---- 0063 ----
W.db.exec(readFileSync(new URL('../../migrations/0063_attendee_type.sql', import.meta.url), 'utf8'));
r = await W.register({ email: 'founder@gmail.com', attendee_type: 'startup', city: 'NAVI MUMBAI' });
check('0063: the answer is kept, and the person is saved on the waiting list before any pass is chosen', r.status === 201 && r.json.attendee_type === 'startup' && r.json.badge_type === 'Visitor Pass' && r.json.entry_status === 'waitlisted', r.json);
for (const t of ['corporate', 'student', 'faculty', 'government', 'media']) {
  r = await W.register({ email: t + '@gmail.com', attendee_type: t, city: 'Delhi' });
  check('0063: ' + t + ' is kept', r.status === 201 && typeOf(t + '@gmail.com') === t, r.json);
}
r = await W.register({ email: 'odd@gmail.com', attendee_type: '<script>alert(1)</script>', city: 'Thane' });
check('anything outside the list is not kept, the registration is', r.status === 201 && typeOf('odd@gmail.com') == null, typeOf('odd@gmail.com'));
r = await W.register({ email: 'caps@gmail.com', attendee_type: ' Student ', city: 'Thane' });
check('spaces and capitals are forgiven', typeOf('caps@gmail.com') === 'student', typeOf('caps@gmail.com'));
r = await W.register({ email: 'buyer@gmail.com', badge_type: 'Student Pass', job_title: '', city: 'Nashik' });
check('a buyer straight on the Student Pass has said it already', r.status === 201 && typeOf('buyer@gmail.com') === 'student', r.json);
r = await W.register({ email: 'prof@gmail.com', badge_type: 'Academic Pass', job_title: '', city: 'Nashik' });
check('and one on the Academic Pass is faculty', r.status === 201 && typeOf('prof@gmail.com') === 'faculty', r.json);

// ---- how many have registered ----
let c = await count();
check('the count is every row of the event', c.status === 200 && c.json.total === rows() && c.json.total >= 10, c.json);
check('nothing but the number: no names, no lines', Object.keys(c.json).join() === 'total', Object.keys(c.json));
check('cached for a minute, by anyone', /public/.test(c.headers.get('Cache-Control') || '') && /max-age=60/.test(c.headers.get('Cache-Control') || ''), c.headers.get('Cache-Control'));
const before = c.json.total;
// A campus-panel registrant (main_event 0) and someone the team added both count.
W.person(901, { name: 'Panel Person', main_event: 0, registration_source: 'campus:jnu' });
W.person(902, { name: 'Added By Hand', city: 'Kochi' });
r = await W.register({ email: 'one.more@gmail.com', attendee_type: 'corporate', city: 'Pune' });
await settle();
c = await count();
check('the main event and the campus panels together: three more, three more counted', c.json.total === before + 3 && c.json.total === rows(), { before, now: c.json.total });
W.db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (2, 'Delhi', '2027-07-28', '2027-07-29')");
W.db.run("INSERT INTO attendees (event_id, name, email) VALUES (2, 'Delhi Person', 'delhi@example.com')");
c = await count();
check('another event is not counted', c.json.total === before + 3, c.json);

// The page itself.
const page = (await W.hit('GET', '/register')).text;
check('/register: the form asks who they are, and shows how many have registered with the app to meet them in', page.includes('name="rf-kind"') && page.includes("fetch('/api/events/1/registered-count')") && page.includes('attendee_type: kind') && page.includes('people have already registered. See who is coming on <a href="/networking" class="ps-link">Bharat AI Connect</a>'));
check('/register: no line about one person any more', !page.includes('recent-signups') && !page.includes('registered just now'));
check('/register: the passes wait on the screen after the form', page.includes('id="reg-choose" class="hidden"') && page.includes('Not now. Keep me on the waiting list') && page.includes('data-pass="Student Pass"'));

done();
