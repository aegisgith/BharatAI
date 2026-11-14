// Unit checks for the free-pass waiting list (0056, 12 Nov 2026), each rule alone:
//  1. the switch: /api/payments/config says free_pass_waitlist only for '1';
//  2. the entry rule, as a table through the desk scan: the mark counts only on a free pass;
//  3. the offline roster codes: 0 admit, 1 payment pending, 2 panel only, 3 waiting list;
//  4. the sanitiser: entry_status is one of two words or nothing, entry_slot at most 80 characters;
//  5. the words on /register and /passes, switch off and on, in the organiser's words;
//  6. the admin page's own functions, lifted from the /admin.js this build serves;
//  7. a database without 0056: the switch is ignored and Admin says not ready;
//  8. (13 Nov 2026) the profile: the app asks a waitlisted Visitor for LinkedIn too, Confirm
//     counts who finished (photo, LinkedIn, organisation, designation, city), the tag goes first.
// Run after `npm run build`:  node scripts/verify/unit-waitlist.mjs
import vm from 'node:vm';
import { waitlistWorld, ADMIN, WAITLIST_TEXT, WAITLIST_UPSELL } from './waitlist-world.mjs';
import { checker } from './talks-world.mjs';
const { check, done } = checker();

// ---- 1. the switch ----
const W = await waitlistWorld({ on: false });
const cfg = async () => (await W.hit('GET', '/api/payments/config')).json;
check('switch: off -> free_pass_waitlist false', (await cfg()).free_pass_waitlist === false);
for (const [v, want] of [['1', true], ['0', false], ['yes', false], ['on', false], ['', false], ['1', true]]) {
  await W.hit('PUT', '/api/admin/settings', { free_pass_waitlist: v }, ADMIN);
  check(`switch: '${v}' -> ${want}`, (await cfg()).free_pass_waitlist === want);
}

// ---- 2. the entry rule, as a table ----
const TABLE = [
  ['a free Visitor Pass on the list', { badge_type: 'Visitor Pass', entry_status: 'waitlisted' }, 'waitlisted', 3],
  ['a free pass written "general"', { badge_type: 'general', entry_status: 'waitlisted' }, 'waitlisted', 3],
  ['a free pass confirmed from the list', { badge_type: 'Visitor Pass', entry_status: 'confirmed' }, 'ok', 0],
  ['a free pass never on the list', { badge_type: 'Visitor Pass', entry_status: null }, 'ok', 0],
  ['a Delegate who paid, the mark left behind', { badge_type: 'Delegate Pass', payment_status: 'paid', entry_status: 'waitlisted' }, 'ok', 0],
  ['a Delegate not paid, on the list', { badge_type: 'Delegate Pass', payment_status: 'pending', entry_status: 'waitlisted' }, 'payment_pending', 1],
  ['an Exhibitor given by hand, the mark left behind', { badge_type: 'Exhibitor', payment_status: 'waived', entry_status: 'waitlisted' }, 'ok', 0],
  ['a panel-only registrant on the list', { badge_type: 'Visitor Pass', entry_status: 'waitlisted', main_event: 0 }, 'panel_only', 2],
];
let id = 100;
const codes = {};
for (const [name, extra, want, code] of TABLE) {
  W.person(++id, extra);
  codes[id] = code;
  const j = await W.scan(id);
  check(`entry rule: ${name} -> ${want}`, j && j.state === want, j);
}

// ---- 3. the roster codes ----
const roster = (await W.admin('GET', '/api/staff/roster')).json;
for (const [pid, code] of Object.entries(codes)) {
  const p = (roster.people || []).find(x => String(x[0]) === pid);
  check(`roster: person ${pid} carries code ${code}`, p && p[3] === code && p.length === 5, p);
}
check('roster: no email or mobile in the saved list', !JSON.stringify(roster).includes('@example.com') && !JSON.stringify(roster).includes('98100'));

