// Built-worker checks for the waiting list's close (14 Nov 2026: "no free passes available, all slots
// are full, you can upgrade your pass, deadline is 16 Nov 5 PM"; the organiser chose: the list closes,
// passes stay on sale), on real SQLite with the production schema and migration 0056:
//  - the email, an offer audience not tied to the offers switch: only people on the waiting list, still
//    on a free pass; it says every free place is taken, the close, no on-spot registration, and offers
//    the pass that fits (Student for a student) and the Expo Pass; no "we will inform you";
//  - someone who bought or was confirmed is skipped; after the close nothing more is sent;
//  - Admin may confirm a place before the close and is refused after it;
//  - /register's words before and after the close.
// Run after `npm run build`:  node scripts/verify/smoke-waitlist-close.mjs
import { waitlistWorld, settle } from './waitlist-world.mjs';
import { checker } from './talks-world.mjs';
const { check, done } = checker();
const W = await waitlistWorld({ on: true });
const setClose = (iso) => W.db.run("INSERT INTO app_settings (key, value) VALUES ('waitlist_close_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [iso]);
const shared = (key, value) => W.db.run('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);

// Three on the waiting list (one a student), one who bought, one before the switch.
const asha = (await W.register({ email: 'asha@gmail.com', mobile: '+91 98200 31001' })).json.id;
const ravi = (await W.register({ email: 'ravi@gmail.com', mobile: '+91 98200 31002' })).json.id;
const sana = (await W.register({ email: 'sana@gmail.com', mobile: '+91 98200 31003' })).json.id;
try { W.db.exec("ALTER TABLE attendees ADD COLUMN attendee_type TEXT"); } catch { /* 0063 already there */ }
W.db.run("UPDATE attendees SET attendee_type = 'student' WHERE id = ?", [sana]);
W.db.run("UPDATE attendees SET badge_type = 'Delegate Pass', payment_status = 'paid' WHERE id = ?", [ravi]);
const old = W.person(950, { name: 'Old Holder' });
await settle();
check('the three registered on the waiting list', [asha, ravi, sana].every((id) => W.row(id).entry_status === 'waitlisted'));

// ---- the audience and the email ----
let r = await W.admin('GET', '/api/admin/offers');
check('Admin lists the waiting-list audience with its count, offers off: the two still on a free pass', r.status === 200 && r.json.audiences.waitlisted === 2, JSON.stringify(r.json.audiences));
r = await W.admin('GET', '/api/admin/offers/preview?audience=waitlisted');
const pv = r.json || {};
check('the preview: the subject names the deadline', r.status === 200 && /free passes are full: get your pass by 16 Nov, 5 PM$/.test(pv.subject || ''), pv.subject);
check('it says every free place is taken, the close, no on-spot registration', /Every free place is taken/.test(pv.html) && /closes on <strong>Monday 16 Nov at 5 PM<\/strong>/.test(pv.html) && /no on-spot registration/.test(pv.html));
check('no hope in it', !/we will inform you|wait list gets over|confirm places/i.test(pv.html));
check('it offers a pass and the Expo Pass', /Get my Delegate Pass/.test(pv.html) && /Expo Pass<\/strong> is &#8377;999 \+ GST/.test(pv.html));
r = await W.admin('POST', '/api/admin/campaigns', { kind: 'offer', audience: 'waitlisted' });
const run = r.status === 201 ? W.q('SELECT email FROM campaign_recipients WHERE campaign_id = ? ORDER BY id', r.json.id).map((x) => x.email) : [];
check('the run, with the offers off: Asha and Sana; not Ravi who bought, not the holder from before', r.status === 201 && run.join() === 'asha@gmail.com,sana@gmail.com', r.status + ' ' + JSON.stringify(run));

shared('profile_reminder_last_sent_at', '1970-01-01T00:00:00.000Z');
r = await W.admin('POST', `/api/admin/offers/send?audience=waitlisted&attendee=${sana}&force=1`);
await settle(100);
const sm = W.mailTo('sana@gmail.com').pop();
check('the email to the student offers the Student Pass and links to paying for it (signed in where sign-in links are on)', r.json?.success && sm && /Get my Student Pass/.test(W.body(sm)) && /action=pay&pass=student/.test(W.body(sm)) && /action=pay&pass=expo/.test(W.body(sm)), r.text);
r = await W.admin('POST', `/api/admin/offers/send?audience=waitlisted&attendee=${ravi}&force=1`);
check('someone who bought is skipped', r.json?.skipped && /No longer on the waiting list/.test(r.json.reason), r.text);

// ---- Admin confirming a place, before and after the close ----
r = await W.admin('POST', '/api/admin/attendees/waitlist', { ids: [asha], decision: 'confirmed' });
check('before the close Admin may still confirm a place', r.status === 200 && W.row(asha).entry_status === 'confirmed', r.text);
W.db.run("UPDATE attendees SET entry_status = 'waitlisted' WHERE id = ?", [asha]);
setClose('2026-11-16T17:00:00+05:30');
const realNow = Date.now;
Date.now = () => Date.parse('2026-11-16T17:01:00+05:30');
try {
  r = await W.admin('POST', '/api/admin/attendees/waitlist', { ids: [asha], decision: 'confirmed' });
  check('after 16 Nov 5 PM it is refused, in a sentence, and nothing changes', r.status === 409 && /waiting list closed on Monday 16 Nov at 5 PM/.test(r.json?.error || '') && W.row(asha).entry_status === 'waitlisted', r.text);
  r = await W.admin('POST', `/api/admin/offers/send?audience=waitlisted&attendee=${asha}&force=1`);
  check('and the email is not sent any more', r.json?.skipped && /has closed/.test(r.json.reason), r.text);
  const reg = (await W.hit('GET', '/register')).text;
  check('/register after the close: "Not now", and the closed words', reg.includes("? 'Not now' : 'Not now. Continue with a free Visitor Pass'") && reg.includes('the waiting list closed on Monday 16 Nov at 5 PM'));
} finally { Date.now = realNow; }
const before = (await W.hit('GET', '/register')).text;
check('/register before it: "keep me on the waiting list"', before.includes("? 'Not now. Keep me on the waiting list' :"));
check('the organiser words name the close', before.includes('You are on the waiting list, which closes on Monday 16 Nov at 5 PM'));

done();
