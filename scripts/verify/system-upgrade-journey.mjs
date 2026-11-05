// SYSTEM level of the pass upgrade (5 Nov 2026): one person, the whole way, and
// every part of the platform that has to agree about her.
//
// Meera registers free on the website on 5 Nov. A Visitor cannot start a
// conversation or take a workshop seat. She buys a Delegate Pass; the
// conversation opens, the workshop does not. The account email tells her she can
// move up for the difference and its link signs her in. She moves up to Premium
// Delegate and takes a workshop seat. The price changes at midnight. On 6 Nov
// she moves up to VIP, for the late difference, and keeps her seat.
//
// At each step: what she is charged, her pass, what she has paid in all, the
// receipt and its email, what the team is told; and at the end what the admin
// screens say (the payments queue, "What sells", the Overview board).
// The built worker on real SQLite with the production schema, the gateway and
// Elastic Email played here.
// Run after `npm run build`:  node scripts/verify/system-upgrade-journey.mjs
import { makeUpgradeWorld, checker, settle, ADMIN, STANDARD, LATE } from './upgrade-world.mjs';

const W = await makeUpgradeWorld();
const { check, fails } = checker();
const { at, realClock, person, who, order, ordersOf, start, handoff, answer, until, mailTo, setting, hit, q, rows, sent, subject, html, as, tokensIn } = W;
const EMAIL = 'meera@example.com', TEAM = 'info@bharataiinnovation.com';
const receipts = (id) => q('SELECT * FROM invoices WHERE attendee_id = ? ORDER BY id', id);
const seat = (id) => (q('SELECT workshop_id FROM workshop_seats WHERE attendee_id = ?', id)[0] || {}).workshop_id ?? null;
const connect = (id, to) => hit('POST', '/api/connections', { event_id: 1, from_attendee_id: id, to_attendee_id: to, message: 'Hello, shall we meet at the event?' }, as(id));
const choose = (id, wid) => hit('POST', '/api/workshops/choose', { workshop_id: wid }, as(id));
// Start, look at the hand-off page, pay; waits for the pass and the three emails
// (her confirmation, her receipt, the team's note).
const pay = async (id, pass) => {
  sent.length = 0;
  const s = await start(id, pass);
  const page = s.json?.pay_url ? await handoff(s.json.pay_url) : null;
  const back = s.json?.order_id ? await answer(s.json.order_id) : null;
  await until(() => sent.length >= 3 && String((who(id) || {}).badge_type) === pass);
  return { s, page, back, order: s.json?.order_id ? order(s.json.order_id) : null };
};
let r, p;

