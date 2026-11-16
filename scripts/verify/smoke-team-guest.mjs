// A guest with only a mobile number (16 Nov 2026): the organising team registers them in
// the app and sends the pass on WhatsApp (src/routes/team-guests.ts). On the built worker
// with real SQLite and the production schema (login-world.mjs):
//  - only a signed-in Organiser pass holder may; nobody signed in, or anyone else, is refused;
//  - the number as people type it (spaces, +91, a leading 0, another country), and what is not one;
//  - a Visitor Pass free, a Delegate or VIP Pass complimentary with lunch; the stand-in address;
//  - the WhatsApp message and link; the same number again; someone who registered themselves;
//  - the guest's pass page: their pass only, nobody else's, escaped; the desk scans it VALID;
//  - no email ever goes to a stand-in address (admin sends, urgent announcements, campaigns),
//    and the register form says "the team sent it on WhatsApp", not a masked stand-in.
// Run after `npm run build`:  node scripts/verify/smoke-team-guest.mjs
import { makeWorld, checker, ADMIN, settle } from './login-world.mjs';
const { check, fails } = checker();
const W = await makeWorld();
const { hit, q, as, sent } = W;

const person = (id, o = {}) => {
  const r = { id, event_id: 1, name: 'Person ' + id, email: 'p' + id + '@example.com', mobile: '', badge_type: 'Visitor Pass',
    payment_status: 'paid', registration_source: 'website', main_event: 1, ...o };
  const k = Object.keys(r);
  W.db.run(`INSERT INTO attendees (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, k.map(x => r[x]));
  return id;
};
const who = (id) => q('SELECT * FROM attendees WHERE id = ?', id)[0];
const ANITA = person(108, { name: 'Anita Ram', email: 'anita.r@bharataiinnovation.com', badge_type: 'Organiser', payment_status: 'waived' });
const RAVI = person(368, { name: 'Ravi Team', email: 'ravi@bharataiinnovation.com', badge_type: 'Organiser', payment_status: 'waived' });
const ASHA = person(501, { name: 'Asha Rao', email: 'asha@example.com', mobile: '9820012345' });
const NOTEAM = person(502, { name: 'Vik Delegate', email: 'vik@example.com', badge_type: 'Delegate Pass' });
const add = (body, id = ANITA) => hit('POST', '/api/team/guests', body, as(id));

// ---- who may ----
let r = await hit('POST', '/api/team/guests', { name: 'Guest One', mobile: '9876543210' });
check('nobody signed in is refused', r.status === 401, r.status + ' ' + r.text);
r = await add({ name: 'Guest One', mobile: '9876543210' }, NOTEAM);
check('a Delegate who is not on the team is refused', r.status === 403 && /organising team/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await hit('GET', '/api/team/guests', undefined, as(NOTEAM));
check('and cannot list anyone\'s guests', r.status === 403);
check('nothing was written', q("SELECT COUNT(*) AS n FROM attendees WHERE registration_source LIKE 'team:%'")[0].n === 0);

// ---- the number ----
for (const [typed, ok] of [['12345', false], ['98765', false], ['5876543210', false], ['+91 5876543210', false], ['abcdefghij', false], ['', false]]) {
  r = await add({ name: 'Guest X', mobile: typed });
  check('"' + typed + '" is not a mobile number', r.status === 400 && r.json?.field === 'mobile', r.status + ' ' + r.text);
}
r = await add({ name: 'G', mobile: '9876543210' });
check('a one-letter name is refused, pointing at the name', r.status === 400 && r.json?.field === 'name');
r = await add({ name: 'Guest X', mobile: '9876543210', pass: 'organiser' });
check('only the three passes may be given', r.status === 400 && r.json?.field === 'pass');
r = await add({ name: 'Guest X', mobile: '9876543210', email: 'not-an-email' });
check('a mistyped email is refused, pointing at the email', r.status === 400 && r.json?.field === 'email');

// ---- a Visitor Pass, mobile only ----
r = await add({ name: '  Meera   Iyer ', mobile: '098765 43210', company: 'Iyer Foods', job_title: 'Owner' });
const g1 = r.json?.guest;
check('a Visitor Pass for a guest with only a mobile', r.status === 201 && g1?.badge_type === 'Visitor Pass', r.status + ' ' + r.text);
const m = who(g1?.id);
check('the row: name tidied, +91 number, the stand-in address', m?.name === 'Meera Iyer' && m.mobile === '+91 98765 43210' && m.email === 'wa919876543210@no-email.invalid', JSON.stringify(m));
check('free, no lunch, for the conference, out of mailings, and who registered them', m.payment_status === 'paid' && m.lunch_inclusion === 'No' && m.main_event === 1 && m.marketing_consent === 0 && m.registration_source === 'team:' + ANITA, JSON.stringify(m));
const log = W.rows('team.guest', g1?.id);
check('the log names the team member who did it', log.length === 1 && log[0].actor === 'Anita Ram' && log[0].actor_kind === 'team', JSON.stringify(log));
check('WhatsApp opens on their number with the message', g1.whatsapp_url.startsWith('https://wa.me/919876543210?text=') && decodeURIComponent(g1.whatsapp_url.split('text=')[1]) === g1.message);
check('the message: their first name, the pass, the dates, the link, who sent it', /^Hello Meera,/.test(g1.message) && g1.message.includes('Your Visitor Pass for Bharat AI Innovation 2026 is ready.')
  && g1.message.includes('20-21 Nov 2026, WTC Mumbai') && g1.message.includes('\n' + g1.pass_url + '\n') && g1.message.includes('government photo ID') && g1.message.endsWith('Anita Ram, Bharat AI Innovation team'), g1.message);
check('the link is /pass/<signed token> on this site', /^https:\/\/bharataiinnovation\.com\/pass\/\d+\.[0-9a-f]{24}$/.test(g1.pass_url), g1.pass_url);
check('an SMS link too, and the number as people read it', g1.sms_url.startsWith('sms:+919876543210?&body=') && g1.mobile === '+91 98765 43210');
check('no email went anywhere', sent.length === 0, sent.length);

// ---- the same number, typed another way ----
r = await add({ name: 'Meera I', mobile: '+91-98765-43210' }, RAVI);
check('the same number again is not a second guest: their pass link comes back to send again', r.status === 409 && r.json?.code === 'already_registered' && r.json?.guest?.id === g1.id && r.json.guest.pass_url === g1.pass_url, r.status + ' ' + r.text);
check('and the message is signed by whoever sends it now', r.json?.guest?.message.endsWith('Ravi Team, Bharat AI Innovation team'));
r = await add({ name: 'Someone', mobile: '98200 12345' });
check('a number someone registered themselves with: no second row, and no link to their pass', r.status === 409 && r.json?.guest === null && r.json?.holder?.name === 'Asha Rao' && /open it in the app/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await add({ name: 'Asha Again', mobile: '9811111111', email: 'ASHA@example.com' });
check('an email already on the list: the same', r.status === 409 && r.json?.holder?.name === 'Asha Rao' && r.json?.guest === null, r.status + ' ' + r.text);

// ---- complimentary passes ----
r = await add({ name: 'Dr. Kavita Shah', mobile: '9123456789', pass: 'vip' });
const g2 = r.json?.guest, v = who(g2?.id);
check('a VIP Pass, complimentary, with lunch', r.status === 201 && v?.badge_type === 'VIP Pass' && v.payment_status === 'waived' && v.lunch_inclusion === 'Yes', JSON.stringify(v));
check('the message says it is complimentary, and greets "Dr. Shah", not "Dr."', g2.message.includes('Your complimentary VIP Pass for Bharat AI Innovation 2026 is ready.') && g2.message.startsWith('Hello Dr. Shah,'), g2.message);
r = await add({ name: 'Arun Mehta', mobile: '+91 9000000001', pass: 'delegate', email: 'arun@mehta.in', company: 'Mehta & Co' }, RAVI);
const g3 = r.json?.guest, d = who(g3?.id);
check('a Delegate Pass, complimentary, with lunch, and the email they gave', r.status === 201 && d?.badge_type === 'Delegate Pass' && d.payment_status === 'waived' && d.lunch_inclusion === 'Yes' && d.email === 'arun@mehta.in' && d.marketing_consent === null, JSON.stringify(d));
r = await add({ name: 'John Smith', mobile: '+44 7700 900123' });
check('a number outside India keeps its country code', r.status === 201 && r.json.guest.whatsapp_url.startsWith('https://wa.me/447700900123?') && who(r.json.guest.id).mobile === '+447700900123', r.text);

// ---- each team member sees their own ----
r = await hit('GET', '/api/team/guests', undefined, as(ANITA));
const mine = (r.json?.guests || []).map(x => x.name);
check('Anita sees the guests she registered, newest first', r.status === 200 && mine.join('|') === 'John Smith|Dr. Kavita Shah|Meera Iyer', mine.join('|'));
r = await hit('GET', '/api/team/guests', undefined, as(RAVI));
check('Ravi sees his own only', (r.json?.guests || []).map(x => x.name).join('|') === 'Arun Mehta');

// ---- the guest's page ----
const tok = g1.pass_url.split('/pass/')[1];
let p = await hit('GET', '/pass/' + tok);
check('the guest opens their pass', p.status === 200 && p.text.includes('Your pass, Meera') && p.text.includes('/js/pass-render.js?v=') && p.text.includes('/static/guest-pass.js?v='), p.status);
const data = JSON.parse((p.text.match(/<script type="application\/json" id="gp-data">([\s\S]*?)<\/script>/) || [])[1] || '{}');
check('the page carries what the pass prints, and the token for its QR', data.token === tok && data.pass?.name === 'Meera Iyer' && data.pass.badge_type === 'Visitor Pass' && data.pass.company === 'Iyer Foods' && data.pass.id === g1.id, JSON.stringify(data));
check('nothing private on the page: no mobile, no address', !p.text.includes('98765') && !p.text.includes('no-email.invalid'));
check('not kept, not indexed', p.headers.get('cache-control') === 'no-store' && /noindex/.test(p.headers.get('x-robots-tag') || ''));
const deskView = await hit('GET', '/verify/' + tok, undefined, ADMIN);
check('the desk scans it VALID PASS (the same token the QR carries)', deskView.status === 200 && deskView.text.includes('VALID PASS') && deskView.text.includes('Meera Iyer'), deskView.text.slice(0, 300));
const vipTok = g2.pass_url.split('/pass/')[1];
const asAdminVerify = await hit('GET', '/verify/' + vipTok, undefined, ADMIN);
check('to the desk the complimentary VIP Pass reads VALID PASS', asAdminVerify.text.includes('VALID PASS') && asAdminVerify.text.includes('Dr. Kavita Shah'), asAdminVerify.text.slice(0, 300));
const ashaTok = (await hit('GET', '/api/my-pass-token?id=' + ASHA, undefined, ADMIN)).json?.token;
p = await hit('GET', '/pass/' + ashaTok);
check('somebody else\'s pass token opens nothing here', !!ashaTok && p.status === 404 && !p.text.includes('Asha'), p.status);
p = await hit('GET', '/pass/' + g1.id + '.000000000000000000000000');
check('a forged token opens nothing', p.status === 404 && !p.text.includes('Meera'));
r = await add({ name: 'Evil </script><script>alert(1)</script>', mobile: '9555555555' });
p = await hit('GET', r.json.guest.pass_url.replace('https://bharataiinnovation.com', ''));
check('a name with markup cannot break out of the page', r.status === 201 && !p.text.includes('<script>alert(1)') && p.text.includes('\\u003c/script>'), p.text.slice(p.text.indexOf('gp-data'), p.text.indexOf('gp-data') + 200));

// ---- never an email to a stand-in address ----
r = await hit('POST', '/api/admin/attendees/' + g1.id + '/notify', {}, ADMIN);
check('Admin\'s envelope on a WhatsApp guest says why instead of sending', r.status === 400 && /mobile number only/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/attendees/' + g1.id + '/send-profile-reminder', {}, ADMIN);
check('the profile reminder the same', r.status === 400 && /mobile number only/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/events/1/broadcast', { title: 'Hall change', content: 'Moved to Kalam Theatre', announcement_type: 'urgent', email_it: true }, ADMIN);
const urgentTo = (r.json?.recipients || []).map(x => x.email);
check('an urgent announcement goes to every pass holder but the stand-in addresses', r.status === 201 && urgentTo.includes('asha@example.com') && urgentTo.includes('arun@mehta.in') && !urgentTo.some(e => e.endsWith('@no-email.invalid')), r.status + ' ' + JSON.stringify(urgentTo));
W.db.run("UPDATE attendees SET marketing_consent = NULL WHERE id = ?", [g2.id]); // consent alone must not be what keeps them out
r = await hit('POST', '/api/admin/events/1/broadcast', { title: 'Workshops open', content: 'Book a seat', announcement_type: 'general', email_it: true }, ADMIN);
const campaignTo = (r.json?.recipients || []).map(x => x.email);
check('a campaign (suppressionClause) leaves them out by their address too', r.status === 201 && campaignTo.includes('arun@mehta.in') && !campaignTo.some(e => e.endsWith('@no-email.invalid')), r.status + ' ' + JSON.stringify(campaignTo));
check('still no email to any stand-in address', !sent.some(s => JSON.stringify(s.Recipients || {}).includes('no-email.invalid')), JSON.stringify(sent.map(s => s.Recipients)));

// ---- the guest tries the register form with that number ----
r = await hit('POST', '/api/events/1/attendees/register', { name: 'Meera Iyer', email: 'meera@iyerfoods.in', mobile: '9876543210', company: 'Iyer Foods', job_title: 'Owner', city: 'Mumbai', industry: 'Food', badge_type: 'Visitor Pass' });
await settle(100);
check('registering herself with that number: told the team sent it on WhatsApp, not a masked stand-in', r.status === 409 && r.json?.code === 'mobile_guest_pass' && /WhatsApp/.test(r.json?.error || '') && !(r.text || '').includes('no-email.invalid'), r.status + ' ' + r.text);

// ---- the app ----
const appJs = (await hit('GET', '/app.js')).text;
check('the app offers "Register a guest" to the team only, from the account menu', appJs.includes("(isTeamMember() ? item('fa-user-plus', 'Register a guest'") && appJs.includes("String(currentUser.badge_type || '') === 'Organiser'") && appJs.includes("s.src = '/static/team-guest.js?v="));

console.log(fails() ? `\n${fails()} FAILED` : '\nAll team-guest checks passed');
process.exit(fails() ? 1 : 0);
