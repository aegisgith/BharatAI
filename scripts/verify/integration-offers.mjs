// INTEGRATION level of the last-week offers and the Student Pass (12 Nov 2026), on
// real SQLite with the production schema and the gateway played with CCAvenue's own
// cipher (upgrade-world.mjs). Off, every price is as before; on: Delegate or Premium
// Delegate to VIP for 9,999, an Exhibitor pass to VIP for 4,999 (startup booth) or
// 9,999, the paid Innovation Showcase slot (0058) with its cap, its pass and its talk
// row, the offer emails; and the Student Pass (999, one workshop, half the seats),
// the certificate naming the pass, and the pages that print all of it.
// Run after `npm run build`:  node scripts/verify/integration-offers.mjs
import { readFileSync } from 'node:fs';
import { makeUpgradeWorld, checker, settle, ADMIN, LATE } from './upgrade-world.mjs';

const W = await makeUpgradeWorld();
const { check, fails } = checker();
const { at, person, who, order, ordersOf, start, answer, until, mailTo, setting, hit, q, db, sent, subject, html, as } = W;
const TEAM = 'info@bharataiinnovation.com';
let r, s;
const exec = (file) => db.exec(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8'));
exec('0058_showcase_slots.sql');
// The talk columns production has had since 12 Nov (0052: hall, speaker_email, speaker_phone).
exec('0052_innovation_talk_details.sql');
for (const [k, v] of Object.entries({ inv_legal_name: 'Smoke Organiser Trust', inv_gstin: '27AAATS0000A1Z5', inv_state: 'Maharashtra', inv_state_code: '27', inv_prefix: 'AKT', inv_next_number: '119' })) setting(k, v);
const offers = async (body) => hit('PUT', '/api/admin/offers', body, ADMIN);
const config = async (id) => (await hit('GET', '/api/payments/config', undefined, id ? as(id) : {})).json;

at(LATE);

// ---- 1. off: everything as before ----
let cfg = await config();
check('off: the config carries no offers', cfg && cfg.offers === null, JSON.stringify(cfg && cfg.offers));
check('the Student Pass is a paid pass at 999 on both price lists; the Academic Pass stays 3,999', cfg.passes['Student Pass']?.base === 999 && cfg.late_passes['Student Pass']?.base === 999 && cfg.standard_passes['Student Pass']?.base === 999 && cfg.passes['Academic Pass']?.base === 3999, JSON.stringify([cfg.passes['Student Pass'], cfg.passes['Academic Pass']]));
const D1 = person(1, { name: 'Dev Mehta', email: 'dev@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '10618.82' });
s = await start(D1, 'VIP Pass');
check('off: a paid Delegate moves up to VIP for the difference, 16,000 + GST', s.status === 201 && order(s.json.order_id).base_paise === 1600000, s.status + ' ' + s.text);
const EX = person(2, { name: 'Esha Pod', email: 'esha@example.com', badge_type: 'Exhibitor', payment_status: 'waived' });
r = await start(EX, 'VIP Pass');
check('off: an Exhibitor pass is refused every paid pass', r.status === 409 && /arranged by the organisers/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await hit('GET', '/showcase-slot');
check('off: the showcase page says slots are not open', r.status === 200 && /not open just now/.test(r.text), r.text.slice(0, 200));

// ---- 2. the switch ----
r = await offers({ on: true });
check('Admin turns the offers on', r.status === 200 && r.json.on === true && r.json.active === true, r.text);
r = await hit('GET', '/api/admin/offers', undefined, ADMIN);
check('Admin sees the switch, the prices, the slots and the three audiences', r.status === 200 && r.json.active && r.json.showcase.ready && r.json.showcase.cap === 12 && typeof r.json.audiences.vip_delegates === 'number' && r.json.prices.student === 999, r.text.slice(0, 300));
r = await hit('GET', '/api/admin/offers');
check('and nobody else does', r.status === 401 || r.status === 403, r.status);

// ---- 3. Delegate and Premium Delegate to VIP ----
cfg = await config();
// The VIP move-up prices are never public (organiser, 13 Nov 2026): email, and the holder's own sheet.
check('on: the public config shows no move-up price at all', cfg.offers && Object.keys(cfg.offers.steps).length === 0 && !('exhibitor_vip' in cfg.offers) && cfg.offers.last_day === '2026-11-21' && !/9999|4999/.test(JSON.stringify(cfg.offers)), JSON.stringify(cfg.offers));
const D2 = person(3, { name: 'Kavya Nair', email: 'kavya@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '10618.82' });
cfg = await config(D2);
check('a signed-in paid Delegate sees their own step, 9,999, and only that', JSON.stringify(cfg.offers.steps) === JSON.stringify({ 'Delegate Pass': { 'VIP Pass': 9999 } }), JSON.stringify(cfg.offers.steps));
const VIS = person(15, { name: 'Vis Itor', email: 'visitor@example.com' });
cfg = await config(VIS);
check('a signed-in Visitor sees no move-up price', Object.keys(cfg.offers.steps).length === 0, JSON.stringify(cfg.offers.steps));
s = await start(D2, 'VIP Pass');
check('a paid Delegate is charged 9,999 + 1,799.82 GST = 11,798.82 for VIP', s.status === 201 && s.json.amount === 11798.82 && order(s.json.order_id).base_paise === 999900, s.status + ' ' + s.text);
sent.length = 0;
await answer(s.json.order_id);
await until(() => who(D2).badge_type === 'VIP Pass');
check('paid: a VIP Pass, with what was paid in all', who(D2).badge_type === 'VIP Pass' && who(D2).payment_status === 'paid' && who(D2).payment_amount === '22417.64', JSON.stringify([who(D2).badge_type, who(D2).payment_amount]));
const P1 = person(4, { name: 'Prem Shah', email: 'prem@example.com', badge_type: 'Premium Delegate Pass', payment_status: 'paid' });
s = await start(P1, 'VIP Pass');
check('a paid Premium Delegate is charged 9,999 too (the difference is 10,000)', s.status === 201 && order(s.json.order_id).base_paise === 999900, s.text);
s = await start(D1, 'Premium Delegate Pass');
check('Delegate to Premium Delegate is not on offer: still the difference, 6,000', s.status === 201 && order(s.json.order_id).base_paise === 600000, s.text);

// ---- 4. Exhibitor passes to VIP, priced by the booth ----
db.run("INSERT INTO booths (id, event_id, code, type_key, name) VALUES (1, 1, '90', 'pod', 'Startup Pod'), (2, 1, '20', 'accelerator', 'Enterprise Booth')");
db.run("INSERT INTO exhibitors (id, event_id, company_name, attendee_id) VALUES (11, 1, 'PodCo', ?), (12, 1, 'BigCo', ?)", [EX, person(5, { name: 'Bala Big', email: 'bala@example.com', badge_type: 'Exhibition Speaker', payment_status: 'waived' })]);
db.run("INSERT INTO booth_allocations (event_id, booth_id, exhibitor_id, company_name, status) VALUES (1, 1, 11, 'PodCo', 'confirmed'), (1, 2, 12, 'BigCo', 'confirmed')");
const BIG = 5;
cfg = await config(EX);
check('a signed-in Exhibitor at a Startup Pod sees 4,999 for VIP', cfg.offers.steps['Exhibitor'] && cfg.offers.steps['Exhibitor']['VIP Pass'] === 4999, JSON.stringify(cfg.offers.steps));
check('and the public config names no one\'s booth', !(await config()).offers.steps['Exhibitor'], '');
r = await start(EX, 'Delegate Pass');
check('an Exhibitor pass may buy only the VIP Pass', r.status === 409 && /VIP Pass/.test(r.json?.error || ''), r.text);
s = await start(EX, 'VIP Pass');
check('the startup price: 4,999 + 899.82 GST = 5,898.82', s.status === 201 && s.json.amount === 5898.82 && order(s.json.order_id).previous_badge === 'Exhibitor', s.text);
sent.length = 0;
await answer(s.json.order_id);
await until(() => who(EX).badge_type === 'VIP Pass' && sent.length >= 2);
check('paid: the Exhibitor pass becomes a VIP Pass, paid, with lunch', who(EX).badge_type === 'VIP Pass' && who(EX).payment_status === 'paid' && who(EX).payment_amount === '5898.82' && who(EX).lunch_inclusion === 'Yes', JSON.stringify(who(EX)));
const inv = q('SELECT * FROM invoices WHERE order_ref = ?', s.json.order_id);
check('the receipt says it moved up from the Exhibitor pass', inv.length === 1 && /^Upgrade from Exhibitor to VIP Pass/.test(inv[0].item_desc || ''), JSON.stringify(inv.map(i => i.item_desc)));
check('the buyer is told, and no second welcome', mailTo('esha@example.com').some(p => /your VIP Pass is confirmed/.test(subject(p))) && !mailTo('esha@example.com').some(p => /Welcome|registered/i.test(subject(p))), mailTo('esha@example.com').map(subject).join(' | '));
r = await hit('PUT', '/api/attendees/' + EX + '/exhibitor', { company_name: 'PodCo' }, as(EX));
check('the booth contact, now VIP, can still edit the booth listing', r.status !== 403, r.status + ' ' + r.text.slice(0, 120));
s = await start(BIG, 'VIP Pass');
check('an Exhibition Speaker at an Enterprise Booth pays 9,999 + GST', s.status === 201 && order(s.json.order_id).base_paise === 999900, s.text);

// ---- 5. the Student Pass ----
const ST1 = person(6, { name: 'Sana Student', email: 'sana@example.com', company: 'IIT Bombay', job_title: '' });
s = await start(ST1, 'Student Pass');
check('a free Visitor buys the Student Pass: 999 + 179.82 GST = 1,178.82', s.status === 201 && s.json.amount === 1178.82, s.status + ' ' + s.text);
await answer(s.json.order_id);
await until(() => who(ST1).badge_type === 'Student Pass');
check('paid: a Student Pass, paid, no lunch', who(ST1).badge_type === 'Student Pass' && who(ST1).payment_status === 'paid' && who(ST1).lunch_inclusion === 'No', JSON.stringify(who(ST1)));
db.run("INSERT INTO workshops (id, event_id, slug, title, capacity, is_open, starts_at) VALUES (1, 1, 'w1', 'Prototype to Production', 4, 1, '2026-11-20 14:00'), (2, 1, 'w2', 'CXO Guide', 4, 1, '2026-11-21 14:00')");
r = await hit('GET', '/api/workshops', undefined, as(ST1));
check('the Student Pass includes a workshop seat', r.json && r.json.entitled === true, r.text.slice(0, 200));
const ST2 = person(7, { badge_type: 'Student Pass', payment_status: 'paid' }), ST3 = person(8, { badge_type: 'Student Pass', payment_status: 'paid' });
const AC = person(9, { badge_type: 'Academic Pass', payment_status: 'paid' }), PR = person(10, { badge_type: 'Premium Delegate Pass', payment_status: 'paid' });
r = await hit('POST', '/api/workshops/choose', { workshop_id: 1 }, as(ST1));
const r2 = await hit('POST', '/api/workshops/choose', { workshop_id: 1 }, as(ST2));
check('two students take seats in a 4-seat workshop', r.status === 200 && r2.status === 200 && q('SELECT COUNT(*) AS n FROM workshop_seats WHERE workshop_id = 1')[0].n === 2, r.status + ' ' + r2.status);
r = await hit('GET', '/api/workshops', undefined, as(ST3));
check('a third student sees it full (half the seats are for Premium Delegate and VIP)', r.json.workshops.find(w => w.id === 1).full === true, JSON.stringify(r.json.workshops));
r = await hit('POST', '/api/workshops/choose', { workshop_id: 1 }, as(ST3));
check('and is refused, kindly', r.status === 409 && /student seats/.test(r.json?.error || ''), r.status + ' ' + r.text.slice(0, 160));
r = await hit('POST', '/api/workshops/choose', { workshop_id: 1 }, as(PR));
check('a Premium Delegate still gets a seat there', r.status === 200, r.status + ' ' + r.text.slice(0, 120));
r = await hit('POST', '/api/workshops/choose', { workshop_id: 2 }, as(AC));
check('the Academic Pass has no workshop', r.status === 403 && /Student, Premium Delegate and VIP/.test(r.json?.error || ''), r.status + ' ' + r.text);
s = await start(ST1, 'Delegate Pass');
check('a Student Pass may still move up (the server allows any dearer pass)', s.status === 201 && order(s.json.order_id).base_paise === 800000, s.text);

// ---- 6. the certificate names the pass ----
r = await hit('GET', '/api/attendees/' + ST1 + '/certificate-eligibility', undefined, as(ST1));
check('the certificate gate names the pass: Student Pass', r.json && r.json.pass === 'Student Pass', r.text);
const UNPAID = person(12, { name: 'Unpaid Vip', email: 'unpaid@example.com', badge_type: 'VIP Pass', payment_status: 'pending' });
r = await hit('GET', '/api/attendees/' + UNPAID + '/certificate-eligibility', undefined, as(UNPAID));
check('a VIP Pass not paid for is named as the Visitor Pass', r.json && r.json.pass === 'Visitor Pass', r.text);

// ---- 7. the showcase slot ----
r = await hit('GET', '/showcase-slot');
check('on: the page asks a stranger for their email, with both prices', r.status === 200 && /id="sc-link"/.test(r.text) && r.text.includes('10,000') && r.text.includes('15,000'), r.text.slice(0, 200));
sent.length = 0;
r = await hit('POST', '/api/showcase/link', { email: 'Neha@Startup.example' });
await until(() => sent.length >= 1);
const linkMail = mailTo('neha@startup.example')[0];
const token = decodeURIComponent((html(linkMail).match(/showcase-slot\?t=([^"&]+)/) || [])[1] || '');
check('asking for the link answers the same for anyone, and emails a signed link', r.status === 200 && r.json.ok === true && !!token, r.text + ' ' + sent.map(subject).join('|'));
r = await hit('GET', '/showcase-slot?t=' + encodeURIComponent(token));
check('the link opens the booking form for that address', r.status === 200 && /id="sc-form"/.test(r.text) && r.text.includes('neha@startup.example'), r.text.slice(0, 200));
r = await hit('GET', '/showcase-slot?t=' + encodeURIComponent(token.replace(/.$/, c => (c === '0' ? '1' : '0'))));
check('a link with a wrong signature does not', !/id="sc-form"/.test(r.text), '');
r = await hit('POST', '/api/showcase/start', { t: token, name: 'Neha Rao', company: '', title: 'x' });
check('missing details are refused with the field named', r.status === 400 && r.json.field === 'company', r.text);
r = await hit('POST', '/api/showcase/start', { t: token, name: 'Neha Rao', company: 'VisionStack', designation: 'Founder', mobile: '9876500011', title: 'Seeing defects on the line with a phone camera', summary: 'A live demo on a conveyor sample.' });
check('a booking makes an order for 10,000 + 1,800 GST = 11,800', r.status === 201 && r.json.amount === 11800 && /^\/pay\/ccavenue\//.test(r.json.pay_url), r.status + ' ' + r.text);
const NEHA = Number((q("SELECT id FROM attendees WHERE email = 'neha@startup.example'")[0] || {}).id);
const SO = r.json.order_id;
check('a new person is registered on a Visitor Pass until the money lands', NEHA > 0 && who(NEHA).badge_type === 'Visitor Pass' && order(SO).pass_type === 'Innovation Showcase Slot' && q("SELECT status FROM showcase_slots WHERE order_id = ?", SO)[0]?.status === 'held', JSON.stringify(who(NEHA)));
check('the booking signs them in, as the link proved the address', /bai_session=/.test(r.headers.get('set-cookie') || ''), r.headers.get('set-cookie'));
sent.length = 0;
await answer(SO);
await until(() => q("SELECT status FROM showcase_slots WHERE order_id = ?", SO)[0]?.status === 'paid' && sent.length >= 3);
const talk = q("SELECT * FROM innovation_talks WHERE speaker_email = 'neha@startup.example'");
check('paid: an Exhibition Speaker pass, paid, with lunch', who(NEHA).badge_type === 'Exhibition Speaker' && who(NEHA).payment_status === 'paid' && who(NEHA).lunch_inclusion === 'Yes', JSON.stringify(who(NEHA)));
check('and the talk on the list the team schedules from: no time, the Expo Hall stage, 10 minutes', talk.length === 1 && talk[0].topic === 'Seeing defects on the line with a phone camera' && talk[0].hall === 'Aryabhata Theatre' && Number(talk[0].duration_min) === 10 && talk[0].company === 'VisionStack' && /To be announced/.test(talk[0].time_slot || '') && q("SELECT talk_id FROM showcase_slots WHERE order_id = ?", SO)[0].talk_id === talk[0].id, JSON.stringify(talk));
check('the buyer gets the booking email and a receipt; the team is told', mailTo('neha@startup.example').some(p => /^Booked: your Innovation Showcase slot/.test(subject(p))) && q('SELECT COUNT(*) AS n FROM invoices WHERE order_ref = ?', SO)[0].n === 1 && mailTo(TEAM).some(p => /Showcase slot sold/.test(subject(p))), sent.map(p => W.to(p) + ':' + subject(p)).join(' | '));
r = await hit('GET', '/pay/result?o=' + encodeURIComponent((await answer(SO)).location.split('o=')[1] ? decodeURIComponent((await answer(SO)).location.split('o=')[1]) : ''));
check('the result page says the slot is booked', r.status === 200 && /Your slot is booked/.test(r.text), r.text.slice(0, 200));
r = await hit('GET', '/showcase-slot', undefined, as(NEHA));
check('coming back, they are told their slot is booked', /Your slot is booked/.test(r.text), r.text.slice(0, 160));
const VIPB = person(101, { name: 'Vik Ram', email: 'vik@example.com' });
r = await hit('POST', '/api/showcase/start', { name: 'Vik Ram', company: 'RamAI', title: 'Agents for small shops', option: 'vip' }, as(VIPB));
check('signed in, the slot with a VIP Pass is 15,000 + 2,700 GST = 17,700', r.status === 201 && r.json.amount === 17700 && order(r.json.order_id).pass_type === 'Innovation Showcase Slot + VIP Pass', r.text);
await answer(r.json.order_id);
await until(() => who(VIPB).badge_type === 'VIP Pass');
check('paid: a VIP Pass', who(VIPB).badge_type === 'VIP Pass' && who(VIPB).payment_status === 'paid', JSON.stringify(who(VIPB)));
r = await hit('POST', '/api/showcase/start', { name: 'Vik Ram', company: 'RamAI', title: 'Again', option: 'slot' }, as(VIPB));
check('one slot per person', r.status === 409 && /booked already/.test(r.json?.error || ''), r.text);
r = await offers({ cap: 2 });
const LAST = person(102, { name: 'Late Comer', email: 'late@example.com' });
r = await hit('POST', '/api/showcase/start', { name: 'Late Comer', company: 'LateCo', title: 'Too late a talk' }, as(LAST));
check('the cap: with 2 sold, the next is told every slot is taken, and nothing is held', r.status === 409 && r.json.sold_out === true && q("SELECT COUNT(*) AS n FROM showcase_slots WHERE attendee_id = ?", LAST)[0].n === 0, r.text);
cfg = await config();
check('and the app stops offering slots', cfg.offers.showcase === null, JSON.stringify(cfg.offers.showcase));

// ---- 8. the offer emails ----
r = await hit('GET', '/api/admin/offers/preview?audience=vip_delegates', undefined, ADMIN);
check('the Delegate offer preview names the price and the pass, and has no figure in the subject', r.status === 200 && r.json.html.includes('9,999') && /VIP/.test(r.json.subject) && !/\d,\d{3}/.test(r.json.subject), r.text.slice(0, 200));
r = await hit('GET', '/api/admin/offers/preview?audience=exhibitors', undefined, ADMIN);
check('the Exhibitor offer preview names a price', r.status === 200 && /(4,999|9,999)/.test(r.json.html), r.text.slice(0, 200));
db.run("INSERT INTO inquiries (event_id, inquiry_type, name, email, organization, subject, status) VALUES (1, 'speaking', 'Asha Speaker', 'asha@talks.example', 'TalkCo', 'Speaking request', 'new'), (1, 'speaking', 'Dev Mehta', 'dev@example.com', 'Org 1', 'Speaking request', 'responded')");
r = await hit('GET', '/api/admin/offers/speakers', undefined, ADMIN);
const asha = (r.json.people || []).find(p => p.email === 'asha@talks.example'), devp = (r.json.people || []).find(p => p.email === 'dev@example.com');
check('the speaking requests list ticks a fresh one and not one answered already', asha && asha.ticked === true && devp && devp.ticked === false && devp.flags.includes('answered already'), JSON.stringify(r.json.people));
r = await hit('POST', '/api/admin/campaigns', { kind: 'offer', audience: 'speakers' }, ADMIN);
const camp = r.json;
check('a speakers run is made of the ticked people only', r.status === 201 && camp.total === 1, r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/offers/send?audience=speakers&email=asha%40talks.example&force=1', undefined, ADMIN);
check('with every slot sold, the speaker offer is skipped, not sent', r.status === 200 && r.json.skipped === true && /taken/.test(r.json.reason || ''), r.text);
await offers({ cap: 12 });
sent.length = 0;
r = await hit('POST', '/api/admin/offers/send?audience=speakers&email=asha%40talks.example&force=1', undefined, ADMIN);
await settle(100);
check('one offer email goes, with a booking link', r.status === 200 && mailTo('asha@talks.example').some(p => /Innovation Stage/.test(subject(p)) && /showcase-slot\?t=/.test(html(p))), r.status + ' ' + r.text);
r = await hit('POST', '/api/admin/campaigns', { kind: 'offer', audience: 'speakers' }, ADMIN);
check('a second run leaves out anyone already on one', r.status === 400, r.status + ' ' + r.text);

// ---- 9. the pages ----
r = await hit('GET', '/passes');
check('/passes shows the Student Pass card and the Academic Pass for faculty', /id="student"/.test(r.text) && /Faculty and researchers/.test(r.text) && /Student Pass/.test(r.text), '');
check('the comparison table has the two new rows and the certificate for everyone, last', r.text.includes('AI Innovation Talk and Showcase') && /<th scope="row">Exhibition floor<\/th>/.test(r.text) && r.text.lastIndexOf('Certificate of participation') > r.text.lastIndexOf('Speaker meet &amp; greet'), '');
check('/passes says the name in Hindi, in the three colours', r.text.includes('<span style="color:#E06A00;">भारत</span>') && r.text.includes('इनोवेशन'), '');
check('/passes names the showcase slot, never the VIP move-up prices', /Can I speak on stage\?/.test(r.text) && !/moves up to VIP for|Exhibitor pass for|startup booths/.test(r.text), '');
r = await hit('GET', '/register');
check('/register offers the Student Pass and says it in Hindi', /value="Student Pass"/.test(r.text) && r.text.includes('भारत'), '');
r = await offers({ on: false });
s = await start(BIG, 'VIP Pass');
check('turned off: the Exhibitor pass is refused again', s.status === 409, s.text);
s = await start(D1, 'VIP Pass');
check('turned off: Delegate to VIP is the difference again', s.status === 201 && order(s.json.order_id).base_paise === 1600000, s.text);
r = await hit('GET', '/passes');
check('turned off: the FAQ no longer mentions the offer', !/Can I speak on stage\?/.test(r.text), '');

console.log(fails() ? `\n${fails()} FAILED` : '\nALL PASSED');
process.exit(fails() ? 1 : 0);
