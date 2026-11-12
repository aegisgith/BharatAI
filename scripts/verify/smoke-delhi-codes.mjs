// Integration: partner and discount codes on Delhi 2027 passes (12 Nov 2026), on the built
// worker with real SQLite, the production schema and migration 0061; the gateway played by
// Node's crypto as CCAvenue's kits write it (pay-db.mjs), the email service played here.
//  - Admin makes codes (checked in words) and sees each one's sales and buyers;
//  - the form asks the price with a code: percent off in whole rupees, GST on the rest;
//    wrong, expired, paused, used-up and wrong-pass codes are refused in words; guessing
//    from one connection is stopped;
//  - a coded order is paid through the gateway at its own price: receipt, emails, sales;
//  - 0% only counts the sale; Try again keeps the code while it still works;
//  - a code is for a new pass, not for moving up; with no code nothing changes.
// Run after `npm run build`:  node scripts/verify/smoke-delhi-codes.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SECRETS, kitEncrypt, gatewayAnswer } from './pay-db.mjs';
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
const LIVE = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SECRET, ELASTIC_EMAIL_API_KEY: 'test-key', DB: D1, ...SECRETS }, { get: (t, k) => (k in t ? t[k] : undefined) });
const waits = [];
const ctx = { waitUntil(p) { waits.push(p); }, passThroughOnException() {} };
const settled = async () => { await Promise.allSettled(waits.splice(0)); };
const ADMIN = { Authorization: 'Bearer smoke-admin', 'Content-Type': 'application/json' };
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
let mail = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { mail.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  throw new Error('no outside calls in this test: ' + url);
};
const hit = async (path, init = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { redirect: 'manual', ...init }), LIVE, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const BUYER = (n, over = {}) => ({ pass_type: 'Delegate Pass', name: 'Buyer ' + n, email: 'buyer' + n + '@example.com', mobile: '98200 1' + String(n).padStart(4, '0'), company: 'Co ' + n, job_title: 'CIO', city: 'New Delhi', industry: 'Insurance', ...over });
const pay = (o) => hit('/api/delhi/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
const price = (code, pass = 'Delegate Pass', ip = '10.0.0.1') => hit('/api/delhi/code?code=' + encodeURIComponent(code) + '&pass=' + encodeURIComponent(pass), { headers: { 'CF-Connecting-IP': ip } });
const back = (o, over = {}) => hit('/pay/ccavenue/return', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ encResp: kitEncrypt(gatewayAnswer(SECRET, o, over)) }).toString() });
const make = (o) => hit('/api/admin/delhi/codes', { method: 'POST', headers: ADMIN, body: JSON.stringify(o) });
const person = (email) => rows('SELECT * FROM attendees WHERE email = ?', [email])[0];
const orderOf = (email) => rows('SELECT o.* FROM payment_orders o JOIN attendees a ON a.id = o.attendee_id WHERE a.email = ? ORDER BY o.id DESC', [email])[0];
const yesterday = new Date(Date.now() + 330 * 60000 - 86400000).toISOString().slice(0, 10);

// ---- before 0061 ----
let r = await price('NASSCOM20');
check('before 0061 a code is simply not valid', r.status === 400 && /not valid/.test(r.json?.error || ''), r.text);
r = await pay(BUYER(1, { code: '' }));
check('before 0061, buying with no code works as before', r.status === 201 && r.json?.amount === 5898.82, r.text);
r = await hit('/api/admin/delhi/codes', { headers: ADMIN });
check('before 0061 Admin is told to apply it', r.status === 200 && r.json?.ready === false, r.text);
db.exec(readFileSync(new URL('../../migrations/0061_delhi_codes.sql', import.meta.url), 'utf8'));

