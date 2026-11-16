// Integration: the Delegate Pass workshop bonus (16 Nov 2026) through the WHOLE built
// worker on real SQLite with the production schema (upgrade-world.mjs). The organiser:
// "give access to workshop to delagtes as well ... those who bough delegation ... and
// send them notification". Agreed with them: a bonus for the Delegate Pass holders of
// that day only, listed by id in BONUS_IDS (routes/workshop-reminder.ts); the pass on
// sale is unchanged. Checked here: who may take a seat (a listed Delegate, paid or
// given free; not refunded; not a Delegate bought later), the admin lists, the email in
// their own words, sent once by the minute clock 9am to 9pm India and never to anyone
// unsubscribed or with a seat, no invitation for them any more, the call list, the
// Premium Delegate step refused and left out of the app's "Move up" list, and the
// "Move up to VIP" offer email. The clock is pinned, never read from today's date.
// Run after `npm run build`:  node scripts/verify/smoke-workshop-bonus.mjs
import { makeUpgradeWorld, checker, ADMIN, CRON } from './upgrade-world.mjs';

const W = await makeUpgradeWorld();
const { check, fails } = checker();
const { at, realClock, person, hit, setting } = W;
let r;

// 1 pm in India on 16 Nov 2026, and 10:30 pm the night before (SQLite reads the same
// pinned clock, so at that hour nobody here is old enough for the 15-minute emails).
const DAY = '2026-11-16T07:30:00Z', NIGHT = '2026-11-15T17:00:00Z';
at(DAY);

W.db.run(`INSERT INTO workshops (id, event_id, slug, title, speaker, summary, starts_at, ends_at, room, capacity, is_open, sort_order) VALUES
  (1, 1, 'ibm-workshop', 'AI, Trust and Evolving Skills using IBM Bob', 'KrishnaKanth Naik', '', '2099-11-20 11:30', '2099-11-20 13:00', 'Raman Theatre', 100, 1, 1),
  (2, 1, 'llm-fine-tuning', 'LLM Fine-Tuning, Hands-On', 'Someone', '', '2099-11-20 15:45', '2099-11-20 17:45', 'Raman Theatre', 40, 1, 2)`);
// On the list (BONUS_IDS):
person(3966, { badge_type: 'Delegate Pass', payment_status: 'paid' });      // bought, no seat
person(3953, { badge_type: 'Delegate Pass', payment_status: 'waived' });    // given free
person(79, { badge_type: 'Delegate Pass', payment_status: 'paid' });        // unsubscribed
person(3958, { badge_type: 'Delegate Pass', payment_status: 'refunded' });  // refunded since
person(3945, { badge_type: 'VIP Pass', payment_status: 'paid' });           // moved up to VIP since
person(3938, { badge_type: 'Delegate Pass', payment_status: 'paid' });      // has a seat already
person(3862, { badge_type: 'Delegate Pass', payment_status: 'paid' });      // invited and tried before
// Not on the list:
person(5001, { badge_type: 'Delegate Pass', payment_status: 'paid' });      // bought after the list was made
W.db.run("UPDATE attendees SET unsubscribed_at = '2026-11-01 00:00:00' WHERE id = 79");
W.db.run('INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, 3938, 2)');
W.db.run(`INSERT INTO admin_audit (actor, action, entity, entity_id, detail) VALUES
  ('scheduler', 'workshop.invite', 'attendee', '3862', '{"kind":"invite"}'),
  ('attendee 3862', 'workshop.tried', 'attendee', '3862', '{"workshop_id":1,"title":"AI, Trust and Evolving Skills using IBM Bob","pass":"Delegate Pass"}')`);

// ---- who may take a seat ----
const state = async (id) => (await hit('GET', '/api/workshops', undefined, W.as(id))).json || {};
let s = await state(3966);
check('a listed Delegate Pass, paid: the app is told the pass includes a workshop', s.ready === true && s.entitled === true && s.mine === null, JSON.stringify(s).slice(0, 200));
s = await state(3953);
check('...given free: the same', s.entitled === true, JSON.stringify(s).slice(0, 200));
s = await state(5001);
check('a Delegate Pass bought after the list was made: no workshop, as before', s.entitled === false && s.why === 'tier', JSON.stringify(s).slice(0, 200));
s = await state(3958);
check('a listed Delegate Pass refunded since: no workshop', s.entitled === false && s.why === 'unpaid', JSON.stringify(s).slice(0, 200));
s = await state(3945);
check('a listed holder who moved up to VIP keeps the VIP workshop', s.entitled === true, JSON.stringify(s).slice(0, 200));
r = await hit('POST', '/api/workshops/choose', { workshop_id: 1 }, W.as(5001));
check('the later Delegate pressing Book: refused with need_pass, kept as a try', r.status === 403 && r.json.need_pass === true &&
  W.q("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'workshop.tried' AND entity_id = '5001'")[0].n === 1, JSON.stringify(r.json));