// ---- 4. the sanitiser ----
const patch = (body) => W.admin('PATCH', '/api/admin/attendees/104', body);
await patch({ entry_status: 'bogus' });
check('sanitiser: an unknown word is nothing', W.row(104).entry_status === null);
await patch({ entry_status: ' Confirmed ' });
check('sanitiser: spaces and case are forgiven', W.row(104).entry_status === 'confirmed');
await patch({ entry_slot: 'x'.repeat(100) });
check('sanitiser: a slot is at most 80 characters', String(W.row(104).entry_slot).length === 80);
await patch({ entry_slot: '   ' });
check('sanitiser: a blank slot is nothing', W.row(104).entry_slot === null);

// ---- 5. the words on the two pages ----
await W.setSwitch(false);
let reg = (await W.hit('GET', '/register')).text, passes = (await W.hit('GET', '/passes')).text;
check('/register off: one form for everyone, the foot offers the free pass', reg.includes('Tell us who you are') && reg.includes('Continue <i') && reg.includes('for a free Visitor Pass: entry not guaranteed') && !reg.includes('id="rg-wait-note"') && !reg.includes('Join the waiting list'));
check('/passes off: the slot rule', passes.includes('Entry on a free Visitor Pass is not guaranteed') && !passes.includes('full for now'));
await W.setSwitch(true);
reg = (await W.hit('GET', '/register')).text; passes = (await W.hit('GET', '/passes')).text;
check('/register on: the organiser words', reg.includes(WAITLIST_TEXT) && reg.includes(WAITLIST_UPSELL));
check('/register on: the same form, nothing of free or waiting above the button (13 Nov 2026)', reg.includes('Tell us who you are') && reg.includes('Continue <i') && !reg.includes('<h2>Free Visitor Pass: waiting list</h2>') && !reg.includes('id="rg-wait-note"') && !reg.includes('See the paid passes'));
check('/register on: the button is put back in its own words after a refusal', reg.includes("var rfIdleHTML = 'Continue <i") && !reg.includes("btn.innerHTML = 'Register free"));
check('/register on: the success screen knows the mark', reg.includes("data.entry_status === 'waitlisted'") && reg.includes('id="rs-chip-pass"') && reg.includes('id="rs-up-title"'));
check('/passes on: full for now in the lead, the question and the foot', passes.split('Free Visitor Passes are full for now').length - 1 >= 2 && passes.includes('full for now, a new registration joins the waiting list'));
check('/register on: under the title and in the foot, free registration is closed and there is no on-spot registration (14 Nov 2026)', reg.includes('class="rg-closed"') && reg.split('Free registration is closed, and there is no on-spot registration at the venue.').length - 1 >= 3 && !reg.includes('and you join the waiting list.'));

// ---- 6. the admin page's own functions ----
const adminJs = (await W.hit('GET', '/admin.js', undefined, ADMIN)).text;
const lift = (a, b) => { const i = adminJs.indexOf(a), j = adminJs.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('block missing: ' + a); return adminJs.slice(i, j); };
const escH = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attUnpaidTier = (a) => !!a && ['Delegate Pass', 'Premium Delegate Pass', 'VIP Pass', 'Academic Pass'].indexOf(String(a.badge_type || '')) >= 0
  && ['pending', 'refunded'].indexOf(String(a.payment_status || '').trim().toLowerCase()) >= 0;
