// INTEGRATION level of the pass upgrade (5 Nov 2026): the parts working together
// on real SQLite with the production schema. An order for the difference, the
// hand-off page, the gateway's answer, the pass and what was paid in all, the
// audit row, the receipt, the buyer's and the team's emails, the result page;
// then every way it must not go wrong (the same answer twice, a cancelled
// payment, the wrong amount, an answer signed for another order, a badge changed
// by hand meanwhile, an order made before midnight and paid after), the prompt
// counted for the team, and the pages that carry the sheet.
// The gateway is played here, written the way CCAvenue's kits write it.
// Run after `npm run build`:  node scripts/verify/integration-upgrade.mjs
import { makeUpgradeWorld, checker, settle, ADMIN, STANDARD, LATE } from './upgrade-world.mjs';
import { SESSION_SECRET } from './login-world.mjs';
import { gatewayAnswer, orderSig } from './pay-db.mjs';

const W = await makeUpgradeWorld();
const { check, fails } = checker();
const { at, realClock, person, who, order, ordersOf, start, handoff, answer, until, buy, mailTo, setting, hit, q, rows, sent, subject, html, as } = W;
const audits = (id) => rows('payment.received', id).map(a => JSON.parse(a.detail));
const TEAM = 'info@bharataiinnovation.com';
let r, s;

// Receipts are raised by the same code as invoices; it needs to know who issues them.
for (const [k, v] of Object.entries({ inv_legal_name: 'Smoke Organiser Trust', inv_gstin: '27AAATS0000A1Z5', inv_state: 'Maharashtra', inv_state_code: '27', inv_prefix: 'AKT', inv_next_number: '119' })) setting(k, v);

at(STANDARD);

