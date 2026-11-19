// Exhibitors give Visitor Passes from their dashboard (19 Nov 2026, src/routes/team-guests.ts,
// /api/mp/dashboard/guests). The organiser: "give option to all exhibitors to issue visitor
// passes from their dashboard", "upload csv, excel or type individual ones". On the built
// worker with real SQLite and the production schema (login-world.mjs):
//  - only a signed-in account of a Mumbai exhibitor may; nobody, a plain company, a Delhi
//    exhibitor are refused (the dashboard gets { eligible: false } and hides the menu item);
//  - always a Visitor Pass, free, never waitlisted, whatever is typed or a sheet says;
//  - the message says who invited them and the booth, signed by the company; Send by email;
//  - one mobile, one attendee, and an exhibitor is never told who holds a number or email;
//  - a sheet: rows added, the same number twice once, bad rows skipped with the reason;
//  - the company's limit (100, or app_settings.exhibitor_guest_limit) stops a form and a sheet;
//  - each company sees and marks only its own; the guest's pass page opens; the desk scans VALID;
//  - the organising team's own door still works and the two doors do not open each other.
// Run after `npm run build`:  node scripts/verify/smoke-exhibitor-guest.mjs
import crypto from 'node:crypto';
import { makeWorld, checker, ADMIN } from './login-world.mjs';
const { check, fails } = checker();
const MP = 'smoke-mp';
const W = await makeWorld({ extraEnv: { MP_SESSION_SECRET: MP } });
const { hit, q, as, db } = W;
const mpAs = (companyId) => ({ Cookie: 'mp_session=' + companyId + '.' + crypto.createHmac('sha256', MP).update(String(companyId)).digest('hex') });

