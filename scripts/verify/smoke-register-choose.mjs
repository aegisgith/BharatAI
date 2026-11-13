// Built-worker checks for the form-first /register (13 Nov 2026), the routes together on real
// SQLite (sql.js) with the production schema and migrations 0056 and 0063:
//  - "I am a..." (attendees.attendee_type, 0063): kept from the fixed list only, never
//    anything else a form posts; a buyer who came straight to a Student or an Academic
//    pass has said it already; before 0063 a registration is still kept;
//  - the person is saved (and, free passes being full, on the waiting list) before any
//    pass is chosen;
//  - GET /api/events/1/recent-signups, the line under the form: real self-registrations
//    and paid orders only, the newest first, at most eight, with no name, company, job
//    title or total; a city only when it is letters; nothing older than twelve hours
//    (a purchase: a day); nobody the team added by hand; cached for a minute.
// Run after `npm run build`:  node scripts/verify/smoke-register-choose.mjs
import { readFileSync } from 'node:fs';
import { waitlistWorld, settle } from './waitlist-world.mjs';
import { checker } from './talks-world.mjs';
const { check, done } = checker();
const W = await waitlistWorld({ on: true });
const lines = async () => (await W.hit('GET', '/api/events/1/recent-signups'));
const typeOf = (email) => (W.q('SELECT * FROM attendees WHERE email = ?', email)[0] || {}).attendee_type;

// ---- before 0063 ----
let r = await W.register({ email: 'early@gmail.com', attendee_type: 'student', city: 'pune' });
check('before 0063: the registration is kept, on the waiting list, the answer simply not stored', r.status === 201 && r.json.entry_status === 'waitlisted' && !('attendee_type' in r.json), r.json);
let l = await lines();
check('before 0063: the line still works, from the industry and the city', l.status === 200 && l.json.lines.length === 1 && l.json.lines[0] === 'Someone in Software & SaaS from Pune registered just now', l.json);

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

// ---- the line under the form ----
r = await W.register({ email: 'junk@gmail.com', attendee_type: 'corporate', city: 'na' });
r = await W.register({ email: 'nasty@gmail.com', attendee_type: 'media', city: '<img src=x onerror=alert(1)>' });
r = await W.register({ email: 'digits@gmail.com', attendee_type: 'government', city: 'Sector 62' });
W.person(900, { name: 'Added By Hand', city: 'Kochi', industry: 'Insurance' });
await settle();
l = await lines();
const all = l.json.lines;
const SHAPE = /^(A business professional|A startup founder|A student|A teacher|A government officer|A media professional|Someone in [A-Za-z &\/]+|Someone)( from [A-Z][A-Za-z .'-]+)? (registered|took a [A-Za-z ]+ Pass) (just now|\d+ minutes ago|1 hour ago|\d+ hours ago)$/;
check('the lines: at most eight, each in the one shape', l.status === 200 && all.length === 8 && all.every((x) => SHAPE.test(x)), all);
check('nothing but the lines: no total, no ids', Object.keys(l.json).join() === 'lines', Object.keys(l.json));
check('no name, company or job title in any of them', !/Asha|Rao|Founder|gmail|Added By Hand/i.test(all.join(' | ')), all);
check('a city that is not a city is left out, the line stays', all.includes('A government officer registered just now') && all.includes('A media professional registered just now') && all.includes('A business professional registered just now') && !/<|Sector|onerror/.test(all.join(' ')), all);
check('someone the team added by hand is not shown', !/Kochi|Insurance/.test(all.join(' ')), all);
check('cached for a minute, by anyone', /public/.test(l.headers.get('Cache-Control') || '') && /max-age=60/.test(l.headers.get('Cache-Control') || ''), l.headers.get('Cache-Control'));

// The newest first, a city in its proper capitals, and old ones dropped.
W.db.run("UPDATE admin_audit SET created_at = datetime('now', '-13 hours') WHERE action = 'register.self'");
r = await W.register({ email: 'late@gmail.com', attendee_type: 'startup', city: 'NAVI MUMBAI' });
W.db.run("UPDATE admin_audit SET created_at = datetime('now', '-25 minutes') WHERE action = 'register.self' AND created_at > datetime('now', '-1 hour')");
r = await W.register({ email: 'last@gmail.com', attendee_type: 'student', city: 'new delhi' });
l = await lines();
check('older than twelve hours is dropped; the newest is first, the city in capitals', l.json.lines.length === 2 && l.json.lines[0] === 'A student from New Delhi registered just now' && l.json.lines[1] === 'A startup founder from Navi Mumbai registered 25 minutes ago', l.json.lines);

// A real purchase joins the same list.
const buyerId = W.q("SELECT id FROM attendees WHERE email = 'founder@gmail.com'")[0].id;
W.db.run("INSERT INTO payment_orders (order_id, attendee_id, event_id, pass_type, base_paise, gst_paise, amount_paise, status, paid_at) VALUES ('BAI-T1', ?, 1, 'Delegate Pass', 899900, 161982, 1061882, 'paid', datetime('now', '-3 hours'))", [buyerId]);
W.db.run("INSERT INTO payment_orders (order_id, attendee_id, event_id, pass_type, base_paise, gst_paise, amount_paise, status) VALUES ('BAI-T2', ?, 1, 'VIP Pass', 2499900, 449982, 2949882, 'created')", [buyerId]);
l = await lines();
check('a paid order shows as a pass taken, an unpaid one never', l.json.lines.includes('A startup founder from Navi Mumbai took a Delegate Pass 3 hours ago') && !/VIP/.test(l.json.lines.join(' ')) && l.json.lines.length === 3, l.json.lines);
check('still in order of time', /just now$/.test(l.json.lines[0]) && /25 minutes ago$/.test(l.json.lines[1]) && /3 hours ago$/.test(l.json.lines[2]), l.json.lines);

// Nothing recent: nothing to show, and no error.
W.db.run("UPDATE admin_audit SET created_at = datetime('now', '-2 days') WHERE action = 'register.self'");
W.db.run("UPDATE payment_orders SET paid_at = datetime('now', '-2 days')");
l = await lines();
check('nothing recent: an empty list, not an error', l.status === 200 && Array.isArray(l.json.lines) && l.json.lines.length === 0, l.json);

// The page itself.
const page = (await W.hit('GET', '/register')).text;
check('/register: the form asks who they are, and reads the lines', page.includes('name="rf-kind"') && page.includes("fetch('/api/events/1/recent-signups')") && page.includes('attendee_type: kind'));
check('/register: the passes wait on the screen after the form', page.includes('id="reg-choose" class="hidden"') && page.includes('Not now. Keep me on the waiting list') && page.includes('data-pass="Student Pass"'));

done();
