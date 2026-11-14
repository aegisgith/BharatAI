// Built-worker checks for the free-pass waiting list (0056, 12 Nov 2026), the routes
// together on real SQLite (sql.js) with the production schema and migration 0056:
//  - switch off: a free registration is the old one (no mark, the welcome email);
//  - switch on: the row is marked, the answer carries the mark, the waiting-list email
//    goes instead of the welcome (the organiser's words, a Delegate button that signs
//    in and opens payment), one email only;
//  - a campus-panel registration is never on the list; a paid tier chosen while full
//    is marked and the mark is ignored the moment it is paid;
//  - no pass: the token route refuses, the desk scan says waitlisted, the offline roster
//    carries code 3, check-in is refused, /verify shows no Check in button;
//  - the account-ready email says waiting list and sells the Delegate Pass;
//  - the board and the Settings card count the list;
//  - the organiser's decision: confirmed with a slot (pass issued, /verify valid, the
//    confirmation email as a bulk run with the slot), back on the list, mark taken off;
//  - someone registered before the switch is untouched; switch off again.
// Run after `npm run build`:  node scripts/verify/smoke-waitlist.mjs
import { waitlistWorld, settle, WAITLIST_TEXT, WAITLIST_UPSELL, WAITLIST_PROFILE_TEXT, DESK_TEXT } from './waitlist-world.mjs';
import { checker } from './talks-world.mjs';
const { check, done } = checker();
const W = await waitlistWorld({ on: false });

// ---- switch off ----
let r = await W.register({ email: 'before@gmail.com', mobile: '+91 98200 00001' });
await settle();
check('off: registered, 201', r.status === 201 && !!r.json?.id, r.json);
const before = r.json.id;
check('off: no mark on the row', W.row(before).entry_status === null);
check('off: the ordinary welcome email', W.mailTo('before@gmail.com').some(m => /You are registered/.test(m.Content.Subject)), W.mailTo('before@gmail.com').map(m => m.Content.Subject));

// ---- switch on ----
await W.setSwitch(true);
r = await W.register({ email: 'asha.rao@gmail.com', mobile: '+91 98200 00002' });
await settle();
check('on: registered, 201, the answer carries the mark', r.status === 201 && r.json.entry_status === 'waitlisted', r.json);
const asha = r.json.id;
check('on: the row is marked', W.row(asha).entry_status === 'waitlisted');
const wm = W.mailTo('asha.rao@gmail.com');
check('on: one email, free registration closed (14 Nov 2026: no waiting list in it)', wm.length === 1 && wm[0].Content.Subject === 'Free registration is closed: get your pass for Bharat AI Innovation 2026', wm.map(m => m.Content.Subject));
const html = W.body(wm[0]);
check('on: no hope in it: no waiting list, no "we will inform you", no place for a finished profile', !/waiting list|will inform you|confirm places/i.test(html) && !html.includes(WAITLIST_TEXT) && !html.includes(WAITLIST_PROFILE_TEXT) && !/complete-profile/.test(html));
check('on: says it plainly: closed, no on-spot registration, get the pass before coming', html.includes('Free registration is closed, and there is no on-spot registration at the venue.') && html.includes('get your pass before you come'));
check('on: the Delegate button signs in and opens payment', /action=pay&pass=delegate&token=/.test(html) && /Get my Delegate Pass/.test(html));
check('on: the reference, no download link', html.includes('BHAI-2026-' + String(asha).padStart(5, '0')) && !/download-pass/.test(html));
check('on: a register.self audit row', W.rows('register.self', asha).length === 1);
const asAsha = W.as(asha);
const tk = await W.hit('GET', '/api/my-pass-token', undefined, asAsha);
check('no pass: 403, waitlisted, with the words', tk.status === 403 && tk.json.error === 'waitlisted' && tk.json.message.includes(WAITLIST_UPSELL), tk.json);
const again = await W.register({ email: 'asha.rao@gmail.com', mobile: '+91 98200 00002' });
check('on: the same address again is not a second row', again.status !== 201 && W.q("SELECT COUNT(*) AS n FROM attendees WHERE email = 'asha.rao@gmail.com'")[0].n === 1, again.status);