r = await hit('POST', '/api/workshops/choose', { workshop_id: 1 }, W.as(3953));
check('a listed Delegate takes a seat', r.status === 200 && r.json.mine === 1, JSON.stringify(r.json).slice(0, 200));

// ---- the admin lists ----
r = await hit('GET', '/api/admin/workshops', undefined, ADMIN);
const unchosen = (r.json.unchosen || []).map(p => p.id).sort((a, b) => a - b);
check('Admin -> Workshops "not chosen yet": the listed Delegates with no seat and the VIP, never the later Delegate or the refunded one',
  JSON.stringify(unchosen) === JSON.stringify([79, 3862, 3945, 3966]), JSON.stringify(unchosen));
r = await hit('GET', '/api/admin/workshop-reminders', undefined, ADMIN);
const listed = (r.json.people || []).map(p => p.id).sort((a, b) => a - b);
check('the workshop email list holds them too, the unsubscribed one marked',
  JSON.stringify(listed) === JSON.stringify([79, 3862, 3938, 3945, 3953, 3966]) && r.json.people.find(p => p.id === 79).unsubscribed === true, JSON.stringify(listed));

// ---- the email, in their words ----
r = await hit('POST', '/api/admin/attendees/3966/workshop-reminder', { preview: true }, ADMIN);
check('their email: "We have added a workshop to your Delegate Pass"', r.status === 200 && r.json.kind === 'choose' && r.json.subject === 'We have added a workshop to your Delegate Pass: choose your seat', JSON.stringify(r.json.subject));
const h = r.json.html || '';
check('...in plain words, at no extra cost, with the open workshops and the button',
  h.includes('Good news: we have added one hands-on workshop to your Delegate Pass, at no extra cost.') && h.includes('LLM Fine-Tuning, Hands-On') && h.includes('AI, Trust and Evolving Skills using IBM Bob') && h.includes('Choose my workshop') && !h.includes('Your Delegate Pass includes one'), h.slice(0, 300));
r = await hit('POST', '/api/admin/attendees/3945/workshop-reminder', { preview: true }, ADMIN);
check('a VIP holder keeps the usual words', r.json.subject === 'Your pass includes a workshop: choose your seat' && (r.json.html || '').includes('Your VIP Pass includes one hands-on workshop'), JSON.stringify(r.json.subject));
r = await hit('POST', '/api/admin/attendees/5001/workshop-reminder', { preview: true }, ADMIN);
check('the later Delegate is not on that list', r.status === 409 && /no workshop in it/.test(r.json.error), JSON.stringify(r.json));

// ---- no invitation for them any more, and the call list ----
r = await hit('GET', '/api/admin/workshop-invites/audience?group=paid', undefined, ADMIN);
check('the invitation to paid passes without a workshop: the later Delegate only, none of the listed ones', JSON.stringify(r.json.ids) === JSON.stringify([5001]), JSON.stringify(r.json));
r = await hit('POST', '/api/admin/attendees/3966/send-workshop-invite', {}, ADMIN);
check('a listed Delegate is never sent the invitation', r.json.skipped === true, JSON.stringify(r.json));
r = await hit('GET', '/api/admin/workshop-tries', undefined, ADMIN);
const t3862 = (r.json.people || []).find(p => p.id === 3862), t5001 = (r.json.people || []).find(p => p.id === 5001);
check('the call list: the listed Delegate who tried says "Workshop added to their pass" and is not counted a sale; the later one is still to call',
  t3862 && t3862.now === 'Workshop added to their pass' && t5001 && t5001.now === 'Not bought yet' && r.json.counts.bought === 0, JSON.stringify(r.json.counts) + ' ' + JSON.stringify(t3862 && t3862.now));

// ---- the minute clock tells them, once ----
const tick = async () => (await hit('POST', '/api/cron/tick', { max_seconds: 1 }, CRON)).json || {};
const bonusMail = () => W.sent.filter(p => W.subject(p) === 'We have added a workshop to your Delegate Pass: choose your seat');
const claims = () => W.q("SELECT entity_id, action, detail FROM admin_audit WHERE action LIKE 'workshop.reminder%' AND actor = 'scheduler' ORDER BY id");
at(NIGHT);
let t = await tick();
check('10:30 pm in India: the clock sends none of them', bonusMail().length === 0 && claims().length === 0, JSON.stringify(t.workshop_mail));
at(DAY);
t = await tick();
const got = claims().filter(x => x.action === 'workshop.reminder').map(x => Number(x.entity_id)).sort((a, b) => a - b);
check('1 pm: each listed Delegate with no seat, not the unsubscribed one, not those with a seat, not the VIP, not the refunded one, not the later Delegate',
  JSON.stringify(got) === JSON.stringify([3862, 3966]) && bonusMail().length === 2, JSON.stringify(got) + ' ' + JSON.stringify(t.workshop_mail));
