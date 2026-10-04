// Built-worker checks for checkout on this site (CCAvenue): the switch, the order,
// the hand-off page, the gateway's answer, the result page and the payments queue.
// Run after `npm run build`:  node scripts/verify/smoke-payments.mjs
//
// The gateway is played by Node's own crypto, written the way CCAvenue's kits
// write it (AES-128-CBC, key = MD5 of the working key, IV 00..0f, hex). If the
// worker's request decrypts here and an answer encrypted here is accepted there,
// the two speak the same wire format. No network, no real credentials.
import crypto from 'node:crypto';
import vm from 'node:vm';
import { writeFileSync } from 'node:fs';
import { KEY, SECRETS, kitEncrypt, kitDecrypt, sessionCookie, staffCookie, orderSig, gatewayAnswer, makePayDb } from './pay-db.mjs';
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SESSION = 'smoke-session';
const { state, person, DB } = makePayDb();
const envOf = (extra = {}) => new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SESSION, DB, ...extra }, { get: (t, k) => (k in t ? t[k] : undefined) });
const LIVE = envOf(SECRETS);
const ctx = { waitUntil() {}, passThroughOnException() {} };
const cookie = (id) => sessionCookie(SESSION, id);
const hit = async (path, init = {}, env = LIVE) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { redirect: 'manual', ...init }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, h: Object.fromEntries(res.headers), text, json };
};
const start = (id, pass, env = LIVE) => hit('/api/payments/ccavenue/start', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(id ? { Cookie: cookie(id) } : {}) }, body: JSON.stringify({ pass_type: pass }) }, env);
const back = (encResp, env = LIVE) => hit('/pay/ccavenue/return', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ encResp, orderNo: 'x' }).toString() }, env);
const order = (id) => state.orders.find(o => o.order_id === id);
const sigOf = (orderId, paise) => orderSig(SESSION, orderId, paise);
const answer = (o, over = {}) => gatewayAnswer(SESSION, o, over);
const scriptsParse = (html) => {
  // JavaScript only: a JSON-LD block is data and does not parse as a script.
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  for (const b of blocks) new vm.Script(b);
  return blocks.length;
};
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// ---- the switch ----
let r = await hit('/api/payments/config', {}, envOf());
check('no secrets: checkout stays on mUni Campus', r.status === 200 && r.json?.gateway === 'muni', r.status + ' ' + r.text);
r = await hit('/api/payments/config', {}, envOf({ CCAVENUE_MERCHANT_ID: '1', CCAVENUE_ACCESS_CODE: 'x' }));
check('two of three secrets is not enough', r.json?.gateway === 'muni', r.text);
state.table = false;
r = await hit('/api/payments/config');
check('secrets set but migration 0045 not run: still mUni', r.json?.gateway === 'muni', r.text);
r = await start(1, 'Delegate Pass');
check('start answers 503 not_configured before the table exists', r.status === 503 && r.json?.error === 'not_configured', r.status + ' ' + r.text);
state.table = true;
state.settings.payment_gateway = 'muni';
r = await hit('/api/payments/config');
check('Settings payment_gateway = muni switches it off without a deploy', r.json?.gateway === 'muni', r.text);
delete state.settings.payment_gateway;
r = await hit('/api/payments/config');
check('secrets + table: checkout is on this site', r.json?.gateway === 'ccavenue' && /no-store/.test(r.h['cache-control'] || ''), r.text);
r = await hit('/api/payments/config', {}, envOf({ ...SECRETS, SESSION_SECRET: undefined, ADMIN_SECRET: undefined }));
check('no session secret: stays off (an order must belong to someone)', r.json?.gateway === 'muni', r.text);

