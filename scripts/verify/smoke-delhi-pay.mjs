// Integration and system: a paid pass for Delhi 2027, on the built worker with real SQLite
// and the production schema, foreign keys on as in D1. The gateway is played by Node's
// crypto the way CCAvenue's kits write it (pay-db.mjs), the email service is played here.
// From the form to the receipt and Admin, and above all: nothing of it reaches Mumbai.
// Run after `npm run build`:  node scripts/verify/smoke-delhi-pay.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SECRETS, kitEncrypt, kitDecrypt, gatewayAnswer, staffCookie } from './pay-db.mjs';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));
db.exec('PRAGMA foreign_keys = ON');
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI Innovation 2026', '2026-11-20', '2026-11-21')");
for (const [k, v] of [['inv_legal_name', 'Aegis Knowledge Trust'], ['inv_gstin', '27AAATA1234B1Z5'], ['inv_state', 'Maharashtra'], ['inv_state_code', '27']]) db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', [k, v]);
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args = []) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      sql,
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { const out = []; for (const s of list) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); return out; },
};
const SECRET = 'smoke-session';
const envOf = (extra = {}) => new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SECRET, ELASTIC_EMAIL_API_KEY: 'test-key', DB: D1, ...extra }, { get: (t, k) => (k in t ? t[k] : undefined) });
const LIVE = envOf(SECRETS);
const waits = [];
const ctx = { waitUntil(p) { waits.push(p); }, passThroughOnException() {} };
const settled = async () => { await Promise.allSettled(waits.splice(0)); };
const ADMIN = { Authorization: 'Bearer smoke-admin' };

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

let mail = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { mail.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  throw new Error('no outside calls in this test: ' + url);
};
const hit = async (path, init = {}, env = LIVE) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { redirect: 'manual', ...init }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, h: Object.fromEntries(res.headers), text, json };
};
const GOOD = { pass_type: 'Delegate Pass', name: 'Asha Rao', email: 'Asha.Rao@Example.com', mobile: '98200 77777', company: 'Example Ltd', job_title: 'CIO', city: 'New Delhi', industry: 'Insurance' };
const pay = (o, headers = {}, env = LIVE) => hit('/api/delhi/pay', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(o) }, env);
const back = (o, over = {}) => hit('/pay/ccavenue/return', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ encResp: kitEncrypt(gatewayAnswer(SECRET, o, over)) }).toString() });
const person = (email) => rows('SELECT * FROM attendees WHERE email = ?', [email])[0];
const orders = (id) => rows('SELECT * FROM payment_orders WHERE attendee_id = ? ORDER BY id', [id]);
const bodyOf = (m) => m.Content.Body[0].Content;
const to = (addr) => mail.filter((m) => [...(m.Recipients.To || [])].includes(addr));

// A Mumbai pass holder and a Mumbai buyer who has not paid, to prove they stay untouched.
db.run(`INSERT INTO attendees (id, event_id, name, email, mobile, company, job_title, city, badge_type, payment_status, payment_amount) VALUES
  (1, 1, 'Mumbai Paid', 'mumbai.paid@example.com', '9000011111', 'M Ltd', 'CTO', 'Mumbai', 'Delegate Pass', 'paid', '10618.82'),
  (2, 1, 'Mumbai Unpaid', 'mumbai.unpaid@example.com', '9000022222', 'M Ltd', 'CTO', 'Mumbai', 'VIP Pass', 'pending', NULL)`);
db.run(`INSERT INTO payment_orders (order_id, attendee_id, event_id, pass_type, previous_badge, base_paise, gst_paise, amount_paise, status, paid_at) VALUES ('BAI1-MUMBAI00', 1, 1, 'Delegate Pass', 'Visitor Pass', 899900, 161982, 1061882, 'paid', datetime('now'))`);
const mumbaiBefore = JSON.stringify(rows('SELECT * FROM attendees WHERE event_id = 1 ORDER BY id'));
const boardBefore = (await hit('/api/admin/events/1/board', { headers: ADMIN })).json;