for (const [k, v] of Object.entries({ inv_legal_name: 'Smoke Organiser Trust', inv_gstin: '27AAATS0000A1Z5', inv_state: 'Maharashtra', inv_state_code: '27', inv_prefix: 'AKT', inv_next_number: '119' })) setting(k, v);
W.db.run("INSERT INTO workshops (id, event_id, slug, title, capacity, is_open) VALUES (1, 1, 'cxo-guide', 'CXO Guide to AI', 100, 1)");
const PEER = person(500, { name: 'Paid Pat', email: 'pat@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
W.db.run("UPDATE attendees SET interests = 'ai' WHERE id = ?", [PEER]);

// ---- 5 Nov: she registers free, on the website ----
at(STANDARD);
r = await hit('POST', '/api/events/1/attendees/register', { name: 'Meera Nair', email: EMAIL, mobile: '9820055555', company: 'Nair Analytics', job_title: 'Founder', city: 'Pune', industry: 'Software & SaaS', interests: 'Applied AI, analytics', bio: 'Builds analytics products.', badge_type: 'Visitor Pass' });
await until(() => mailTo(EMAIL).length >= 1);
const ME = Number(r.json?.id || 0);
check('she registers: a free Visitor Pass, one person on the list', (r.status === 200 || r.status === 201) && ME > 0 && who(ME).badge_type === 'Visitor Pass' && q('SELECT COUNT(*) AS n FROM attendees WHERE email = ?', EMAIL)[0].n === 1, r.status + ' ' + r.text.slice(0, 160));
const welcome = mailTo(EMAIL)[0];
check('the welcome email offers each paid pass, with links that sign her in and open the payment', !!welcome && ['delegate', 'premium', 'vip'].every(k => new RegExp('action=pay&(amp;)?pass=' + k).test(html(welcome))) && tokensIn(welcome).length === 1, welcome ? subject(welcome) : 'no mail');

r = await connect(ME, PEER);
check('as a Visitor she cannot start a conversation', r.status === 402 && r.json?.error === 'upgrade_required', r.status + ' ' + r.text.slice(0, 120));
r = await choose(ME, 1);
check('nor take a workshop seat', r.status === 403 && seat(ME) === null, r.status + ' ' + r.text.slice(0, 120));

// ---- she buys a Delegate Pass: the whole price ----
p = await pay(ME, 'Delegate Pass');
check('a free pass buying Delegate pays the whole price: 4,999 + GST = 5,898.82', p.s.status === 201 && p.s.json.amount === 5898.82 && p.order.base_paise === 499900 && p.order.previous_badge === 'Visitor Pass', p.s.text);
check('the hand-off page does not call a first purchase an upgrade', p.page.status === 200 && !/Upgrade to/.test(p.page.text) && p.page.asked.amount === '5898.82', p.page.text.slice(0, 160));
check('she is a Delegate, paid, with lunch', who(ME).badge_type === 'Delegate Pass' && who(ME).payment_status === 'paid' && who(ME).payment_amount === '5898.82' && who(ME).lunch_inclusion === 'Yes', JSON.stringify(who(ME)).slice(0, 300));
check('receipt 1 is for the Delegate Pass, emailed', receipts(ME).length === 1 && /^RCT\/.*\/1$/.test(receipts(ME)[0].invoice_no) && /^Delegate Pass - /.test(receipts(ME)[0].item_desc) && Number(receipts(ME)[0].total_paise) === 589882 && !!receipts(ME)[0].emailed_at, JSON.stringify(receipts(ME).map(i => [i.invoice_no, i.item_desc, i.emailed_at])));
check('her confirmation does not speak of moving up (she bought her first pass)', mailTo(EMAIL).some(m => /Payment received: your Delegate Pass is confirmed/.test(subject(m)) && !/moved up from/.test(html(m))), mailTo(EMAIL).map(subject).join(' | '));
r = await connect(ME, PEER);
check('now she can start a conversation', r.status < 300, r.status + ' ' + r.text.slice(0, 160));
r = await choose(ME, 1);
check('a Delegate Pass still has no workshop seat', r.status === 403 && seat(ME) === null, r.status + ' ' + r.text.slice(0, 120));
r = await hit('GET', '/api/workshops', undefined, as(ME));
check('and the app is told why: the pass, not the payment', r.json?.entitled === false && r.json.why === 'tier', r.text.slice(0, 160));

// ---- the account email tells her she can move up, and its link signs her in ----
sent.length = 0;
r = await hit('POST', '/api/admin/attendees/' + ME + '/notify', {}, ADMIN);
await until(() => mailTo(EMAIL).some(m => /your Delegate Pass is ready/.test(subject(m))));
const ready = mailTo(EMAIL).find(m => /your Delegate Pass is ready/.test(subject(m)));
const line = ready ? (html(ready).match(/Want a hands-on workshop seat\?[^<]*/) || [''])[0] : '';
check('the account email says: move up to Premium Delegate for the difference, 5,000 + GST', /Move up to Premium Delegate for the difference, &#8377;5,000 \+ GST/.test(line), line || (ready ? 'line missing' : 'no email'));
const moveUp = ready ? ((html(ready).match(/href="([^"]*action=pay&(?:amp;)?pass=premium[^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&') : '';
const token = (moveUp.match(/token=([0-9a-f]{64})/) || [])[1] || '';
check('its "Move up" link opens the app on the payment, for Premium, with a sign-in token', /\/app\?email=meera%40example\.com&action=pay&pass=premium&token=/.test(moveUp) && !!token, moveUp.slice(0, 160));
// Older than two minutes, so the opening is hers and not an email scanner's.
W.db.run("UPDATE login_tokens SET created_at = datetime('now', '-3 minutes') WHERE email = ?", [EMAIL]);
realClock();
r = await hit('POST', '/api/events/1/attendees/login', { email: EMAIL, token });
check('and the link signs her in as herself, a paid Delegate (the app then opens the upgrade sheet: pay-test.cjs 3b)', r.status === 200 && r.json?.id === ME && r.json?.badge_type === 'Delegate Pass' && r.json?.payment_status === 'paid', r.status + ' ' + r.text.slice(0, 160));
at(STANDARD);
r = await hit('POST', '/api/upgrade-prompt', { reason: 'link', target: 'Premium Delegate Pass', pass: 'Delegate Pass' }, as(ME));
check('the sheet she is shown is counted for the team', rows('upgrade.prompt', ME).length === 1 && /"reason":"link"/.test(rows('upgrade.prompt', ME)[0].detail), JSON.stringify(rows('upgrade.prompt', ME)));

// ---- she moves up to Premium Delegate: the difference only ----
p = await pay(ME, 'Premium Delegate Pass');
check('Delegate to Premium Delegate: 9,999 - 4,999 = 5,000 + GST = 5,900', p.s.status === 201 && p.s.json.amount === 5900 && p.order.base_paise === 500000 && p.order.gst_paise === 90000 && p.order.previous_badge === 'Delegate Pass', p.s.text);
check('the hand-off page calls it an upgrade and the gateway is asked for 5,900.00', /Upgrade to Premium Delegate Pass/.test(p.page.text) && p.page.asked.amount === '5900.00', p.page.text.slice(0, 160));
check('she is a Premium Delegate; paid in all 5,898.82 + 5,900 = 11,798.82, what a Premium Delegate Pass costs', who(ME).badge_type === 'Premium Delegate Pass' && who(ME).payment_status === 'paid' && who(ME).payment_amount === '11798.82', who(ME).payment_amount);
check('receipt 2 is for the difference and says what it was for', receipts(ME).length === 2 && /\/2$/.test(receipts(ME)[1].invoice_no) && /^Upgrade from Delegate Pass to Premium Delegate Pass - /.test(receipts(ME)[1].item_desc) && Number(receipts(ME)[1].total_paise) === 590000 && !!receipts(ME)[1].emailed_at, JSON.stringify(receipts(ME).map(i => [i.invoice_no, i.item_desc])));
check('she is told her Delegate Pass is now a Premium Delegate Pass; the team hears it moved up', mailTo(EMAIL).some(m => /is now a <strong>Premium Delegate Pass<\/strong>/.test(html(m)) && /moved up from Delegate Pass/.test(html(m))) && mailTo(TEAM).some(m => /Premium Delegate Pass \(moved up from Delegate Pass\)/.test(subject(m))), sent.map(subject).join(' | '));
r = await hit('GET', '/api/workshops', undefined, as(ME));
check('the workshop is now hers to choose', r.json?.entitled === true, r.text.slice(0, 160));
r = await choose(ME, 1);
check('and she takes a seat', r.status === 200 && seat(ME) === 1, r.status + ' ' + r.text.slice(0, 160));
r = await start(ME, 'Delegate Pass');
check('she cannot be charged for a cheaper pass', r.status === 409 && /move up to VIP Pass for the difference/.test(r.json?.error || ''), r.status + ' ' + r.text);

// ---- midnight: the late prices. 6 Nov: she moves up to VIP ----
at(LATE);
r = await hit('GET', '/api/payments/config');
check('on 6 Nov the late prices apply', r.json?.late === true && r.json.passes['VIP Pass'].base === 24999 && r.json.passes['Premium Delegate Pass'].base === 14999, JSON.stringify(r.json?.passes));
p = await pay(ME, 'VIP Pass');
check('Premium Delegate to VIP on 6 Nov: 24,999 - 14,999 = 10,000 + GST = 11,800', p.s.status === 201 && p.s.json.amount === 11800 && p.order.base_paise === 1000000 && p.order.previous_badge === 'Premium Delegate Pass', p.s.text);
check('she is a VIP; paid in all 23,598.82 across three payments', who(ME).badge_type === 'VIP Pass' && who(ME).payment_status === 'paid' && who(ME).payment_amount === '23598.82', who(ME).payment_amount);
check('receipt 3 is for that difference', receipts(ME).length === 3 && /\/3$/.test(receipts(ME)[2].invoice_no) && /^Upgrade from Premium Delegate Pass to VIP Pass - /.test(receipts(ME)[2].item_desc) && Number(receipts(ME)[2].total_paise) === 1180000, JSON.stringify(receipts(ME).map(i => [i.invoice_no, i.item_desc])));
check('she keeps her workshop seat', seat(ME) === 1 && (await hit('GET', '/api/workshops', undefined, as(ME))).json?.mine === 1);
r = await start(ME, 'VIP Pass');
check('there is nothing above VIP: she is told it is confirmed, and is not charged', r.status === 409 && /VIP Pass is already confirmed/.test(r.json?.error || '') && ordersOf(ME).length === 3, r.status + ' ' + r.text);
realClock();

// ---- the books agree ----
const mine = ordersOf(ME);
check('three orders, all paid, each from the pass before it', mine.map(o => o.status).join() === 'paid,paid,paid' && mine.map(o => o.previous_badge).join() === 'Visitor Pass,Delegate Pass,Premium Delegate Pass' && mine.map(o => o.pass_type).join() === 'Delegate Pass,Premium Delegate Pass,VIP Pass', JSON.stringify(mine.map(o => [o.previous_badge, o.pass_type, o.status])));
const paidPaise = mine.reduce((s, o) => s + Number(o.amount_paise), 0);
check('the orders, the receipts and her record all say 23,598.82', paidPaise === 2359882 && receipts(ME).reduce((s, i) => s + Number(i.total_paise), 0) === 2359882 && who(ME).payment_amount === '23598.82', paidPaise + ' ' + who(ME).payment_amount);
check('each receipt splits its own amount into value and 18% GST, to the paisa', receipts(ME).every(i => Number(i.taxable_paise) + Number(i.cgst_paise) + Number(i.sgst_paise) + Number(i.igst_paise) === Number(i.total_paise)), JSON.stringify(receipts(ME).map(i => [i.taxable_paise, i.cgst_paise, i.sgst_paise, i.igst_paise, i.total_paise])));
check('three payments in the audit log, two of them a move up', rows('payment.received', ME).length === 3 && rows('payment.received', ME).map(a => JSON.parse(a.detail).upgrade_from || '').join() === ',Delegate Pass,Premium Delegate Pass', JSON.stringify(rows('payment.received', ME).map(a => JSON.parse(a.detail).upgrade_from)));
check('she is still one person on the list, a conference registrant', q('SELECT COUNT(*) AS n FROM attendees WHERE email = ?', EMAIL)[0].n === 1 && Number(who(ME).main_event) === 1);

// ---- what the team sees ----
r = await hit('GET', '/api/admin/payments-pending', undefined, ADMIN);
const online = (r.json?.paid_online || []).filter(x => x.id === ME);
check('Admin, Payments: her three payments wait for their tax invoices (a receipt is not one)', r.status === 200 && online.length === 3 && online.map(x => x.amount).sort((a, b) => a - b).join() === '5898.82,5900,11800', JSON.stringify(online.map(x => [x.pass_type, x.amount])));
check('and she is not on the list of people who still have to pay', !(r.json?.results || []).some(x => x.id === ME), JSON.stringify((r.json?.results || []).map(x => x.id)));
r = await hit('GET', '/api/admin/payments/funnel', undefined, ADMIN);
const moved = (r.json?.orders || []).filter(o => o.upgrade && o.status === 'paid');
check('"What sells" shows the prompt she met and her two moves up', (r.json?.prompts || []).some(x => x.reason === 'link') && moved.some(o => o.pass_type === 'Premium Delegate Pass' && o.previous_badge === 'Delegate Pass') && moved.some(o => o.pass_type === 'VIP Pass' && o.previous_badge === 'Premium Delegate Pass'), JSON.stringify(r.json?.orders).slice(0, 400));
r = await hit('GET', '/api/admin/events/1/board', undefined, ADMIN);
const passRow = Object.fromEntries((r.json?.passes || []).map(x => [x.pass, x]));
const soldPaise = (r.json?.money?.sold || []).reduce((s, x) => s + Number(x.total), 0);
check('the Overview board counts her once, as a VIP', r.status === 200 && passRow['VIP Pass']?.total === 1 && passRow['VIP Pass']?.not_paid === 0 && !passRow['Premium Delegate Pass'] && passRow['Delegate Pass']?.total === 1 && !passRow['Visitor Pass'], JSON.stringify(r.json?.passes));
check('and the money from passes through the gateway is the 23,598.82 she paid', soldPaise === 2359882, JSON.stringify(r.json?.money?.sold));
r = await hit('GET', '/api/attendees/' + ME, undefined, as(ME));
check('her profile, as the app and the directory read it, says VIP Pass', r.status === 200 && r.json?.badge_type === 'VIP Pass', r.status + ' ' + JSON.stringify(r.json?.badge_type));

console.log(fails() ? `\n${fails()} FAILED` : '\nall pass-upgrade system checks passed');
process.exit(fails() ? 1 : 0);