// ---- starting an order ----
person(1);
person(2, { badge_type: 'Delegate Pass', payment_status: 'paid' });
person(3, { badge_type: 'Exhibitor', payment_status: 'waived' });
person(4, { badge_type: 'VIP Pass', payment_status: 'pending' });
person(5, { name: 'Renée O’Brien & Sons <b>', mobile: '12345', city: 'New Delhi', email: 'bad address' });
r = await start(null, 'Delegate Pass');
check('start needs a session', r.status === 401, r.status + ' ' + r.text);
r = await start(1, 'Visitor Pass');
check('start refuses a pass that is not a paid tier', r.status === 400, r.status + ' ' + r.text);
r = await start(2, 'VIP Pass');
check('a confirmed Delegate is not charged again', r.status === 409 && /already confirmed/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await start(3, 'Delegate Pass');
check('an Exhibitor pass cannot be changed by paying', r.status === 409 && /organisers/.test(r.json?.error || ''), r.status + ' ' + r.text);
r = await start(1, 'Delegate Pass');
const A = r.json || {};
check('a Visitor can start a Delegate payment', r.status === 201 && /^BAI1-[A-Z0-9]{8,18}$/.test(A.order_id || '') && A.amount === 5898.82 && (A.pay_url || '').startsWith('/pay/ccavenue/' + A.order_id + '.'), r.status + ' ' + r.text);
check('the order carries our price: 4,999 + 18% GST, in paise', order(A.order_id)?.base_paise === 499900 && order(A.order_id)?.gst_paise === 89982 && order(A.order_id)?.amount_paise === 589882 && order(A.order_id)?.previous_badge === 'Visitor Pass', JSON.stringify(order(A.order_id)));
r = await start(4, 'VIP Pass');
const V = r.json || {};
check('a pending VIP can pay: 14,999 + GST', r.status === 201 && order(V.order_id)?.amount_paise === 1769882, r.status + ' ' + r.text);
r = await start(4, 'Academic Pass');
check('Academic is 999 + GST', r.status === 201 && order(r.json.order_id)?.amount_paise === 117882, r.status + ' ' + r.text);
state.recent = 10;
r = await start(1, 'Delegate Pass');
check('the eleventh order in an hour is refused', r.status === 429, r.status + ' ' + r.text);
state.recent = null;

// ---- the hand-off page ----
r = await hit(A.pay_url);
const enc = (r.text.match(/name="encRequest" value="([0-9a-f]+)"/) || [])[1] || '';
check('checkout page posts to the live gateway', r.status === 200 && r.text.includes('action="https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction"') && r.text.includes('name="access_code" value="AVSMOKE00TEST"'), r.status);
check('checkout page is never cached and its script parses', /no-store/.test(r.h['cache-control'] || '') && scriptsParse(r.text) === 1, r.h['cache-control']);
check('the working key never reaches the page', !r.text.includes(KEY), 'key in page');
let sent = {};
try { sent = Object.fromEntries(new URLSearchParams(kitDecrypt(enc))); } catch (e) { sent = { error: e.message }; }
check('the request decrypts with the kit algorithm (AES-128-CBC, MD5 key)', sent.merchant_id === '9900001' && sent.order_id === A.order_id, JSON.stringify(sent).slice(0, 200));
check('amount, currency and return address are ours', sent.amount === '5898.82' && sent.currency === 'INR' && sent.redirect_url === 'https://bharataiinnovation.com/pay/ccavenue/return' && sent.cancel_url === sent.redirect_url, JSON.stringify(sent).slice(0, 300));
check('the order signature rides along as merchant_param1', sent.merchant_param1 === sigOf(A.order_id, 589882) && sent.merchant_param2 === 'Delegate Pass', sent.merchant_param1);
check('billing details are passed so the buyer does not retype them', sent.billing_name === 'Asha Rao' && sent.billing_tel === '9820012345' && sent.billing_email === 'a1@example.com' && sent.billing_city === 'Mumbai', JSON.stringify(sent).slice(0, 400));
r = await hit(A.pay_url, {}, envOf({ ...SECRETS, CCAVENUE_ENV: 'test' }));
check('CCAVENUE_ENV=test points at the sandbox', r.text.includes('action="https://test.ccavenue.com/transaction/'), r.status);
r = await hit('/pay/ccavenue/' + A.order_id + '.' + '0'.repeat(24));
check('a forged checkout link is refused', r.status === 404 && !r.text.includes('encRequest'), r.status);
r = await start(5, 'Delegate Pass');
const odd = await hit(r.json.pay_url);
let oddSent = {};
try { oddSent = Object.fromEntries(new URLSearchParams(kitDecrypt((odd.text.match(/name="encRequest" value="([0-9a-f]+)"/) || [])[1] || ''))); } catch (e) { oddSent = { error: e.message }; }
check('awkward billing text is cleaned, a bad phone or email is left out', oddSent.billing_name === 'Renee O Brien Sons b' && !('billing_tel' in oddSent) && !('billing_email' in oddSent) && oddSent.billing_city === 'New Delhi', JSON.stringify(oddSent).slice(0, 300));
for (const len of [1, 31, 32, 55, 56, 63, 64, 65, 120]) {
  const k = 'k'.repeat(len);
  const page = await hit(A.pay_url, {}, envOf({ ...SECRETS, CCAVENUE_WORKING_KEY: k }));
  let ok = false;
  try { ok = new URLSearchParams(kitDecrypt((page.text.match(/name="encRequest" value="([0-9a-f]+)"/) || [])[1] || '', k)).get('order_id') === A.order_id; } catch {}
  check('MD5 matches Node for a ' + len + '-character key', ok, 'decrypt failed');
}
const old = order(A.order_id).created_at;
order(A.order_id).created_at = '2026-01-01 00:00:00';
r = await hit(A.pay_url);
check('a checkout link older than an hour is closed', r.status === 410 && !r.text.includes('encRequest'), r.status);
order(A.order_id).created_at = old;

// ---- answers that must not be believed ----
const before = JSON.stringify([state.orders, state.attendees]);
const unconfirmed = (x) => x.status === 303 && x.h.location === '/pay/result';
r = await back('zz-not-hex');
check('rubbish is answered with the plain unconfirmed page', unconfirmed(r), r.status + ' ' + r.h.location);
r = await back(kitEncrypt(answer(order(A.order_id)), 'some-other-working-key-0000000000'));
check('an answer encrypted with another key is not believed', unconfirmed(r), r.status + ' ' + r.h.location);
r = await back(kitEncrypt(answer(order(A.order_id), { merchant_param1: sigOf(V.order_id, 1769882) })));
check('an answer carrying another order\'s signature is not believed', unconfirmed(r), r.status + ' ' + r.h.location);
r = await back(kitEncrypt(answer({ ...order(A.order_id), order_id: 'BAI1-ZZZZZZZZZZZZ' })));
check('an answer for an order we never made is not believed', unconfirmed(r), r.status + ' ' + r.h.location);
r = await back(kitEncrypt(answer(order(A.order_id)) + '&order_status=Success&order_id=' + V.order_id));
check('an answer that says a thing twice is not believed', unconfirmed(r), r.status + ' ' + r.h.location);
{
  // Blocks cut from the VIP order's "Failure" pasted over the head of a paid
  // Delegate "Success": the join decrypts to noise, and noise is not an answer.
  const good = kitEncrypt(answer(order(A.order_id)));
  const other = kitEncrypt(answer(order(V.order_id), { order_status: 'Failure' }));
  r = await back(other.slice(0, 64) + good.slice(64));
  check('blocks pasted from another answer are not believed', unconfirmed(r), r.status + ' ' + r.h.location);
  const flipped = good.slice(0, 40) + (good[40] === '0' ? '1' : '0') + good.slice(41);
  r = await back(flipped);
  check('a flipped bit is not believed', unconfirmed(r), r.status + ' ' + r.h.location);
}
check('none of that touched an order or a pass', JSON.stringify([state.orders, state.attendees]) === before && state.audits.length === 0, 'state changed');

// ---- answers that are believed ----
r = await back(kitEncrypt(answer(order(V.order_id), { amount: '1178.82', mer_amount: '1178.82' })));
check('"Success" for the wrong amount unlocks nothing and is flagged', r.status === 303 && r.h.location.startsWith('/pay/result?o=') && order(V.order_id).status === 'mismatch' && state.attendees[4].payment_status === 'pending' && state.audits.some(a => a.action === 'payment.mismatch'), order(V.order_id).status + ' ' + state.attendees[4].payment_status);
r = await hit(r.h.location);
check('the buyer is told the payment is being checked', r.status === 200 && /need to check this payment/.test(r.text) && r.text.includes(V.order_id), r.status);

r = await start(4, 'VIP Pass');
const V2 = r.json;
r = await back(kitEncrypt(answer(order(V2.order_id), { order_status: 'Aborted', tracking_id: 'null', status_message: 'N' })));
check('a cancelled payment is recorded as aborted, pass still pending', order(V2.order_id).status === 'aborted' && state.attendees[4].payment_status === 'pending', order(V2.order_id).status);
r = await hit(r.h.location);
check('the cancelled page offers another try, and its script parses', /You cancelled the payment/.test(r.text) && r.text.includes('id="again"') && scriptsParse(r.text) === 1, r.status);
r = await hit(V2.pay_url);
check('a used checkout link does not go to the gateway again', r.status === 410, r.status);

r = await start(4, 'VIP Pass');
const V3 = r.json;
r = await back(kitEncrypt(answer(order(V3.order_id), { order_status: 'Failure', failure_message: 'Declined by bank <script>', status_message: 'N' })));
const failedPage = await hit(r.h.location);
check('a declined payment is recorded as failed and the reason is shown escaped', order(V3.order_id).status === 'failed' && failedPage.text.includes('Declined by bank &lt;script&gt;') && !failedPage.text.includes('bank <script>'), order(V3.order_id).status);

const auditsBefore = state.audits.length;
r = await back(kitEncrypt(answer(order(A.order_id))));
const paidUrl = r.h.location || '';
check('a genuine Success marks the order paid', r.status === 303 && paidUrl.startsWith('/pay/result?o=') && order(A.order_id).status === 'paid' && order(A.order_id).tracking_id === '115023456789' && !!order(A.order_id).paid_at, r.status + ' ' + order(A.order_id).status);
check('and unlocks the pass: badge, paid, amount, conference yes', state.attendees[1].badge_type === 'Delegate Pass' && state.attendees[1].payment_status === 'paid' && state.attendees[1].payment_amount === '5898.82' && state.attendees[1].main_event === 1, JSON.stringify(state.attendees[1]));
check('and is written to the audit log as the gateway', state.audits.length === auditsBefore + 1 && state.audits[state.audits.length - 1].action === 'payment.received' && /115023456789/.test(state.audits[state.audits.length - 1].detail || ''), JSON.stringify(state.audits.slice(-1)));
r = await hit(paidUrl);
check('the result page confirms it with amount and reference', r.status === 200 && /Payment received/.test(r.text) && r.text.includes('5,898.82') && r.text.includes('115023456789') && r.text.includes(A.order_id), r.status);
check('opened without the buyer\'s session, the result page carries nothing personal', !r.text.includes('agba_user') && !r.text.includes('a1@example.com'), 'details in page');
r = await hit(paidUrl, { headers: { Cookie: cookie(1) } });
check('opened by the buyer, it leaves the app its signed-in note, and the script parses', r.text.includes('agba_user') && r.text.includes('a1@example.com') && scriptsParse(r.text) === 1, 'no seed');
r = await hit(paidUrl, { headers: { Cookie: cookie(2) } });
check('opened by somebody else who is signed in, it leaves nothing', !r.text.includes('agba_user'), 'seed for a stranger');
const updates = state.attendeeUpdates.length;
r = await back(kitEncrypt(answer(order(A.order_id))));
check('the same answer again changes nothing and mails nobody', r.h.location === paidUrl && state.attendeeUpdates.length === updates && state.audits.length === auditsBefore + 1, state.attendeeUpdates.length + ' updates');
r = await back(kitEncrypt(answer(order(A.order_id), { order_status: 'Failure' })));
check('a later "Failure" cannot undo a paid order', order(A.order_id).status === 'paid' && state.attendees[1].payment_status === 'paid', order(A.order_id).status);
r = await hit(A.pay_url);
check('the checkout link of a paid order goes to the result, not the gateway', r.status === 303 && (r.h.location || '').startsWith('/pay/result?o='), r.status);
r = await start(1, 'VIP Pass');
check('having paid, they cannot be charged for another pass', r.status === 409, r.status + ' ' + r.text);

r = await start(5, 'Delegate Pass');
const S = r.json;
state.attendees[5].badge_type = 'Speaker';
r = await back(kitEncrypt(answer(order(S.order_id))));
check('a pass set by hand meanwhile is left alone; the payment is still recorded', order(S.order_id).status === 'paid' && state.attendees[5].badge_type === 'Speaker' && /left as Speaker/.test(state.audits[state.audits.length - 1].detail || ''), state.attendees[5].badge_type);

r = await hit('/pay/result');
check('no link: the plain unconfirmed page, which promises nothing', r.status === 200 && /could not confirm a payment/.test(r.text) && !/Payment received/.test(r.text), r.status);
r = await hit('/pay/result?o=' + A.order_id + '.' + 'f'.repeat(24));
check('a forged result link shows the same plain page', /could not confirm a payment/.test(r.text), r.status);
r = await hit('/pay/ccavenue/return', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'encResp=' + kitEncrypt(answer(order(A.order_id))) }, envOf());
check('with the secrets removed an answer is ignored, not an error', r.status === 303 && r.h.location === '/pay/result', r.status);