// ---- seed ----
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (2, 'Bharat AI Delhi', '2027-07-28', '2027-07-29')");
const exhibitor = (id, name, ev = 1, booth = '') => db.run('INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (?, ?, ?, ?, ?)', [id, ev, name, 'spoc' + id + '@ex.test', booth]);
const stand = (exId, code) => {
  db.run("INSERT INTO booths (event_id, code, type_key, name, dim) VALUES (1, ?, 'explorer', 'Explorer Booth', '2m x 2m')", [code]);
  const boothId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  db.run("INSERT INTO booth_allocations (event_id, booth_id, exhibitor_id, company_name, contact_name, status) VALUES (1, ?, ?, 'x', 'Contact', 'confirmed')", [boothId, exId]);
};
const account = (id, name, exId) => db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (?, ?, ?, '', ?)", [id, name, 'acct' + id + '@ex.test', exId]);
exhibitor(1, 'Explorer Co'); stand(1, '21'); account(1, 'Explorer Co', 1); account(11, 'Explorer Co', 1);   // two accounts, one company
exhibitor(2, 'Other AI', 1, 'B7'); account(2, 'Other AI', 2);                                             // booth only typed on the row
exhibitor(3, 'Delhi Only', 2); account(3, 'Delhi Only', 3);
account(9, 'Just A Company', null);
const person = (id, o = {}) => {
  const r = { id, event_id: 1, name: 'Person ' + id, email: 'p' + id + '@example.com', mobile: '', badge_type: 'Visitor Pass', payment_status: 'paid', registration_source: 'website', main_event: 1, ...o };
  const k = Object.keys(r);
  db.run(`INSERT INTO attendees (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, k.map(x => r[x]));
  return id;
};
const ASHA = person(501, { name: 'Asha Rao', email: 'asha@example.com', mobile: '9820012345' });
const ANITA = person(108, { name: 'Anita Ram', email: 'anita.r@bharataiinnovation.com', badge_type: 'Organiser', payment_status: 'waived' });
const who = (id) => q('SELECT * FROM attendees WHERE id = ?', id)[0];
const BASE = '/api/mp/dashboard/guests';
const add = (body, acct = 1) => hit('POST', BASE, body, mpAs(acct));

// ---- who may ----
let r = await hit('GET', BASE);
check('nobody signed in: 401', r.status === 401, r.status + ' ' + r.text);
r = await hit('POST', BASE, { name: 'Guest One', mobile: '9876543210' });
check('nobody signed in cannot add', r.status === 401);
r = await hit('GET', BASE, undefined, mpAs(9));
check('a company with no booth: not eligible, so the dashboard hides it', r.status === 200 && r.json?.eligible === false, r.text);
r = await add({ name: 'Guest One', mobile: '9876543210' }, 9);
check('and cannot add', r.status === 403, r.status + ' ' + r.text);
r = await hit('GET', BASE, undefined, mpAs(3));
check('a Delhi exhibitor: not eligible (the pass and dates are Mumbai\'s)', r.status === 200 && r.json?.eligible === false, r.text);
r = await hit('GET', BASE, undefined, as(ANITA));
check('an app sign-in (even the team\'s) does not open the exhibitor door', r.status === 401, r.status);
r = await hit('POST', '/api/team/guests', { name: 'Guest One', mobile: '9876543210' }, mpAs(1));
check('an exhibitor cannot use the team\'s door', r.status === 401, r.status);
check('nothing was written', q("SELECT COUNT(*) AS n FROM attendees WHERE registration_source LIKE 'exhibitor:%'")[0].n === 0);

r = await hit('GET', BASE, undefined, mpAs(1));
check('an exhibitor sees the limit, nothing used, and the booth from the confirmed stand', r.status === 200 && r.json?.eligible === true && r.json.limit === 100 && r.json.used === 0 && r.json.left === 100 && r.json.booth === '21' && r.json.company === 'Explorer Co', r.text);
check('with a preview of the message', /Explorer Co invited you: visit them at Booth 21\./.test(r.json?.message_preview || ''), r.json?.message_preview);

// ---- one guest ----
r = await add({ name: 'Meera Iyer', mobile: '98765 43210', pass: 'vip', company: 'Iyer Foods', email: 'meera@iyer.in' });
const g1 = r.json?.guest, m = who(g1?.id);
check('typed "vip", still a Visitor Pass', r.status === 201 && g1?.badge_type === 'Visitor Pass' && m?.badge_type === 'Visitor Pass', r.status + ' ' + r.text);
check('free, no lunch, for the event, not waitlisted, the company\'s source', m.payment_status === 'paid' && m.lunch_inclusion === 'No' && m.main_event === 1 && m.entry_status == null && m.registration_source === 'exhibitor:1' && m.email === 'meera@iyer.in', JSON.stringify(m));
const log = W.rows('exhibitor.guest', g1?.id);
check('the log names the company as an exhibitor', log.length === 1 && log[0].actor === 'Explorer Co' && log[0].actor_kind === 'exhibitor' && JSON.parse(log[0].detail || '{}').exhibitor_id === 1, JSON.stringify(log));
check('the message: who invited them, the booth, signed by the company', g1.message.startsWith('Hello Meera,') && g1.message.includes('Your Visitor Pass for Bharat AI Innovation 2026 is ready.\nExplorer Co invited you: visit them at Booth 21.\n20-21 Nov 2026')
  && g1.message.includes('\n' + g1.pass_url + '\n') && g1.message.endsWith('\nExplorer Co') && !g1.message.includes('Bharat AI Innovation team'), g1.message);
check('WhatsApp and email links carry the message', g1.whatsapp_url.startsWith('https://wa.me/919876543210?text=') && g1.email_url.startsWith('mailto:meera%40iyer.in?subject=') && decodeURIComponent(g1.email_url.split('&body=')[1]) === g1.message, g1.email_url.slice(0, 80));
check('no email went anywhere from us', W.sent.length === 0, W.sent.length);
r = await add({ name: 'Ravi Kumar', mobile: '9123456789' }, 2);
check('a booth typed only on the exhibitor row is used; no email, no email link', r.status === 201 && r.json.guest.message.includes('Other AI invited you: visit them at Booth B7.') && r.json.guest.email_url === '' && who(r.json.guest.id).email === 'wa919123456789@no-email.invalid', r.text);
const other1 = r.json.guest;

// ---- one mobile, one attendee; nobody named ----
r = await add({ name: 'Meera I', mobile: '+91-98765-43210' }, 11);
check('the same number from the company\'s other account: their link back, to send again', r.status === 409 && r.json?.guest?.id === g1.id && r.json.guest.pass_url === g1.pass_url, r.status + ' ' + r.text);
r = await add({ name: 'Someone', mobile: '98200 12345' });
check('a number someone registered themselves with: refused, nobody named, no link', r.status === 409 && r.json?.guest === null && r.json?.holder === null && !r.text.includes('Asha') && /already registered for the event/.test(r.json?.error || ''), r.text);
r = await add({ name: 'Ravi Again', mobile: '9123456789' });
check('another exhibitor\'s guest: refused, not named, no link', r.status === 409 && r.json?.guest === null && !r.text.includes('Ravi Kumar'), r.text);
r = await add({ name: 'Asha Two', mobile: '9811111111', email: 'ASHA@example.com' });
check('an email already on the list: the same', r.status === 409 && r.json?.holder === null && !r.text.includes('Asha Rao'), r.text);
r = await add({ name: 'X', mobile: '9811111111' });
check('a one-letter name is refused', r.status === 400 && r.json?.field === 'name');
r = await add({ name: 'Guest X', mobile: '12345' });
check('a short number is refused', r.status === 400 && r.json?.field === 'mobile');

// ---- a sheet ----
r = await hit('POST', BASE + '/bulk', { default_pass: 'vip', rows: [
  { 'Full Name': 'Sunil Shah', 'Mobile No.': '9000000011', Category: 'VIP', Company: 'Shah Steel', Designation: 'MD' },
  { 'Full Name': 'Sunil S', 'Mobile No.': '+91 90000 00011' },
  { 'Full Name': 'No Phone', 'Mobile No.': '' },
  { 'Full Name': 'Kiran Rao', 'Mobile No.': '9000000012', 'Email ID': 'kiran@rao.in' },
] }, mpAs(1));
const res = r.json?.results || [];
check('a sheet: two added, the same number twice once, a row with no number skipped', r.status === 201 && r.json.counts.added === 2 && r.json.counts.already === 1 && r.json.counts.skipped === 1 && res[2].status === 'skipped' && /mobile/.test(res[2].reason), r.text.slice(0, 400));
const sunil = who(res[0].guest?.id);
check('the sheet\'s "VIP" category and default are ignored: Visitor Pass', sunil?.badge_type === 'Visitor Pass' && sunil.payment_status === 'paid' && sunil.company === 'Shah Steel' && sunil.job_title === 'MD', JSON.stringify(sunil));
check('the sheet is logged for the company', W.rows('exhibitor.guest.sheet').length === 1 && W.rows('exhibitor.guest.sheet')[0].actor_kind === 'exhibitor');
r = await hit('GET', BASE + '/template.csv', undefined, mpAs(1));
check('the blank sheet: headings only, no Pass column, no example people', r.status === 200 && r.text === 'Name,Mobile,Organisation,Designation,Email\r\n' && /guest-list\.csv/.test(r.headers.get('content-disposition') || ''), JSON.stringify(r.text));

// ---- the limit ----
db.run("INSERT INTO app_settings (key, value) VALUES ('exhibitor_guest_limit', '4')");
r = await hit('GET', BASE, undefined, mpAs(1));
check('the setting changes the limit; 3 used, 1 left', r.json?.limit === 4 && r.json.used === 3 && r.json.left === 1, r.text.slice(0, 200));
r = await hit('POST', BASE + '/bulk', { rows: [{ Name: 'Last One', Mobile: '9000000013' }, { Name: 'Too Many', Mobile: '9000000014' }, { Name: 'Also Too Many', Mobile: '9000000015' }] }, mpAs(1));
check('a sheet past the limit: the first added, the rest stopped with the reason', r.status === 201 && r.json.counts.added === 1 && r.json.counts.skipped === 2 && /the most one exhibitor can give/.test(r.json.stopped || '') && r.json.results[2].reason === r.json.stopped, r.text.slice(0, 400));
r = await add({ name: 'One More', mobile: '9000000016' }, 11);
check('the form too, from any account of the company', r.status === 429 && /Explorer Co has given 4 Visitor Passes/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await add({ name: 'Other Guest', mobile: '9000000017' }, 2);
check('another company has its own count', r.status === 201, r.status);

// ---- each company its own ----
r = await hit('GET', BASE, undefined, mpAs(11));
const names = (r.json?.guests || []).map(x => x.name);
check('both accounts of a company see the same list, newest first', names.join('|') === 'Last One|Kiran Rao|Sunil Shah|Meera Iyer', names.join('|'));
r = await hit('POST', BASE + '/' + other1.id + '/sent', {}, mpAs(1));
check('a company cannot mark another\'s guest', r.status === 404, r.status);
r = await hit('POST', BASE + '/' + g1.id + '/sent', {}, mpAs(1));
check('marks its own sent', r.status === 200 && r.json?.sent === true && !!r.json.sent_at, r.text);
r = await hit('GET', BASE, undefined, mpAs(1));
check('the list shows it sent', r.json?.guests.find(x => x.id === g1.id)?.sent_at && r.json.counts.sent === 1 && r.json.counts.to_send === 3, JSON.stringify(r.json?.counts));
r = await hit('POST', BASE + '/' + g1.id + '/unsent', {}, mpAs(1));
check('and Undo', r.status === 200 && r.json?.sent === false);
const sentLog = W.rows('team.guest.sent', g1.id);
check('the tap is logged as the exhibitor', sentLog.length === 1 && sentLog[0].actor_kind === 'exhibitor', JSON.stringify(sentLog));

// ---- the guest's page and the desk ----
const tok = g1.pass_url.split('/pass/')[1];
let p = await hit('GET', '/pass/' + tok);
check('the guest opens their pass page', p.status === 200 && p.text.includes('Your pass, Meera') && !p.text.includes('98765') && !p.text.includes('Reply on WhatsApp'), p.status);
p = await hit('GET', '/verify/' + tok, undefined, ADMIN);
check('the desk scans it VALID PASS', p.status === 200 && p.text.includes('VALID PASS') && p.text.includes('Meera Iyer'), p.text.slice(0, 200));

// ---- the team's door is unchanged ----
r = await hit('POST', '/api/team/guests', { name: 'Team Guest', mobile: '9555500000', pass: 'vip' }, as(ANITA));
check('the team still gives a complimentary VIP Pass, signed as the team', r.status === 201 && who(r.json.guest.id).badge_type === 'VIP Pass' && r.json.guest.message.endsWith('Anita Ram, Bharat AI Innovation team') && !r.json.guest.message.includes('invited you'), r.text.slice(0, 300));
r = await hit('GET', BASE, undefined, mpAs(1));
check('a team guest never shows on an exhibitor\'s list', !(r.json?.guests || []).some(x => x.name === 'Team Guest'));

// ---- the dashboard page ----
p = await hit('GET', '/marketplace/dashboard');
check('the dashboard has the Visitor passes menu item and loads the sheet', p.status === 200 && p.text.includes('id="dash-nav-guests"') && p.text.includes('/static/team-guest.js?v=20261119') && p.text.includes('id="section-guests"'), p.status);

console.log(fails() ? `\n${fails()} FAILED` : '\nall passed');
process.exit(fails() ? 1 : 0);