// ---- not on the list ----
r = await W.register({ email: 'campus@gmail.com', mobile: '+91 98200 00003', registration_source: 'campus:djsanghvi-21sep' });
check('a campus-panel registration is never on the list', r.status === 201 && !r.json.entry_status && W.row(r.json.id).entry_status === null && Number(W.row(r.json.id).main_event) === 0, W.row(r.json.id));
r = await W.register({ email: 'del@gmail.com', mobile: '+91 98200 00004', badge_type: 'Delegate Pass' });
await settle();
const del = r.json.id;
check('a Delegate chosen while full: marked, payment pending', W.row(del).entry_status === 'waitlisted' && W.row(del).payment_status === 'pending', W.row(del));
check('a Delegate chosen while full: no email until paid', W.mailTo('del@gmail.com').length === 0);
let t2 = await W.hit('GET', '/api/my-pass-token', undefined, W.as(del));
check('a Delegate not paid: refused for the payment first', t2.status === 402, t2.json);
await W.admin('PATCH', '/api/admin/attendees/' + del, { payment_status: 'paid' });
t2 = await W.hit('GET', '/api/my-pass-token', undefined, W.as(del));
check('a Delegate paid: the mark is ignored, pass issued', t2.status === 200 && !!t2.json.token, t2.json);
check('a Delegate paid: the desk admits', (await W.scan(del)).state === 'ok');

// ---- the desk ----
const list = await W.admin('GET', '/api/events/1/attendees');
const inList = (list.json || []).find(a => a.id === asha);
check('admin list carries the mark', !!inList && inList.entry_status === 'waitlisted', inList);
const sc = await W.scan(asha);
check('desk scan: waitlisted, nobody admitted', sc.state === 'waitlisted' && W.row(asha).checked_in_at === null, sc);
const roster = (await W.admin('GET', '/api/staff/roster')).json;
const me = (roster.people || []).find(p => p[0] === asha);
check('roster: code 3, nothing personal', !!me && me[3] === 3 && me.length === 5 && !JSON.stringify(me).includes('gmail'), me);
const tok = await W.token(asha);
const ci = await W.admin('POST', '/api/verify/' + tok + '/checkin', {});
check('check-in: refused with the desk words', ci.status === 400 && ci.json.error === DESK_TEXT, ci.json);
const vp = await W.admin('GET', '/verify/' + tok);
check('/verify: WAITING LIST, no Check in button', vp.text.includes('WAITING LIST') && vp.text.includes(DESK_TEXT) && !vp.text.includes('id="ci"'));

// ---- the account-ready email ----
const nt = await W.admin('POST', '/api/admin/attendees/' + asha + '/notify', {});
await settle();
const nm = W.mailTo('asha.rao@gmail.com').slice(-1)[0];
check('account-ready email: no waiting list, closed and no on-spot registration, the Delegate button, no pass download',
  nt.status === 200 && /get your pass before you come/.test(nm.Content.Subject) && !/waiting list|will inform you|confirm places/i.test(nm.Content.Subject + W.body(nm)) && W.body(nm).includes('Free registration is closed, and there is no on-spot registration at the venue.') && /Get my Delegate Pass/.test(W.body(nm)) && !/Download my pass/.test(W.body(nm)), nm?.Content.Subject);

// ---- the counts ----
const board = await W.admin('GET', '/api/admin/events/1/board');
const wl = board.json?.todo?.waitlist;
check('board: the list counted, the switch read', wl && wl.ready === true && wl.on === true && wl.total === 1, wl);
const st = await W.admin('GET', '/api/admin/waitlist');
check('settings: ready, on, one waiting, today', st.json.ready && st.json.on && st.json.total === 1 && st.json.today === 1 && st.json.confirmed === 0, st.json);