// ======== what the form's route refuses ========
for (const [what, o, word] of [
  ['no pass', { pass_type: '' }, 'Delegate, Premium'], ['a free pass', { pass_type: 'Visitor Pass' }, 'Delegate, Premium'], ['a pass that is not for sale', { pass_type: 'Media Pass' }, 'Delegate, Premium'],
  ['no name', { name: '' }, 'name'], ['no email', { email: '' }, 'email'], ['a bad email', { email: 'nope' }, 'email'], ['a mistyped email', { email: 'r@gmail.con' }, 'gmail.com'],
  ['no mobile', { mobile: '' }, 'mobile'], ['a short mobile', { mobile: '12345' }, '10 digits'], ['no organisation', { company: '' }, 'organisation'], ['no designation', { job_title: '' }, 'designation'],
  ['no city', { city: ' ' }, 'city'], ['no industry', { industry: '' }, 'industry'], ['an industry not on the list', { industry: 'Nonsense' }, 'industry'],
  ['a GSTIN that is not one', { billing: { legal_name: 'X', gstin: 'NOTAGSTIN', address: 'Y' } }, 'GSTIN'], ['a GSTIN with no address', { billing: { legal_name: 'X', gstin: '27AAATA1234B1Z5', address: '' } }, 'address'],
]) {
  const r = await pay({ ...GOOD, ...o });
  check(`refused, ${what}: says so, and saves nothing`, r.status === 400 && String(r.json?.error).includes(word) && !person('asha.rao@example.com'), r.text);
}
{
  const r = await pay(GOOD, {}, envOf());
  check('checkout off: a sentence for the buyer, no row, no other gateway', r.status === 503 && r.json.error.includes('not available just now') && !/muni/i.test(r.text) && !person('asha.rao@example.com'), r.text);
}
check('event 2 does not exist until someone buys', rows('SELECT id FROM events WHERE id = 2').length === 0);