// ---- the payments queue ----
r = await hit('/api/admin/payments-pending');
check('payments queue refuses without admin', r.status === 401, r.status);
r = await hit('/api/admin/payments-pending', { headers: { Authorization: 'Bearer smoke-admin' } });
const q = r.json || {};
const vip = (q.results || []).find(x => x.id === 4);
check('queue: a pending VIP shows the expected amount and their last online attempt', q.ready === true && q.gateway === 'ccavenue' && vip?.expected === 17698.82 && vip?.last_order?.order_id === V3.order_id && vip?.last_order?.status === 'failed', JSON.stringify(vip));
const paid = (q.paid_online || []).find(x => x.order_id === A.order_id);
check('queue: a payment taken here waits for its invoice, order and reference filled in', paid?.amount === 5898.82 && paid?.tracking_id === '115023456789' && paid?.badge_type === 'Delegate Pass' && paid?.id === 1 && !!paid?.paid_on, JSON.stringify(paid));
state.invoices.push({ order_ref: A.order_id });
r = await hit('/api/admin/payments-pending', { headers: { Authorization: 'Bearer smoke-admin' } });
check('queue: raising the invoice takes it off the list', !(r.json?.paid_online || []).some(x => x.order_id === A.order_id), JSON.stringify(r.json?.paid_online));