// ---- 1. the order ----
const DEV = person(1, { name: 'Dev Mehta', email: 'dev@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
r = await hit('POST', '/api/payments/ccavenue/start', { pass_type: 'VIP Pass' });
check('moving up needs a session', r.status === 401 && ordersOf(DEV).length === 0, r.status + ' ' + r.text);
r = await start(DEV, 'Gold Pass');
check('a pass that does not exist is refused', r.status === 400 && ordersOf(DEV).length === 0, r.status + ' ' + r.text);
s = await start(DEV, 'VIP Pass');
const O1 = s.json?.order_id;
check('a paid Delegate asking for VIP gets an order for the difference: 15,000 + 2,700 GST = 17,700', s.status === 201 && s.json.amount === 17700 && order(O1).base_paise === 1500000 && order(O1).gst_paise === 270000 && order(O1).amount_paise === 1770000, s.status + ' ' + s.text);
check('the order remembers the pass it starts from, and the pass has not changed yet', order(O1).previous_badge === 'Delegate Pass' && order(O1).pass_type === 'VIP Pass' && order(O1).status === 'created' && who(DEV).badge_type === 'Delegate Pass' && who(DEV).payment_amount === '5898.82', JSON.stringify(order(O1)));

// ---- 2. the hand-off page ----
r = await handoff(s.json.pay_url);
check('the hand-off page calls it an upgrade and states the amount with GST', r.status === 200 && /Upgrade to VIP Pass/.test(r.text) && r.text.includes('17,700.00') && /including GST/.test(r.text), r.status + ' ' + r.text.slice(0, 200));
check('the gateway is asked for exactly that amount, in rupees, for this order', r.asked.amount === '17700.00' && r.asked.currency === 'INR' && r.asked.order_id === O1 && r.asked.merchant_param2 === 'VIP Pass' && r.asked.merchant_param1 === orderSig(SESSION_SECRET, O1, 1770000), JSON.stringify(r.asked).slice(0, 300));
check('and told to bring the buyer back to this site', /\/pay\/ccavenue\/return$/.test(r.asked.redirect_url || '') && /\/pay\/ccavenue\/return$/.test(r.asked.cancel_url || ''), r.asked.redirect_url);
check('the page carries the buyer\'s name and email to the gateway, and no card field of its own', r.asked.billing_name === 'Dev Mehta' && r.asked.billing_email === 'dev@example.com' && !/name="card|cvv/i.test(r.text), JSON.stringify([r.asked.billing_name, r.asked.billing_email]));

// ---- 3. the answer: the pass, the money, the record, the mail ----
sent.length = 0;
r = await answer(O1);
await until(() => sent.length >= 3);
check('a believed "Success" sends the buyer to the result page for this order', r.status === 303 && /^\/pay\/result\?o=/.test(r.location), r.status + ' ' + r.location);
check('the pass is now a VIP Pass, paid', who(DEV).badge_type === 'VIP Pass' && who(DEV).payment_status === 'paid', JSON.stringify(who(DEV)));
check('what was paid in all is the Delegate Pass plus the difference: 5,898.82 + 17,700 = 23,598.82', who(DEV).payment_amount === '23598.82', who(DEV).payment_amount);
check('the lunch that the pass includes is kept', who(DEV).lunch_inclusion === 'Yes' && Number(who(DEV).main_event) === 1, JSON.stringify([who(DEV).lunch_inclusion, who(DEV).main_event]));
check('the order is paid, with the gateway\'s reference', order(O1).status === 'paid' && order(O1).tracking_id === '115023456789' && !!order(O1).paid_at && order(O1).gateway_amount === '17700.00', JSON.stringify(order(O1)));
const a1 = audits(DEV);
check('one audit row, naming the pass it moved up from', a1.length === 1 && a1[0].order_id === O1 && a1[0].upgrade_from === 'Delegate Pass' && a1[0].amount_paise === 1770000 && JSON.stringify(a1[0].badge) === JSON.stringify(['Delegate Pass', 'VIP Pass']), JSON.stringify(a1));
const inv1 = q('SELECT * FROM invoices WHERE order_ref = ?', O1);
check('a receipt is raised for the difference, saying what it was for', inv1.length === 1 && /^RCT\//.test(inv1[0].invoice_no) && Number(inv1[0].total_paise) === 1770000 && /^Upgrade from Delegate Pass to VIP Pass/.test(inv1[0].item_desc || ''), JSON.stringify(inv1.map(i => [i.invoice_no, i.total_paise, i.item_desc])));
const toDev = mailTo('dev@example.com');
check('the buyer is told the pass is now a VIP Pass, and what it moved up from', toDev.some(p => /Payment received: your VIP Pass is confirmed/.test(subject(p)) && /moved up from Delegate Pass/.test(html(p)) && /is now a <strong>VIP Pass<\/strong>/.test(html(p)) && html(p).includes('17,700.00') && html(p).includes(O1)), toDev.map(subject).join(' | '));
check('the buyer gets the receipt as well, and no second welcome', toDev.length === 2 && toDev.some(p => html(p).includes(inv1[0]?.invoice_no || 'no receipt')), toDev.map(subject).join(' | '));
check('the team hears that a pass moved up', mailTo(TEAM).some(p => /moved up from Delegate Pass/.test(subject(p))), mailTo(TEAM).map(subject).join(' | '));
r = await hit('GET', (await answer(O1)).location);
check('the result page says the payment arrived, the pass and the amount', r.status === 200 && /Payment received/.test(r.text) && /VIP Pass/.test(r.text) && r.text.includes('17,700.00'), r.status + ' ' + r.text.slice(0, 160));

// ---- 4. what must not happen ----
const before = { amount: who(DEV).payment_amount, audits: audits(DEV).length, mail: sent.length, receipts: q('SELECT COUNT(*) AS n FROM invoices')[0].n };
r = await answer(O1);
await settle(250);
check('the same answer again (a refresh, a second tab) changes nothing and sends nothing', r.status === 303 && who(DEV).payment_amount === before.amount && audits(DEV).length === before.audits && sent.length === before.mail && q('SELECT COUNT(*) AS n FROM invoices')[0].n === before.receipts, JSON.stringify([who(DEV).payment_amount, audits(DEV).length, sent.length]));
r = await handoff(s.json.pay_url);
check('the hand-off link of a paid order goes to its result, not to the gateway again', r.status === 303 && /\/pay\/result\?o=/.test(r.headers.get('location') || ''), r.status + ' ' + r.headers.get('location'));
r = await start(DEV, 'VIP Pass');
check('a VIP asking for VIP again is refused, and is not charged', r.status === 409 && ordersOf(DEV).length === 1, r.status + ' ' + r.text);

// Cancelled: nothing changes, and they can try again.
const KAVYA = person(2, { name: 'Kavya Nair', email: 'kavya@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
s = await start(KAVYA, 'Premium Delegate Pass');
check('a paid Delegate asking for Premium Delegate gets an order for 5,000 + 900 GST = 5,900', s.status === 201 && s.json.amount === 5900 && order(s.json.order_id).base_paise === 500000 && order(s.json.order_id).gst_paise === 90000, s.text);
r = await answer(s.json.order_id, { order_status: 'Aborted', tracking_id: 'null', status_message: 'N' });
check('cancelling at the gateway leaves the Delegate Pass and the amount paid as they were', order(s.json.order_id).status === 'aborted' && who(KAVYA).badge_type === 'Delegate Pass' && who(KAVYA).payment_status === 'paid' && who(KAVYA).payment_amount === '5898.82' && audits(KAVYA).length === 0, JSON.stringify(who(KAVYA)));
r = await answer(s.json.order_id);
check('a cancelled order that is later answered "Success" is honoured once (the bank had the last word)', order(s.json.order_id).status === 'paid' && who(KAVYA).badge_type === 'Premium Delegate Pass' && who(KAVYA).payment_amount === '11798.82', JSON.stringify([order(s.json.order_id).status, who(KAVYA).badge_type, who(KAVYA).payment_amount]));

// The wrong amount: "Success" for less than was asked unlocks nothing.
const OM = person(3, { name: 'Om Shah', email: 'om@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
s = await start(OM, 'VIP Pass');
sent.length = 0;
r = await answer(s.json.order_id, { amount: '1.00', mer_amount: '1.00' });
await until(() => sent.length >= 1);
check('"Success" for another amount is a mismatch: the pass stays a Delegate Pass', order(s.json.order_id).status === 'mismatch' && who(OM).badge_type === 'Delegate Pass' && who(OM).payment_amount === '5898.82' && audits(OM).length === 0 && rows('payment.mismatch', OM).length === 1, JSON.stringify([order(s.json.order_id).status, who(OM).badge_type]));
check('and the team is told to check that payment', mailTo(TEAM).some(p => /CHECK THIS PAYMENT/.test(subject(p))), sent.map(subject).join(' | '));

// An answer signed for a cheaper order cannot pay a dearer one.
const cheap = await start(OM, 'Premium Delegate Pass');
const dear = await start(OM, 'VIP Pass');
const forged = gatewayAnswer(SESSION_SECRET, order(dear.json.order_id), { merchant_param1: orderSig(SESSION_SECRET, cheap.json.order_id, order(cheap.json.order_id).amount_paise) });
r = await answer(dear.json.order_id, {}, forged);
check('the signature of a 5,900 order is not believed on a 17,700 order', r.status === 303 && r.location === '/pay/result' && order(dear.json.order_id).status === 'created' && who(OM).badge_type === 'Delegate Pass', r.status + ' ' + r.location + ' ' + order(dear.json.order_id).status);

// A badge set by hand between the order and the payment is left alone.
const RHEA = person(4, { name: 'Rhea Kapoor', email: 'rhea@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
s = await start(RHEA, 'VIP Pass');
W.db.run("UPDATE attendees SET badge_type = 'Speaker', payment_status = 'waived' WHERE id = ?", [RHEA]);
sent.length = 0;
r = await answer(s.json.order_id);
await until(() => sent.length >= 1);
check('a payment that lands on a pass the organisers set meanwhile is recorded, and the pass is left alone', order(s.json.order_id).status === 'paid' && who(RHEA).badge_type === 'Speaker' && who(RHEA).payment_amount === '5898.82' && /left as Speaker/.test(JSON.stringify(audits(RHEA))), JSON.stringify([who(RHEA).badge_type, audits(RHEA)]));
check('with no receipt raised by itself: a person decides what it paid for', q('SELECT COUNT(*) AS n FROM invoices WHERE order_ref = ?', s.json.order_id)[0].n === 0);

// No credit for a pass that was never paid for.
const UNA = person(5, { name: 'Una Rao', email: 'una@example.com', badge_type: 'Delegate Pass', payment_status: 'pending' });
s = await start(UNA, 'VIP Pass');
check('an unpaid Delegate asking for VIP pays the whole VIP price: nothing is taken off for a pass not paid for', s.status === 201 && s.json.amount === 23598.82 && order(s.json.order_id).base_paise === 1999900, s.text);
r = await handoff(s.json.pay_url);
check('and the hand-off page does not call that an upgrade', r.status === 200 && !/Upgrade to/.test(r.text) && r.text.includes('23,598.82'), r.text.slice(0, 200));
r = await answer(s.json.order_id);
await until(() => who(UNA).badge_type === 'VIP Pass');
check('paying it makes them a VIP, with that one amount paid', who(UNA).badge_type === 'VIP Pass' && who(UNA).payment_status === 'paid' && who(UNA).payment_amount === '23598.82' && !audits(UNA)[0].upgrade_from, JSON.stringify([who(UNA).payment_amount, audits(UNA)]));

// Two steps, one after the other: Academic to Delegate, then Delegate to VIP.
const TARA = person(6, { name: 'Tara Student', email: 'tara@college.example', badge_type: 'Academic Pass', payment_status: 'paid', payment_amount: '1178.82' });
let b = await buy(TARA, 'Delegate Pass');
check('a paid Academic moves up to Delegate for 4,000 + GST = 4,720, and gets the lunch the Delegate Pass includes', b.order?.status === 'paid' && b.order.amount_paise === 472000 && who(TARA).badge_type === 'Delegate Pass' && who(TARA).payment_amount === '5898.82' && who(TARA).lunch_inclusion === 'Yes', JSON.stringify([b.start?.text, who(TARA)]).slice(0, 300));
b = await buy(TARA, 'VIP Pass');
check('and then to VIP for 15,000 + GST: in all, exactly what a VIP Pass costs', b.order?.status === 'paid' && b.order.amount_paise === 1770000 && b.order.previous_badge === 'Delegate Pass' && who(TARA).badge_type === 'VIP Pass' && who(TARA).payment_amount === '23598.82', JSON.stringify([b.start?.text, who(TARA).payment_amount]));

// ---- 5. the dated price ----
// An order keeps the price it was made at: made before midnight, paid after.
const ISHA = person(7, { name: 'Isha Verma', email: 'isha@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
s = await start(ISHA, 'VIP Pass');
at(LATE);
r = await answer(s.json.order_id);
await until(() => who(ISHA).badge_type === 'VIP Pass');
check('an order made at the standard difference and paid after midnight is honoured at 17,700', order(s.json.order_id).status === 'paid' && order(s.json.order_id).amount_paise === 1770000 && who(ISHA).badge_type === 'VIP Pass' && who(ISHA).payment_amount === '23598.82', JSON.stringify([order(s.json.order_id).status, who(ISHA).payment_amount]));
// Bought early, moving up late: the difference between the two late prices.
const JAY = person(8, { name: 'Jay Patel', email: 'jay@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
s = await start(JAY, 'VIP Pass');
check('from 6 Nov a Delegate bought at 4,999 moves up to VIP for 24,999 - 8,999 = 16,000 + GST = 18,880', s.status === 201 && s.json.amount === 18880 && order(s.json.order_id).base_paise === 1600000, s.text);
r = await handoff(s.json.pay_url);
check('the hand-off page states the late difference', r.status === 200 && /Upgrade to VIP Pass/.test(r.text) && r.text.includes('18,880.00') && r.asked.amount === '18880.00', r.status + ' ' + r.text.slice(0, 200));
r = await answer(s.json.order_id);
await until(() => who(JAY).badge_type === 'VIP Pass');
check('paid in all: 5,898.82 + 18,880 = 24,778.82, still less than a late VIP Pass (29,498.82)', who(JAY).payment_amount === '24778.82' && Number(who(JAY).payment_amount) < 29498.82, who(JAY).payment_amount);
at(STANDARD);

// ---- 6. the prompt is counted, as the person ----
const prompt = (id, body) => hit('POST', '/api/upgrade-prompt', body, id ? as(id) : {});
const LINA = person(9, { name: 'Lina Das', email: 'lina@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82' });
const promptRows = (id) => rows('upgrade.prompt', id).map(a => JSON.parse(a.detail));
r = await prompt(LINA, { reason: 'link', target: 'VIP Pass', pass: 'Delegate Pass' });
check('a paid pass opening a "Move up" link is counted, with the pass it holds and the pass it was shown', r.status === 200 && promptRows(LINA).length === 1 && promptRows(LINA)[0].reason === 'link' && promptRows(LINA)[0].target === 'VIP Pass' && promptRows(LINA)[0].pass === 'Delegate Pass', JSON.stringify(promptRows(LINA)));
r = await prompt(LINA, { reason: 'link', target: 'VIP Pass', pass: 'Delegate Pass' });
check('the same prompt again within a minute is not written twice', promptRows(LINA).length === 1, promptRows(LINA).length + ' rows');
r = await prompt(LINA, { reason: 'passcard', target: '', pass: 'Delegate Pass' });
check('the pass card\'s button is counted as its own door', promptRows(LINA).length === 2 && promptRows(LINA)[1].reason === 'passcard', JSON.stringify(promptRows(LINA)));
r = await prompt(LINA, { reason: 'made-up', target: 'x' });
check('a reason the app does not send is dropped', promptRows(LINA).length === 2);
r = await prompt(null, { reason: 'link', target: 'VIP Pass' });
check('a prompt with no session is answered ok and written nowhere', r.status === 200 && rows('upgrade.prompt').length === 2, r.status + ' ' + rows('upgrade.prompt').length);
realClock();
r = await hit('GET', '/api/admin/payments/funnel');
check('the funnel is the team\'s alone', r.status === 401, r.status);
r = await hit('GET', '/api/admin/payments/funnel', undefined, ADMIN);
const moved = (r.json?.orders || []).filter(o => o.upgrade);
check('Admin, Payments, "What sells" lists the link prompt', r.status === 200 && (r.json?.prompts || []).some(p => p.reason === 'link'), r.status + ' ' + JSON.stringify(r.json?.prompts).slice(0, 300));
check('and the paid orders that were a move up, with the pass they came from', moved.some(o => o.status === 'paid' && o.pass_type === 'VIP Pass' && o.previous_badge === 'Delegate Pass') && moved.some(o => o.pass_type === 'Delegate Pass' && o.previous_badge === 'Academic Pass') && !moved.some(o => o.previous_badge === 'Visitor Pass'), JSON.stringify(moved).slice(0, 400));

// ---- 7. the pages carry the sheet ----
r = await hit('GET', '/app');
const appHtml = r.text;
const appJs = (await hit('GET', '/app.js')).text;
for (const m of ['id="upgrade-modal-steps"', 'id="upgrade-modal-icon"', 'id="pcc-upgrade-btn"', 'Upgrade my pass', 'overflow-y:auto']) check('/app carries ' + m, appHtml.includes(m), 'missing');
for (const m of ['function renderUpgradeSteps', 'function pickUpgradeStep', 'function upgradeStepsFor', 'function upgradeAdds', 'function loadPassPrices', 'var UPGRADE_LADDER', "showUpgradeModal('link', '', want)", "showUpgradeModal('form')", 'You pay now', 'and move up', 'today’s price', 'id="upgrade-modal-sum"']) check('/app.js carries ' + m, appJs.includes(m), 'missing');
check('a confirmed pass is never sent to the gateway from a link or the pass card without being asked', !/if \(paidUpgradeFrom\(\)\) \{ startUpgradePayment\(pass\)/.test(appJs) && !/upgradePrice\(badge, want\)\) \{ startUpgradePayment\(want\)/.test(appJs) && (appJs.match(/startUpgradePayment\(/g) || []).length === 2, String((appJs.match(/startUpgradePayment\(/g) || []).length));
check('each new function is defined once (a second definition would silently replace the first)', ['renderUpgradeSteps', 'pickUpgradeStep', 'upgradeStepsFor', 'upgradeAdds', 'loadPassPrices', 'startUpgradePayment', 'openUpgradeFor', 'showUpgradeModal', 'upgradeModalGo', 'renderPassUpgradeLine'].every(n => appJs.split('function ' + n + '(').length === 2));
r = await hit('GET', '/passes');
check('/passes tells someone who has paid how to move up, with a link into the app', r.status === 200 && r.text.includes('id="passes-move-up"') && /Already paid for a pass\?/.test(r.text) && r.text.includes('href="/app?action=pay&amp;pass=premium"') && /pay only the difference/.test(r.text), r.status);
r = await hit('GET', '/admin.js');
check('the admin funnel has a name for the link prompt', r.text.includes("link: 'A paid pass opened a pay or move-up link'"), 'missing');

console.log(fails() ? `\n${fails()} FAILED` : '\nall pass-upgrade integration checks passed');
process.exit(fails() ? 1 : 0);