// ======== one buyer, start to finish ========
const first = await pay(GOOD);
const asha = person('asha.rao@example.com');
const ashaOrder = orders(asha?.id)[0];
check('the form starts checkout', first.status === 201 && String(first.json?.pay_url).startsWith('/pay/ccavenue/'), first.text);
check('with the foreign key on: the first buyer brings event 2 into being', rows('SELECT title, start_date FROM events WHERE id = 2')[0]?.start_date === '2027-07-29');
check('they are an attendee of event 2, unpaid, email lowercased', asha.event_id === 2 && asha.badge_type === 'Delegate Pass' && asha.payment_status === 'pending' && asha.company === 'Example Ltd' && asha.job_title === 'CIO' && asha.city === 'New Delhi' && asha.industry === 'Insurance' && asha.registration_source === 'delhi-page', JSON.stringify(asha));
check('the order is event 2 at the earlier price: Rs 4,999 + GST = 5,898.82', ashaOrder.event_id === 2 && ashaOrder.base_paise === 499900 && ashaOrder.gst_paise === 89982 && ashaOrder.amount_paise === 589882 && ashaOrder.status === 'created' && first.json.amount === 5898.82, JSON.stringify(ashaOrder));
check('no sign-in session is handed out', !first.h['set-cookie'], first.h['set-cookie']);
check('no account-ready or networking email is set off (no register.self row)', rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'register.self'")[0].n === 0);
await settled();
check('nothing is emailed before the money lands', mail.length === 0, mail.length);

const checkout = await hit(first.json.pay_url);
const enc = (checkout.text.match(/name="encRequest" value="([0-9a-f]+)"/) || [])[1];
const sent = new URLSearchParams(kitDecrypt(enc));
check('checkout page: names Delhi and the amount, and goes back to the Delhi page', checkout.status === 200 && checkout.text.includes('for Delhi 2027') && checkout.text.includes('5,898.82') && checkout.text.includes('href="/delhi"') && checkout.text.includes('Bharat Mandapam') && !checkout.text.includes('WTC Mumbai') && !checkout.text.includes('href="/app"'), checkout.status);
check('the gateway is asked for that amount, and the order is marked Delhi in its reports', sent.get('amount') === '5898.82' && sent.get('order_id') === ashaOrder.order_id && sent.get('merchant_param3') === 'Delhi 2027' && sent.get('billing_email') === 'asha.rao@example.com', [...sent].join('&').slice(0, 200));

const landed = await back(ashaOrder);
await settled();
const paid = person('asha.rao@example.com');
check('the payment lands: back to the result page', landed.status === 303 && landed.h.location.startsWith('/pay/result?o='), landed.status);
check('the pass is confirmed, the money on the row, lunch included', paid.badge_type === 'Delegate Pass' && paid.payment_status === 'paid' && Number(paid.payment_amount) === 5898.82 && paid.lunch_inclusion === 'Yes', JSON.stringify(paid));
check('the order is final and written in the audit log', orders(paid.id)[0].status === 'paid' && rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'payment.received'")[0].n === 1);
const receipt = rows('SELECT * FROM invoices WHERE order_ref = ?', [ashaOrder.order_id])[0];
check('a receipt is raised, for Delhi, in the one RCT series', receipt && receipt.invoice_no.startsWith('RCT/') && receipt.item_desc === 'Delegate Pass - Bharat AI Innovation Delhi 2027' && receipt.total_paise === 589882, JSON.stringify(receipt));
const buyerMail = to('asha.rao@example.com');
check('the buyer gets two emails: the receipt and the confirmation', buyerMail.length === 2, buyerMail.map((m) => m.Content.Subject).join(' | '));
const rc = buyerMail.find((m) => m.Content.Subject.startsWith('Receipt'));
const wc = buyerMail.find((m) => m.Content.Subject.startsWith('Payment received'));
check('the receipt email is Delhi\'s: subject, dates, venue, accounts blind-copied, PDF attached', rc && rc.Content.Subject.includes('Delhi 2027') && bodyOf(rc).includes('Bharat Mandapam') && !bodyOf(rc).includes('WTC Mumbai') && (rc.Recipients.BCC || []).length === 1 && (rc.Content.Attachments || []).length === 1, rc?.Content?.Subject);
check('the confirmation is Delhi\'s: dates, venue, pass, amount', wc && wc.Content.Subject.includes('Delhi 2027') && bodyOf(wc).includes('Thursday 29 and Friday 30 July 2027') && bodyOf(wc).includes('Bharat Mandapam, Pragati Maidan') && bodyOf(wc).includes('5,898.82') && bodyOf(wc).includes(receipt.invoice_no), wc?.Content?.Subject);
check('it says the pass and app come later, carries no sign-in link and sells nothing', bodyOf(wc).includes('entry pass') && bodyOf(wc).includes('Closer to the event') && !/\/app|token=|upgrade|add your photo/i.test(bodyOf(wc)), (bodyOf(wc).match(/\/app|token=|upgrade|add your photo/i) || [])[0]);
check('it says Mumbai is a separate event, and that is its only mention of Mumbai', bodyOf(wc).includes('This pass is for Delhi only') && !bodyOf(wc).includes('WTC'));
check('both come from the official address', buyerMail.every((m) => m.Content.From.includes('register@bharataiinnovation.com')), buyerMail.map((m) => m.Content.From).join());
const teamMail = mail.filter((m) => m.Content.Subject.startsWith('Paid online, Delhi 2027'));
check('the team is told it is Delhi', teamMail.length === 1 && teamMail[0].Content.Subject.includes('Asha Rao') && teamMail[0].Content.Subject.includes('5,898.82'), mail.map((m) => m.Content.Subject).join(' | '));
{
  const result = await hit(landed.h.location);
  check('result page: Delhi, the amount, what happens next, no road to Mumbai\'s app', result.status === 200 && result.text.includes('Bharat AI Innovation Delhi 2027') && result.text.includes('5,898.82') && result.text.includes('closer to the event') && !result.text.includes('/app') && !result.text.includes('WTC Mumbai'), result.status);
  const before = mail.length;
  const again = await back(ashaOrder);
  await settled();
  check('a second copy of the answer changes nothing and sends nothing', again.status === 303 && mail.length === before && rows('SELECT COUNT(*) AS n FROM invoices WHERE order_ref = ?', [ashaOrder.order_id])[0].n === 1);
}

// ======== buying again, moving up ========
{
  const same = await pay(GOOD);
  check('same pass again: told it is confirmed, no order', same.status === 409 && same.json.code === 'already_confirmed' && same.json.error.includes('already confirmed') && orders(paid.id).length === 1, same.text);
  const lower = await pay({ ...GOOD, pass_type: 'Academic Pass' });
  check('a cheaper pass: refused', lower.status === 409 && orders(paid.id).length === 1, lower.text);
  const other = await pay({ ...GOOD, mobile: '9111122222', pass_type: 'VIP Pass' });
  check('same email, another mobile: refused, and it does not say which mobile', other.status === 409 && other.json.code === 'email_registered' && !other.text.includes('77777') && orders(paid.id).length === 1, other.text);
  const up = await pay({ ...GOOD, pass_type: 'VIP Pass' });
  const upOrder = orders(paid.id)[1];
  check('up to VIP: charged the difference at Delhi\'s prices (15,000 + GST = 17,700)', up.status === 201 && upOrder.amount_paise === 1770000 && upOrder.base_paise === 1500000 && upOrder.previous_badge === 'Delegate Pass', JSON.stringify(upOrder));
  const page = await hit(up.json.pay_url);
  check('its checkout page says Upgrade', page.text.includes('Upgrade to VIP Pass for Delhi 2027'));
  mail = [];
  await back(upOrder);
  await settled();
  const vip = person('asha.rao@example.com');
  check('after paying: VIP, and the total paid adds up', vip.badge_type === 'VIP Pass' && vip.payment_status === 'paid' && Number(vip.payment_amount) === 23598.82, JSON.stringify(vip));
  const r = rows('SELECT * FROM invoices WHERE order_ref = ?', [upOrder.order_id])[0];
  check('its receipt says what the difference was for', r.item_desc === 'Upgrade from Delegate Pass to VIP Pass - Bharat AI Innovation Delhi 2027', r.item_desc);
  check('the email says moved up', to('asha.rao@example.com').some((m) => bodyOf(m).includes('is now a <strong>VIP Pass</strong>')));
}

// ======== one mobile, one person; a Mumbai holder may also come to Delhi ========
{
  const taken = await pay({ ...GOOD, email: 'someone.else@example.com', mobile: '+91-98200-77777' });
  check('someone else with that mobile, however typed: refused, masked, no row', taken.status === 409 && taken.json.code === 'mobile_registered' && taken.json.error.includes('•••@example.com') && !taken.text.includes('asha.rao') && !person('someone.else@example.com'), taken.text);
  const both = await pay({ ...GOOD, email: 'mumbai.paid@example.com', mobile: '9000011111', pass_type: 'Premium Delegate Pass' });
  const two = rows("SELECT * FROM attendees WHERE email = 'mumbai.paid@example.com' ORDER BY event_id");
  check('a Mumbai pass holder may buy for Delhi with the same email and mobile: a second row, apart', both.status === 201 && two.length === 2 && two[0].event_id === 1 && two[1].event_id === 2 && two[1].badge_type === 'Premium Delegate Pass', both.text);
  check('and no Mumbai session or row is touched', !both.h['set-cookie'] && two[0].badge_type === 'Delegate Pass');
}

// ======== the prices, and the Academic Pass ========
for (const [pass, paise] of [['Premium Delegate Pass', 1179882], ['VIP Pass', 2359882], ['Academic Pass', 117882]]) {
  const email = pass.split(' ')[0].toLowerCase() + '@example.com';
  const r = await pay({ ...GOOD, pass_type: pass, email, mobile: String(9200000000 + paise) });
  check(`${pass}: charged ${paise / 100}`, r.status === 201 && orders(person(email).id)[0].amount_paise === paise, r.text);
}
{
  const { job_title, ...noJob } = GOOD;
  const r = await pay({ ...noJob, pass_type: 'Academic Pass', email: 'student@example.com', mobile: '9300000001', company: 'A College' });
  check('Academic: no designation needed, and the college is kept', r.status === 201 && person('student@example.com').company === 'A College', r.text);
  const noCollege = await pay({ ...noJob, pass_type: 'Academic Pass', email: 's2@example.com', mobile: '9300000002', company: '' });
  check('Academic with no college: asked for by that name', noCollege.status === 400 && noCollege.json.error.includes('college name'), noCollege.text);
  const st = person('student@example.com');
  mail = [];
  await back(orders(st.id)[0]);
  await settled();
  check('Academic: no lunch', person('student@example.com').lunch_inclusion === 'No');
}

// ======== a GST invoice in a company's name ========
{
  const email = 'gst.buyer@example.com';
  const r = await pay({ ...GOOD, email, mobile: '9400000001', billing: { legal_name: 'Acme Pvt Ltd', gstin: '07AAACA1234B1Z5', address: 'Connaught Place, New Delhi' } });
  const a = person(email);
  await back(orders(a.id)[0]);
  await settled();
  const inv = rows('SELECT * FROM invoices WHERE attendee_id = ?', [a.id])[0];
  check('the details on the form reach the receipt', r.status === 201 && inv.buyer_company === 'Acme Pvt Ltd' && inv.buyer_gstin === '07AAACA1234B1Z5' && inv.buyer_address.includes('Connaught'), JSON.stringify(inv));
}

// ======== it does not always go through ========
{
  const email = 'bank.no@example.com';
  await pay({ ...GOOD, email, mobile: '9500000001', pass_type: 'VIP Pass' });
  const a = person(email);
  const o = orders(a.id)[0];
  mail = [];
  const r = await back(o, { order_status: 'Aborted' });
  await settled();
  const page = await hit(r.h.location);
  const tok = decodeURIComponent(r.h.location.split('o=')[1]);
  check('cancelled: still unpaid, no email, the page offers Try again on Delhi\'s route', person(email).payment_status === 'pending' && mail.length === 0 && page.text.includes('You cancelled the payment') && page.text.includes('/api/delhi/pay-again') && !page.text.includes('/api/payments/ccavenue/start') && !page.text.includes('/app'), page.status);
  const again = await hit('/api/delhi/pay-again', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ o: tok }) });
  const o2 = orders(a.id)[1];
  check('Try again: a new order, same pass, same price', again.status === 201 && o2.pass_type === 'VIP Pass' && o2.amount_paise === 2359882 && o2.order_id !== o.order_id, again.text);
  const forged = await hit('/api/delhi/pay-again', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ o: o.order_id + '.0000' }) });
  check('a forged link is refused', forged.status === 400, forged.text);
  const mumbaiLink = await hit('/api/delhi/pay-again', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ o: 'BAI1-MUMBAI00.' }) });
  check('a Mumbai order cannot be restarted through it', mumbaiLink.status === 400, mumbaiLink.text);
  const wrong = await back(o2, { amount: '1.00' });
  await settled();
  check('Success for another amount: unlocks nothing, and the team is told', person(email).payment_status === 'pending' && orders(a.id)[1].status === 'mismatch' && wrong.status === 303 && mail.some((m) => m.Content.Subject.startsWith('CHECK THIS PAYMENT')), orders(a.id)[1].status);
  const mis = await hit(wrong.h.location);
  check('and the buyer is told it is being checked, on a Delhi page', mis.text.includes('We need to check this payment') && mis.text.includes('Bharat Mandapam') && !mis.text.includes('/app'));
}
{
  const email = 'pending.change@example.com';
  await pay({ ...GOOD, email, mobile: '9600000001', pass_type: 'VIP Pass' });
  const r = await pay({ ...GOOD, email, mobile: '9600000001', pass_type: 'Delegate Pass' });
  const a = person(email);
  check('changing their mind before paying: a new order, and the list shows what they chose', r.status === 201 && a.badge_type === 'Delegate Pass' && orders(a.id).length === 2 && orders(a.id)[1].amount_paise === 589882, JSON.stringify(a));
}
{
  // Limits, as in Mumbai: ten orders per person in an hour; many from one connection.
  const email = 'many.tries@example.com';
  let last;
  for (let i = 0; i < 11; i++) last = await pay({ ...GOOD, email, mobile: '9700000001' });
  check('the 11th try in an hour is refused, in plain words', last.status === 429 && last.json.error.includes('payment attempts') && orders(person(email).id).length === 10, last.text);
  const ip = { 'CF-Connecting-IP': '203.0.113.20' };
  for (let i = 0; i < 60; i++) db.run("INSERT INTO admin_audit (action, entity, ip) VALUES ('delhi.pay', 'attendee', ?)", ['203.0.113.20']);
  const flood = await pay({ ...GOOD, email: 'flood@example.com', mobile: '9700000002' }, ip);
  check('the 61st from one connection in an hour is refused', flood.status === 429 && flood.json.error.includes('Too many') && !person('flood@example.com'), flood.text);
}