const hasUploadedPhoto = (u) => { u = String(u || ''); return u.indexOf('data:image/') === 0 || u.indexOf('/api/uploads/') === 0 || /^https?:\/\//.test(u); };
const box = vm.createContext({ String, Number, Math, Set, Object, escH, attUnpaidTier, hasUploadedPhoto, switchSection() {}, attFilters: {}, attPage: 1, lastAttendees: null, attPassLabel: (a) => String(a.badge_type || ''), attIncomplete: () => false });
vm.runInContext(lift('// ============ FREE PASS WAITING LIST (ADMIN) ============', '// ============ END FREE PASS WAITING LIST (ADMIN) ============'), box);
vm.runInContext(lift('function attMatchesFilters(a) {', '// Selection lives across pages'), box);
const F = box;
check('admin fn: a free pass on the list', F.attEntryWaitlisted({ badge_type: 'Visitor Pass', entry_status: 'waitlisted' }) === true);
check('admin fn: a Delegate who paid is not', F.attEntryWaitlisted({ badge_type: 'Delegate Pass', payment_status: 'paid', entry_status: 'waitlisted' }) === false);
check('admin fn: a Delegate not paid is', F.attEntryWaitlisted({ badge_type: 'Delegate Pass', payment_status: 'pending', entry_status: 'waitlisted' }) === true);
check('admin fn: the chip says waiting list', /waiting list/.test(F.attEntryChip({ badge_type: 'Visitor Pass', entry_status: 'waitlisted' })));
check('admin fn: the chip says let in, with the slot', /let in: Day 2/.test(F.attEntryChip({ badge_type: 'Visitor Pass', entry_status: 'confirmed', entry_slot: 'Day 2' })));
check('admin fn: no chip otherwise', F.attEntryChip({ badge_type: 'Visitor Pass' }) === '');
const waiting = { badge_type: 'Visitor Pass', entry_status: 'waitlisted', main_event: 1 }, letIn = { badge_type: 'Visitor Pass', entry_status: 'confirmed', main_event: 1 };
F.attFilters = { entry: 'waitlisted', main: 'yes' };
check('admin filter: Waiting list keeps the waiting, drops the let in', F.attMatchesFilters(waiting) === true && F.attMatchesFilters(letIn) === false);
F.attFilters = { entry: 'confirmed', main: 'yes' };
check('admin filter: Let in keeps the let in, drops the waiting', F.attMatchesFilters(waiting) === false && F.attMatchesFilters(letIn) === true);
F.attFilters = { entry: '', main: 'yes' };
check('admin filter: no filter keeps both', F.attMatchesFilters(waiting) === true && F.attMatchesFilters(letIn) === true);
check('admin page: the Waiting list button, the Entry filter, the Settings card', adminJs.includes('bulkEntry()') && adminJs.includes("setAttFilter('entry'") && adminJs.includes('loadWaitlistCard') && adminJs.includes('openWaitlist()'));

// ---- 8. the profile (13 Nov 2026) ----
const FULL = { avatar_url: '/api/uploads/a.jpg', linkedin_url: 'linkedin.com/in/asha', company: 'Acme', job_title: 'CTO', city: 'Pune' };
check('admin gaps: a finished profile has none', F.attWaitlistGaps(Object.assign({ badge_type: 'Visitor Pass' }, FULL)).length === 0);
check('admin gaps: no photo and no LinkedIn are named', JSON.stringify(F.attWaitlistGaps(Object.assign({ badge_type: 'Visitor Pass' }, FULL, { avatar_url: '', linkedin_url: ' ' }))) === '["photo","LinkedIn"]');
check('admin gaps: a student needs no designation', F.attWaitlistGaps(Object.assign({ badge_type: 'Student Pass' }, FULL, { job_title: '' })).length === 0);
check('admin gaps: organisation, designation and city', JSON.stringify(F.attWaitlistGaps({ badge_type: 'Visitor Pass', avatar_url: 'https://x/y.jpg', linkedin_url: 'x' })) === '["organisation","designation","city"]');
F.lastAttendees = [Object.assign({ id: 1, badge_type: 'Visitor Pass' }, FULL), Object.assign({ id: 2, badge_type: 'Visitor Pass' }, FULL, { linkedin_url: '' }), Object.assign({ id: 3, badge_type: 'Visitor Pass' }, FULL, { avatar_url: '', linkedin_url: '' })];
const fin = F.attWaitlistFinished(['1', '2', '3', '99']);
check('admin confirm: only the finished one is taken', JSON.stringify(fin.ids) === '[1]', fin);
check('admin confirm: three not finished, one of them unseen on the page', fin.unfinished === 3, fin);
check('admin confirm: what they lack, counted', fin.summary === 'no LinkedIn: 2, no photo: 1', fin.summary);
check('admin confirm: the choice is offered, finished only by default', adminJs.includes('bulk-entry-who') && adminJs.includes('<option value="finished">Only the ') && adminJs.includes("!(whoEl && whoEl.value === 'all')"));
check('admin table: the waiting-list tag comes before the pass', adminJs.includes('${attEntryChip(a)}${attPassChip(a, '));
check('admin chip: no leading space now that it comes first', F.attEntryChip({ badge_type: 'Visitor Pass', entry_status: 'waitlisted' }).indexOf('<span') === 0);
const appJs = (await W.hit('GET', '/app.js')).text;
const liftApp = (a, b) => { const i = appJs.indexOf(a), j = appJs.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('app block missing: ' + a); return appJs.slice(i, j); };
const appBox = vm.createContext({ String, currentUser: null });
vm.runInContext(liftApp('function hasUploadedPhoto(u) {', '// A coloured square'), appBox);
vm.runInContext(liftApp('function profileGaps(u) {', '// The subset the Edit Profile dialog'), appBox);
const BASE = { avatar_url: '/api/uploads/a.jpg', company: 'Acme', job_title: 'CTO', city: 'Pune', industry: 'AI', mobile: '9820000000' };
const gapsOf = (x) => JSON.stringify(appBox.profileGaps(Object.assign({}, BASE, x)));
check('app: a waitlisted Visitor without LinkedIn is asked for it', gapsOf({ badge_type: 'Visitor Pass', entry_status: 'waitlisted' }) === '["LinkedIn"]');
check('app: with LinkedIn the profile is finished', gapsOf({ badge_type: 'Visitor Pass', entry_status: 'waitlisted', linkedin_url: 'linkedin.com/in/a' }) === '[]');
check('app: an ordinary Visitor is not asked for LinkedIn', gapsOf({ badge_type: 'Visitor Pass' }) === '[]');
check('app: a paid Delegate with the old mark is not asked', gapsOf({ badge_type: 'Delegate Pass', payment_status: 'paid', entry_status: 'waitlisted' }) === '[]');
check('app: LinkedIn never blocks saving the profile form', appJs.includes("avatar_url: 'data:image/skip',") && appJs.includes("linkedin_url: 'skip',"));
check('app: the pass card asks for the profile', appJs.includes('While you wait, finish your profile with your photo and LinkedIn. We confirm places only for finished profiles.'));
const regOn = (await W.hit('GET', '/register')).text;
check('/register success: the profile first, to the complete-profile link', regOn.includes("wh.setAttribute('href', '/app?action=complete-profile')") && regOn.includes('Finish your profile: add your photo and your LinkedIn'));

// ---- 7. a database without 0056 ----
const P = await waitlistWorld({ migrate: false });
await P.hit('PUT', '/api/admin/settings', { free_pass_waitlist: '1' }, ADMIN);
check('pre-0056: the switch is ignored', (await P.hit('GET', '/api/payments/config')).json.free_pass_waitlist === false);
check('pre-0056: Admin says not ready', (await P.admin('GET', '/api/admin/waitlist')).json.ready === false);
const r = await P.register({ email: 'old@gmail.com', mobile: '+91 98200 30001' });
check('pre-0056: a registration still works, unmarked', r.status === 201 && r.json.entry_status === undefined, r.json);
check('pre-0056: /register is the same form', (await P.hit('GET', '/register')).text.includes('Tell us who you are'));
check('pre-0056: the decision route says why', (await P.admin('POST', '/api/admin/attendees/waitlist', { ids: [r.json.id], decision: 'confirmed' })).status === 503);

done();