// ---- the decision ----
const sk = await W.admin('POST', '/api/admin/attendees/' + asha + '/send-waitlist-confirm', {});
check('confirmation email before a decision: skipped', sk.json.skipped === true, sk.json);
const dec = await W.admin('POST', '/api/admin/attendees/waitlist', { ids: [asha], decision: 'confirmed', slot: '  Day 2, 2 pm to 6 pm  ' });
let row = W.row(asha);
check('confirmed: the mark, the slot trimmed, when, an audit row', dec.status === 200 && row.entry_status === 'confirmed' && row.entry_slot === 'Day 2, 2 pm to 6 pm' && !!row.entry_decided_at && W.rows('attendees.waitlist').length === 1, row);
const tk2 = await W.hit('GET', '/api/my-pass-token', undefined, asAsha);
check('confirmed: the pass is issued', tk2.status === 200 && !!tk2.json.token, tk2.json);
const vp2 = await W.admin('GET', '/verify/' + tok);
check('/verify: VALID PASS again, Check in back', vp2.text.includes('VALID PASS') && vp2.text.includes('id="ci"'));
check('settings: one let in', (await W.admin('GET', '/api/admin/waitlist')).json.confirmed === 1);
const camp = await W.admin('POST', '/api/admin/campaigns', { kind: 'waitlist_confirm', ids: [asha] });
check('bulk run: created with its own title', (camp.status === 200 || camp.status === 201) && !!camp.json.id && /Free Visitor Pass is confirmed/.test(camp.json.title || ''), camp.json);
const pump = await W.admin('POST', '/api/admin/campaigns/' + camp.json.id + '/pump', { batch: 5 });
await settle();
const cm = W.mailTo('asha.rao@gmail.com').slice(-1)[0];
check('bulk run: the confirmation email, with the slot and the pass link', pump.status === 200 && /confirmed/.test(cm.Content.Subject) && W.body(cm).includes('Day 2, 2 pm to 6 pm') && /download-pass/.test(W.body(cm)), { pump: pump.json, subject: cm?.Content.Subject });
check('bulk run: no unsubscribe footer on a transactional mail', !/unsubscribe/i.test(W.body(cm)));
await W.admin('POST', '/api/admin/attendees/waitlist', { ids: [asha], decision: 'waitlisted', slot: 'ignored' });
row = W.row(asha);
check('back on the list: the slot gone', row.entry_status === 'waitlisted' && row.entry_slot === null);
await W.admin('POST', '/api/admin/attendees/waitlist', { ids: [asha], decision: 'clear' });
row = W.row(asha);
check('mark taken off: an ordinary free pass', row.entry_status === null && row.entry_decided_at === null && (await W.hit('GET', '/api/my-pass-token', undefined, asAsha)).status === 200);
check('an unknown decision is refused', (await W.admin('POST', '/api/admin/attendees/waitlist', { ids: [asha], decision: 'maybe' })).status === 400);
check('no selection is refused', (await W.admin('POST', '/api/admin/attendees/waitlist', { ids: [], decision: 'confirmed' })).status === 400);
check('the decision route is admin only', (await W.hit('POST', '/api/admin/attendees/waitlist', { ids: [asha], decision: 'confirmed' })).status === 401);

// ---- the rest of the world ----
const tb = await W.hit('GET', '/api/my-pass-token', undefined, W.as(before));
check('registered before the switch: the pass still issues', tb.status === 200 && !!tb.json.token);
await W.setSwitch(false);
r = await W.register({ email: 'after@gmail.com', mobile: '+91 98200 00005' });
await settle();
check('switch off again: an ordinary registration with the welcome', r.status === 201 && !r.json.entry_status && W.mailTo('after@gmail.com').some(m => /You are registered/.test(m.Content.Subject)));

done();