// ---- Admin makes codes ----
r = await hit('/api/admin/delhi/codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'X1X', partner: 'P' }) });
check('making a code needs Admin', r.status === 401 || r.status === 403, String(r.status));
for (const [what, o, word] of [['a code with a space', { code: 'NO GOOD', partner: 'P' }, '3 to 24'], ['no partner', { code: 'NOPARTNER' }, 'whose code'], ['95% off', { code: 'TOOMUCH', partner: 'P', percent: 95 }, '0 to 90'], ['a bad date', { code: 'BADDATE', partner: 'P', valid_until: '31/12/2027' }, 'date']]) {
  r = await make(o);
  check('refused, ' + what + ', in words', r.status === 400 && (r.json?.error || '').includes(word), r.text);
}
for (const o of [
  { code: 'nasscom20', partner: 'NASSCOM community', percent: 20 },
  { code: 'VIP10', partner: 'CXO club', percent: 10, passes: ['VIP Pass'] },
  { code: 'OLDCODE', partner: 'Old campaign', percent: 15, valid_until: yesterday },
  { code: 'COUNTONLY', partner: 'IIT alumni', percent: 0 },
  { code: 'ONEUSE', partner: 'One partner', percent: 50, max_uses: 1 },
  { code: 'PAUSEME', partner: 'Paused partner', percent: 30 },
]) { r = await make(o); if (r.status !== 201) check('made ' + o.code, false, r.text); }
check('codes are stored upper case', rows("SELECT code FROM delhi_codes WHERE code = 'NASSCOM20'").length === 1);
r = await make({ code: 'NASSCOM20', partner: 'Again' });
check('the same code twice is refused', r.status === 409, r.text);
await hit('/api/admin/delhi/codes/PAUSEME', { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) });

// ---- the price with a code ----
r = await price('nasscom20');
check('20% off a Delegate Pass: Rs 3,999 + GST = 4,718.82 (list 5,898.82)', r.status === 200 && r.json?.percent === 20 && r.json?.total === 4718.82 && r.json?.list_total === 5898.82 && r.json?.base === 3999 && r.json?.gst === 719.82, r.text);
r = await price('NASSCOM20', 'Academic Pass');
check('20% off an Academic Pass rounds to whole rupees: Rs 799 + GST = 942.82', r.json?.total === 942.82, r.text);
for (const [what, code, pass, word] of [['a wrong code', 'NOPE', 'Delegate Pass', 'not valid'], ['a code for VIP only', 'VIP10', 'Delegate Pass', 'not for the Delegate Pass. It works for: VIP Pass'], ['an expired code', 'OLDCODE', 'Delegate Pass', 'expired'], ['a paused code', 'PAUSEME', 'Delegate Pass', 'not valid'], ['a code with a symbol', 'A<B>', 'Delegate Pass', 'not valid']]) {
  r = await price(code, pass);
  check('refused, ' + what + ', in words', r.status === 400 && (r.json?.error || '').includes(word), r.text);
}
r = await price('VIP10', 'VIP Pass');
check('the VIP code works on a VIP Pass', r.status === 200 && r.json?.total === 21238.82, r.text);
for (let i = 0; i < 20; i++) await price('GUESS' + i, 'Delegate Pass', '10.9.9.9');
r = await price('NASSCOM20', 'Delegate Pass', '10.9.9.9');
check('20 wrong codes from one connection: it waits an hour', r.status === 429, r.text);

// ---- paying with a code ----
mail = [];
r = await pay(BUYER(2, { code: 'NOPE' }));
check('a wrong code at checkout is refused before anything is saved', r.status === 400 && r.json?.field === 'code' && !person('buyer2@example.com'), r.text);
r = await pay(BUYER(2, { code: 'nasscom20' }));
const o2 = orderOf('buyer2@example.com');
const use2 = rows('SELECT * FROM delhi_code_orders WHERE order_id = ?', [o2?.order_id])[0];
check('checkout with the code: the order is 4,718.82 and the code is on it', r.status === 201 && r.json?.amount === 4718.82 && o2.amount_paise === 471882 && o2.base_paise === 399900 && o2.gst_paise === 71982 && use2?.code === 'NASSCOM20' && use2.list_paise === 589882 && use2.discount_paise === 118000, r.text + JSON.stringify(use2));
await back(o2);
await settled();
const p2 = person('buyer2@example.com');
const rc2 = rows('SELECT * FROM invoices WHERE order_ref = ?', [o2.order_id])[0];
check('the gateway pays that amount: the pass is confirmed, not a mismatch', orderOf('buyer2@example.com').status === 'paid' && p2.payment_status === 'paid' && Number(p2.payment_amount) === 4718.82, JSON.stringify(orderOf('buyer2@example.com')));
check('the receipt is for what was paid', rc2 && rc2.total_paise === 471882, JSON.stringify(rc2));
const conf = mail.find((m) => m.Content.Subject.startsWith('Payment received') && m.Recipients.To.includes('buyer2@example.com'));
check('the confirmation says which code: NASSCOM20 (20% off)', conf && conf.Content.Body[0].Content.includes('NASSCOM20 (20% off)') && conf.Content.Body[0].Content.includes('4,718.82'), conf ? 'no code line' : 'no email');

