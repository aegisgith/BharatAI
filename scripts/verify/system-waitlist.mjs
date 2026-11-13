// SYSTEM: free passes full, end to end on the built worker on real SQLite (sql.js) with
// migration 0056, the way the organiser and the people will live it (12 Nov 2026):
//  Meera registered a week ago on a free pass. The organiser throws the switch in
//  Settings. Asha registers from /register: the answer puts her on the waiting list,
//  the page she gets says so, the app this build serves knows the state, her waiting-
//  list email arrives with the Delegate button; she says she is coming; there is no
//  pass for her and the desk refuses her. The organiser confirms her with a slot from
//  Attendees; the confirmation goes out as a bulk run moved by the minute clock, with
//  her slot; she downloads her pass; the desk admits her on the day. Meera is untouched
//  throughout. The organiser turns the switch off; Ravi registers as before.
// Run after `npm run build`:  node scripts/verify/system-waitlist.mjs
import { waitlistWorld, ADMIN, CRON, settle, WAITLIST_TEXT, WAITLIST_UPSELL, DESK_TEXT } from './waitlist-world.mjs';
import { checker } from './talks-world.mjs';
const { check, done } = checker();
const W = await waitlistWorld({ on: false });

// Meera, a week ago.
const meera = W.person(50, { name: 'Meera Iyer', email: 'meera@example.com', registration_date: '2026-11-05 10:00:00' });
const meeraPass = async () => (await W.hit('GET', '/api/my-pass-token', undefined, W.as(meera))).status;
check('Meera, before: a pass', await meeraPass() === 200);

// The organiser throws the switch from Settings.
const sw = await W.admin('PUT', '/api/admin/settings', { free_pass_waitlist: '1' });
const st = await W.admin('GET', '/api/admin/waitlist');
check('the organiser throws the switch: Settings shows it on, nobody waiting yet', sw.status === 200 && st.json.ready && st.json.on && st.json.total === 0, st.json);
check('the public pages say so', (await W.hit('GET', '/register')).text.includes('Free Visitor Passes are full. Not ready to pay?') && (await W.hit('GET', '/passes')).text.includes('Free Visitor Passes are full for now') && (await W.hit('GET', '/api/payments/config')).json.free_pass_waitlist === true);
check('Meera, after the switch: still a pass', await meeraPass() === 200);

// Asha registers from /register.
const reg = await W.register({ name: 'Asha Rao', email: 'asha.rao@gmail.com', mobile: '+91 98200 15151' });
await settle();
check('Asha: registered, the answer the page reads carries the mark', reg.status === 201 && reg.json.entry_status === 'waitlisted' && reg.json.name === 'Asha Rao', reg.json);
const asha = reg.json.id;
check('Asha: signed in by the registration itself', /bai_session=/.test(reg.headers.get('set-cookie') || ''));
const appJs = (await W.hit('GET', '/app.js')).text;
check('the app this build serves knows the state', appJs.includes('function isEntryWaitlisted') && appJs.includes(' is on the waiting list') && appJs.includes(WAITLIST_TEXT) && appJs.includes('pcc-download-btn'));
const mail1 = W.mailTo('asha.rao@gmail.com');
check('Asha: the waiting-list email, in the organiser words, with the Delegate button', mail1.length === 1 && /waiting list/.test(mail1[0].Content.Subject) && W.body(mail1[0]).includes(WAITLIST_TEXT) && W.body(mail1[0]).includes(WAITLIST_UPSELL) && /action=pay&pass=delegate/.test(W.body(mail1[0])), mail1.map(m => m.Content.Subject));
const asAsha = W.as(asha);
const rs = await W.hit('POST', '/api/attendees/' + asha + '/rsvp', { status: 'confirmed' }, asAsha);
check('Asha says she is coming: noted, still on the list', rs.status === 200 && W.row(asha).rsvp_status === 'confirmed' && W.row(asha).entry_status === 'waitlisted');
check('Asha: no pass', (await W.hit('GET', '/api/my-pass-token', undefined, asAsha)).status === 403);
const tok = await W.token(asha);
check('the desk refuses Asha', (await W.scan(asha)).state === 'waitlisted' && (await W.admin('POST', '/api/verify/' + tok + '/checkin', {})).status === 400);
check('the Overview counts her', (await W.admin('GET', '/api/admin/events/1/board')).json?.todo?.waitlist?.total === 1);

// The organiser confirms her with a slot; the page then starts the bulk run.
const dec = await W.admin('POST', '/api/admin/attendees/waitlist', { ids: [asha], decision: 'confirmed', slot: 'Day 2, 2 pm to 6 pm' });
const camp = await W.admin('POST', '/api/admin/campaigns', { kind: 'waitlist_confirm', ids: [asha], title: 'Waiting list: place confirmed, 1 people' });
check('the organiser confirms Asha with a slot and starts the run', dec.status === 200 && (camp.status === 200 || camp.status === 201) && !!camp.json.id, { dec: dec.json, camp: camp.json });
// The minute clock moves the run on, no tab open.
const tick = await W.hit('POST', '/api/cron/tick', {}, CRON);
await settle(120);
const mail2 = W.mailTo('asha.rao@gmail.com');
const conf = mail2.find(m => /confirmed/.test(m.Content.Subject));
check('the minute clock sends her confirmation, with the slot', tick.status === 200 && !!conf && W.body(conf).includes('Day 2, 2 pm to 6 pm') && /download-pass/.test(W.body(conf)), { tick: tick.json?.campaigns, subjects: mail2.map(m => m.Content.Subject) });
const run = W.q('SELECT status FROM campaign_recipients WHERE campaign_id = ?', camp.json.id);
check('the run records the send', run.length === 1 && run[0].status === 'sent', run);
check('Asha downloads her pass', (await W.hit('GET', '/api/my-pass-token', undefined, asAsha)).status === 200);
const day = await W.scan(asha);
check('the desk admits Asha on the day', day.state === 'ok' && !!W.row(asha).checked_in_at, day);
check('Settings: nobody waiting, one let in', (await W.admin('GET', '/api/admin/waitlist')).json.total === 0 && (await W.admin('GET', '/api/admin/waitlist')).json.confirmed === 1);
check('Meera, throughout: untouched', await meeraPass() === 200 && W.row(meera).entry_status === null);

// The organiser turns the switch off; Ravi registers as before.
await W.admin('PUT', '/api/admin/settings', { free_pass_waitlist: '0' });
const ravi = await W.register({ name: 'Ravi Menon', email: 'ravi@gmail.com', mobile: '+91 98200 15152' });
await settle();
check('switch off: Ravi registers as before, with the welcome', ravi.status === 201 && !ravi.json.entry_status && W.mailTo('ravi@gmail.com').some(m => /You are registered/.test(m.Content.Subject)));
check('switch off: the pages are back to the slot rule', (await W.hit('GET', '/register')).text.includes('for a free Visitor Pass: entry not guaranteed') && !(await W.hit('GET', '/passes')).text.includes('full for now'));

done();