// ---- the finance page ----
state.staff[3] = { id: 3, name: 'Finance Person', username: 'fin', active: 1, role: 'finance' };
r = await hit('/api/finance/payments-pending');
check('finance queue refuses without a finance sign-in', r.status === 401, r.status);
r = await hit('/api/finance/payments-pending', { headers: { Cookie: staffCookie(SESSION, 3) } });
check('finance queue lists payments taken here', r.status === 200 && (r.json?.paid_online || []).some(x => x.order_id === S.order_id), r.status + ' ' + r.text.slice(0, 120));
r = await hit('/finance', { headers: { Cookie: staffCookie(SESSION, 3) } });
let fin = 0; try { fin = scriptsParse(r.text); } catch (e) { fin = -1; console.log('  /finance script: ' + e.message); }
check('/finance renders and its script parses', r.status === 200 && fin === 1, r.status + ' ' + fin);
for (const m of ['id="online-card"', 'openForm(i, fromOnline)', 'Raise invoice']) check('/finance carries ' + m, r.text.includes(m), 'missing');

// ---- the forms ----
r = await hit('/register');
let parsed = 0; try { parsed = scriptsParse(r.text); } catch (e) { parsed = -1; console.log('  /register script: ' + e.message); }
check('/register renders and every inline script parses', r.status === 200 && parsed > 0, r.status + ' ' + parsed);
for (const m of ['function startOnlinePayment', 'function loadPayGateway', 'id="rpp-next-copy"', "PAY_GATEWAY === 'ccavenue'", 'function muniPayUrl']) check('/register carries ' + m, r.text.includes(m), 'missing');
r = await hit('/app');
for (const m of ['function startOnlinePayment', 'function payPendingPass', 'id="pcc-pay-btn"', 'id="pp-next-copy"', 'function muniPayUrl']) check('/app carries ' + m, r.text.includes(m), 'missing');
r = await hit('/admin');
for (const m of ['_paidOnline', 'Paid online: invoice to raise', 'openInvoiceFor(idx, fromOnline)']) check('/admin carries ' + m, r.text.includes(m), 'missing');

if (process.env.DUMP_SQL) writeFileSync(process.env.DUMP_SQL, JSON.stringify([...new Set(state.sqls)], null, 2));
console.log(fails ? `\n${fails} FAILED` : '\nall payment smoke checks passed');
process.exit(fails ? 1 : 0);