// ---- 0%: only counts ----
r = await pay(BUYER(3, { code: 'countonly', pass_type: 'Premium Delegate Pass' }));
const o3 = orderOf('buyer3@example.com');
check('a 0% code charges the list price and still counts the sale', r.json?.amount === 11798.82 && rows('SELECT discount_paise FROM delhi_code_orders WHERE order_id = ?', [o3.order_id])[0]?.discount_paise === 0, r.text);
await back(o3);
await settled();

// ---- one use ----
r = await pay(BUYER(4, { code: 'ONEUSE' }));
const o4 = orderOf('buyer4@example.com');
check('half off rounds to whole rupees: Rs 2,500 + GST = 2,950', r.json?.amount === 2950, r.text);
r = await price('ONEUSE');
check('started but not paid does not use it up', r.status === 200, r.text);
await back(o4);
await settled();
r = await price('ONEUSE');
check('paid once: the one-use code is used up', r.status === 400 && /used up/.test(r.json?.error || ''), r.text);

// ---- Try again keeps the code ----
r = await pay(BUYER(5, { code: 'NASSCOM20' }));
const o5 = orderOf('buyer5@example.com');
await back(o5, { order_status: 'Aborted' });
await settled();
const token = String(r.json?.pay_url || '').split('/').pop();
r = await hit('/api/delhi/pay-again', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ o: token }) });
const o5b = orderOf('buyer5@example.com');
check('Try again keeps the code and its price', r.status === 201 && r.json?.amount === 4718.82 && o5b.order_id !== o5.order_id && rows('SELECT code FROM delhi_code_orders WHERE order_id = ?', [o5b.order_id])[0]?.code === 'NASSCOM20', r.text);
await hit('/api/admin/delhi/codes/NASSCOM20', { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) });
r = await hit('/api/delhi/pay-again', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ o: token }) });
check('once the code is paused, Try again says so instead of charging more', r.status === 409 && /no longer works/.test(r.json?.error || '') && /full price/.test(r.json?.error || ''), r.text);
await hit('/api/admin/delhi/codes/NASSCOM20', { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: true }) });

// ---- moving up ----
r = await pay(BUYER(2, { pass_type: 'Premium Delegate Pass', code: 'NASSCOM20' }));
check('a code is for a new pass, not for moving up', r.status === 400 && /not for moving up/.test(r.json?.error || ''), r.text);
r = await pay(BUYER(2, { pass_type: 'Premium Delegate Pass' }));
check('moving up without a code costs the difference, as before: 5,900', r.status === 201 && r.json?.amount === 5900, r.text);

// ---- Admin sees the sales ----
r = await hit('/api/admin/delhi/codes', { headers: ADMIN });
const n20 = (r.json?.codes || []).find((x) => x.code === 'NASSCOM20') || {};
check('Admin: NASSCOM20 sold 1 (Rs 4,718.82 received, Rs 1,180 off), 2 people started, with its link', n20.paid === 1 && n20.paid_paise === 471882 && n20.discount_paise === 118000 && n20.started === 2 && n20.link === 'https://bharataiinnovation.com/delhi-register?code=NASSCOM20', JSON.stringify(n20));
r = await hit('/api/admin/delhi/codes/NASSCOM20/orders', { headers: ADMIN });
check("Admin: the code's buyers, paid and not", (r.json?.results || []).length === 3 && r.json.results.some((x) => x.email === 'buyer2@example.com' && x.status === 'paid'), r.text.slice(0, 300));
r = await hit('/api/admin/delhi/codes');
check('the list needs Admin', r.status === 401 || r.status === 403, String(r.status));

console.log(fails ? `\n${fails} FAILED` : '\nall Delhi code checks passed');
process.exit(fails ? 1 : 0);