check('each is logged as the automatic bonus email', claims().every(x => { const d = JSON.parse(x.detail); return d.bonus === true && d.auto === true && d.kind === 'choose'; }), JSON.stringify(claims()));
const m = bonusMail().find(p => W.to(p) === 'p3966@example.com');
check('it goes to their address with a signed button to the seat picker', !!m && /action=workshop&(amp;)?token=[A-Za-z0-9_-]{16,}/.test(W.html(m)), m ? W.html(m).slice(0, 200) : 'no mail');
t = await tick();
check('the next minute: nothing more', bonusMail().length === 2 && claims().length === 2, String(bonusMail().length));
person(3952, { badge_type: 'Delegate Pass', payment_status: 'paid' });
setting('workshop_auto', 'off');
t = await tick();
check('switched off (Admin -> Workshops): the clock sends nothing', !claims().some(x => x.entity_id === '3952'), JSON.stringify(t.workshop_mail));
setting('workshop_auto', 'on');
t = await tick();
check('on again: it goes', claims().some(x => x.entity_id === '3952' && x.action === 'workshop.reminder'), JSON.stringify(t.workshop_mail));
r = await hit('POST', '/api/admin/attendees/79/workshop-reminder', {}, ADMIN);
check('the team can still send it to the unsubscribed one by hand', r.status === 200 && r.json.success === true && W.sent.some(p => W.to(p) === 'p79@example.com'), JSON.stringify(r.json));

// ---- the Premium Delegate step ----
r = await W.start(3966, 'Premium Delegate Pass');
check('a listed Delegate is refused the Premium Delegate step (it would add nothing), and told VIP is open', r.status === 409 && /already includes one workshop/.test(r.json.error) && /VIP Pass/.test(r.json.error) && W.ordersOf(3966).length === 0, JSON.stringify(r.json));
r = await W.start(3966, 'VIP Pass');
check('...and may still move up to VIP for the difference', r.status === 201 && !!r.json.order_id, JSON.stringify(r.json).slice(0, 200));
r = await W.start(5001, 'Premium Delegate Pass');
check('the later Delegate may still buy the Premium Delegate step', r.status === 201 && !!r.json.order_id, JSON.stringify(r.json).slice(0, 200));

// ---- the "Move up to VIP" offer email ----
person(40, { badge_type: 'Delegate Pass', payment_status: 'paid' });        // not listed, first by id
r = await hit('GET', '/api/admin/offers/preview?audience=vip_delegates', undefined, ADMIN);
check('the VIP offer to a Delegate not listed still names the workshop VIP adds', r.json.to === 'p40@example.com' && (r.json.html || '').includes('One hands-on workshop, seat chosen in the app'), JSON.stringify(r.json.to));
W.db.run("UPDATE attendees SET badge_type = 'Visitor Pass' WHERE id = 40");
r = await hit('GET', '/api/admin/offers/preview?audience=vip_delegates', undefined, ADMIN);
check('...to a listed Delegate it does not (they have one)', r.json.to === 'p3862@example.com' && !(r.json.html || '').includes('One hands-on workshop'), JSON.stringify(r.json.to));

// ---- the app's "Move up" list, lifted from the /app.js this build serves ----
const app = await W.appFunctions(['inr', 'upgradePrice', 'upgradeStepsFor', 'upgradeAdds', 'upgradeTargetFor']);
const names = (from) => JSON.parse(JSON.stringify(app.upgradeStepsFor(from))).map(x => x.pass).join();
check('the app, before the workshop answer loads: a Delegate is offered Premium Delegate and VIP, as before', names('Delegate Pass') === 'Premium Delegate Pass,VIP Pass', names('Delegate Pass'));
app._wsState = { ready: true, entitled: true };
check('a listed Delegate (the answer says a workshop is in the pass): VIP only, and VIP adds no workshop',
  names('Delegate Pass') === 'VIP Pass' && !/workshop/.test(app.upgradeAdds('Delegate Pass', 'VIP Pass')), names('Delegate Pass') + ' / ' + app.upgradeAdds('Delegate Pass', 'VIP Pass'));
check('...an Academic Pass is unchanged', names('Academic Pass') === 'Delegate Pass,Premium Delegate Pass,VIP Pass', names('Academic Pass'));
app._wsState = { ready: true, entitled: false };
check('a Delegate without the bonus: Premium Delegate and VIP, and VIP adds a workshop',
  names('Delegate Pass') === 'Premium Delegate Pass,VIP Pass' && /one hands-on workshop/.test(app.upgradeAdds('Delegate Pass', 'VIP Pass')), names('Delegate Pass'));

realClock();
console.log(fails() ? `\n${fails()} FAILED` : '\nALL PASS');
process.exit(fails() ? 1 : 0);