// ======== Mumbai sees none of it ========
{
  check('no Mumbai row was changed by any of this', JSON.stringify(rows('SELECT * FROM attendees WHERE event_id = 1 ORDER BY id')) === mumbaiBefore);
  const board = (await hit('/api/admin/events/1/board', { headers: ADMIN })).json;
  check('Overview: Mumbai\'s passes and money did not move', JSON.stringify(board.passes) === JSON.stringify(boardBefore.passes) && JSON.stringify(board.money) === JSON.stringify(boardBefore.money), JSON.stringify(board.money));
  const delhiPaid = rows("SELECT COUNT(*) AS n FROM attendees WHERE event_id = 2 AND payment_status = 'paid'")[0].n;
  const delhiMoney = rows("SELECT SUM(amount_paise) AS n FROM payment_orders WHERE event_id = 2 AND status = 'paid'")[0].n;
  const delhiUnpaid = rows("SELECT COUNT(*) AS n FROM attendees WHERE event_id = 2 AND payment_status = 'pending'")[0].n;
  check('Overview: Delhi has its own line, and the figures are right', board.todo.delhi_sales.paid === delhiPaid && board.todo.delhi_sales.paise === delhiMoney && board.todo.delhi_sales.unpaid === delhiUnpaid, JSON.stringify(board.todo.delhi_sales));
  check('Overview: Mumbai\'s "waiting on you" counts no unpaid Delhi buyer', board.todo.not_paid === boardBefore.todo.not_paid, board.todo.not_paid);

  const q = (await hit('/api/admin/payments-pending', { headers: ADMIN })).json;
  check('Payments, not yet paid: Mumbai\'s only', q.results.length === 1 && q.results[0].email === 'mumbai.unpaid@example.com', JSON.stringify(q.results.map((x) => x.email)));
  const dOnline = q.paid_online.find((o) => o.email === 'asha.rao@example.com');
  check('Payments, paid online: a Delhi order waits for its GST invoice, marked, with the right words', dOnline && dOnline.pass_type.startsWith('Delhi 2027: ') && dOnline.item_desc.includes('Bharat AI Innovation Delhi 2027') && !dOnline.item_desc.includes('2026'), JSON.stringify(dOnline));
  const mOnline = q.paid_online.find((o) => o.email === 'mumbai.paid@example.com');
  check('and a Mumbai order is exactly as before', mOnline && mOnline.pass_type === 'Delegate Pass' && !mOnline.item_desc, JSON.stringify(mOnline));

  const list = await hit('/api/admin/delhi/passes', { headers: ADMIN });
  const shown = list.json.results.find((x) => x.email === 'asha.rao@example.com');
  check('Admin: the Delhi list has them, with what they paid', list.status === 200 && shown.badge_type === 'VIP Pass' && shown.paid_paise === 2359882 && shown.mobile === '98200 77777' && !list.json.results.some((x) => x.id === 1 || x.id === 2), JSON.stringify(shown));
  check('Admin: a stranger cannot read it', [401, 403].includes((await hit('/api/admin/delhi/passes')).status));
  const adminJs = await hit('/admin.js');
  check('Admin: the Overview line and the list are in the page', adminJs.text.includes('function openDelhiPasses') && adminJs.text.includes('Delhi 2027 passes paid for'));

  for (const p of ['/api/events/2', '/api/events/2/attendees', '/api/events/2/glimpse', '/api/events/2/attendee-filters', '/api/events/2/suggested-attendees', '/api/events/2/stats']) {
    const r = await hit(p);
    check(`${p}: refused, so no public route lists a Delhi buyer`, r.status === 404 && !r.text.includes('Asha'), r.status + ' ' + r.text.slice(0, 80));
  }
  const reg = await hit('/api/events/2/attendees/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X', email: 'x2@example.com', mobile: '9800000001', company: 'X', job_title: 'Y', city: 'Z', industry: 'Insurance' }) });
  check('nobody can register into event 2 through Mumbai\'s route', reg.status === 404 && !person('x2@example.com'), reg.status);
  const link = await hit('/api/events/2/attendees/send-magic-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'asha.rao@example.com' }) });
  check('nor ask for a sign-in link to it', link.status === 404, link.status);
  check('Mumbai\'s own route still answers', (await hit('/api/events/1')).status === 200);

  const exp = await hit('/api/external/attendees-export', { headers: { Authorization: 'Bearer ex' } }, envOf({ ...SECRETS, ATTENDEE_EXPORT_SECRET: 'ex' }));
  check('the AImailPilot export stays Mumbai\'s', exp.status === 200 && !exp.text.includes('asha.rao@example.com') && exp.text.includes('mumbai.paid@example.com'), exp.status);

  // The badge desk's search, on the real SQL.
  db.run("INSERT INTO staff (id, name, username, password_hash, role) VALUES (1, 'Desk One', 'desk1', 'x', 'desk')");
  const desk = { headers: { Cookie: staffCookie(SECRET, 1) } };
  const deskDelhi = await hit('/api/staff/lookup?q=asha.rao', desk);
  check('the Mumbai desk cannot find a Delhi buyer', deskDelhi.status === 200 && deskDelhi.json.results.length === 0, deskDelhi.text.slice(0, 160));
  const deskMumbai = await hit('/api/staff/lookup?q=mumbai.paid', desk);
  check('and finds a Mumbai one, once, though they hold a Delhi pass too', deskMumbai.status === 200 && deskMumbai.json.results.length === 1 && deskMumbai.json.results[0].name === 'Mumbai Paid', deskMumbai.text.slice(0, 160));

  // The minute clock, as the scheduler calls it, with everything due: not one email to a Delhi buyer.
  mail = [];
  db.run("UPDATE admin_audit SET created_at = datetime('now', '-20 minutes') WHERE action = 'payment.received'");
  const tick = await hit('/api/cron/tick', { method: 'POST', headers: ADMIN });
  await settled();
  const delhiEmails = new Set(rows('SELECT email FROM attendees WHERE event_id = 2').map((r) => r.email));
  const reached = mail.flatMap((m) => m.Recipients.To || []).filter((e) => delhiEmails.has(e) && e !== 'mumbai.paid@example.com');
  check('the minute clock sends a Delhi buyer nothing', tick.status === 200 && reached.length === 0, tick.status + ' ' + reached.join(', '));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
