// Integration: AI Agent Summit 2027 as event 3 (15 Nov 2026), on the built worker with real
// SQLite and the production schema; the gateway played by Node's crypto (pay-db.mjs), the
// email service played here.
//  - a free Visitor Pass: an event-3 attendee, event 3 made by the first registration,
//    one email with no Bharat AI app block; the same email again is the same registration;
//  - a Buyer Pass needs organisation and title, waits for the team, and the team is told;
//  - a paid Delegate Pass makes an event-3 order at the early price, and the checkout link is
//    on bharataiinnovation.com even when the form was on another host; the gateway's answer
//    confirms the pass, emails summit wording, and the result page is the summit's;
//  - a showcase application and a partner enquiry land on the Inquiries desk (event 1 rows,
//    told apart by metadata.edition), the team is told, a repeat application is the same one;
//  - the app's public routes refuse event 3; the Admin list needs Admin and lists event 3 only.
// Run after `npm run build`:  node scripts/verify/smoke-agent-summit.mjs
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
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SECRET, ELASTIC_EMAIL_API_KEY: 'test-key', DB: D1, ...SECRETS }, { get: (t, k) => (k in t ? t[k] : undefined) });
const waits = [];
const ctx = { waitUntil(p) { waits.push(p); }, passThroughOnException() {} };
const settled = async () => { await Promise.allSettled(waits.splice(0)); };
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
let mail = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { mail.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  throw new Error('no outside calls in this test: ' + url);
};
const hit = async (path, init = {}, host = 'https://bharataiinnovation.com') => {
  const res = await worker.fetch(new Request(host + path, { redirect: 'manual', ...init }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, location: res.headers.get('location') };
};
const post = (path, o, ip = '10.3.3.3', host) => hit(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(o) }, host);
const bodyOf = (m) => m.Content.Body[0].Content;
const to = (addr) => mail.filter((m) => m.Recipients.To.includes(addr));

// ---- free Visitor Pass ----
const V = { pass: 'visitor', first_name: 'Asha', last_name: 'Rao', email: 'Asha.Rao@Example.com', phone: '98200 11111', consent: 'yes' };
let r = await post('/api/agent-summit/pass', { ...V, consent: '' });
check('no consent: refused in words, nothing saved', r.status === 400 && r.json?.errors?.some((e) => e.field === 'consent') && rows('SELECT COUNT(*) AS n FROM attendees')[0].n === 0, r.text);
r = await post('/api/agent-summit/pass', { ...V, phone: '12345' });
check('a short mobile: refused on the phone field', r.status === 400 && r.json?.errors?.some((e) => e.field === 'phone'), r.text);
mail = [];
r = await post('/api/agent-summit/pass', V);
await settled();
const asha = rows('SELECT * FROM attendees WHERE email = ?', ['asha.rao@example.com'])[0] || {};
check('a Visitor Pass is an event-3 attendee, confirmed, nothing owed', r.status === 201 && r.json?.status === 'confirmed' && asha.event_id === 3 && asha.badge_type === 'Visitor Pass' && asha.payment_status === 'paid' && asha.name === 'Asha Rao', r.text + ' ' + JSON.stringify(asha));
check('the first registration brings event 3 into being', rows('SELECT title FROM events WHERE id = 3')[0]?.title === 'AI Agent Summit 2027', JSON.stringify(rows('SELECT * FROM events')));
const ashaMail = to('asha.rao@example.com')[0];
check('one email to them, in summit words, with no Bharat AI app block', to('asha.rao@example.com').length === 1 && /AI Agent Summit 2027/.test(ashaMail.Content.Subject) && /Visitor Pass/.test(bodyOf(ashaMail)) && !/Save the Bharat AI app|Get the app/i.test(bodyOf(ashaMail)), ashaMail ? ashaMail.Content.Subject : 'none');
mail = [];
r = await post('/api/agent-summit/pass', { ...V, email: 'asha.rao@example.com' });
check('the same email again: the same registration, no second email', r.status === 200 && r.json?.already === true && rows('SELECT COUNT(*) AS n FROM attendees WHERE event_id = 3')[0].n === 1 && mail.length === 0, r.text);
r = await post('/api/agent-summit/pass', { ...V, email: 'someone.else@example.com' });
check('the same mobile with another email: refused', r.status === 409 && r.json?.code === 'mobile_registered', r.text);

// ---- Buyer Pass ----
const B = { pass: 'buyer', first_name: 'Vikram', last_name: 'Shah', email: 'vikram@bigbank.example.com', phone: '98200 22222', organization: 'Big Bank', consent: 'on' };
r = await post('/api/agent-summit/pass', B);
check('a Buyer Pass without a job title: refused on that field', r.status === 400 && r.json?.errors?.some((e) => e.field === 'job_title'), r.text);
mail = [];
r = await post('/api/agent-summit/pass', { ...B, job_title: 'CIO' });
await settled();
check('a Buyer Pass waits for the team', r.status === 201 && r.json?.status === 'under_review' && rows('SELECT badge_type FROM attendees WHERE email = ?', ['vikram@bigbank.example.com'])[0]?.badge_type === 'Buyer Pass', r.text);
check('the buyer is told and the team is told', to('vikram@bigbank.example.com').length === 1 && mail.some((m) => /Buyer Pass request, AI Agent Summit/.test(m.Content.Subject)), mail.map((m) => m.Content.Subject).join(' | '));

// ---- paid Delegate Pass, from the summit's own domain ----
const D = { pass: 'delegate', first_name: 'Neha', last_name: 'Iyer', email: 'neha@agentco.example.com', phone: '98200 33333', organization: 'AgentCo', job_title: 'Head of AI', city: 'Pune', consent: 'yes' };
r = await post('/api/agent-summit/pass', D, '10.3.3.3', 'https://aiagentsummit.com');
const order = rows("SELECT o.* FROM payment_orders o JOIN attendees a ON a.id = o.attendee_id WHERE a.email = 'neha@agentco.example.com'")[0] || {};
const early = Date.now() <= Date.parse('2027-01-31T23:59:59+05:30');
const base = (early ? 2499 : 3999) * 100;
check('a Delegate Pass makes an event-3 order at ' + (early ? 'the early price, Rs 2,499' : 'Rs 3,999') + ' plus 18% GST', r.status === 201 && order.event_id === 3 && order.pass_type === 'Delegate Pass' && order.base_paise === base && order.gst_paise === Math.round(base * 0.18) && order.amount_paise === base + Math.round(base * 0.18), r.text + ' ' + JSON.stringify(order));
check('the checkout link is on bharataiinnovation.com, the address CCAvenue knows, though the form was elsewhere', /^https:\/\/bharataiinnovation\.com\/pay\/ccavenue\//.test(r.json?.pay_url || ''), r.json?.pay_url);
check('the attendee waits for the gateway', rows('SELECT payment_status FROM attendees WHERE email = ?', ['neha@agentco.example.com'])[0]?.payment_status === 'pending', '');
const checkout = await hit(new URL(r.json.pay_url).pathname);
check('the checkout page names the summit and marks the order for CCAvenue reports', checkout.status === 200 && /for AI Agent Summit 2027/.test(checkout.text) && /AI Agent Summit 2027/.test(checkout.text) && /\/ai-agent-summit\/attend/.test(checkout.text), checkout.text.slice(0, 300));
mail = [];
r = await hit('/pay/ccavenue/return', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ encResp: kitEncrypt(gatewayAnswer(SECRET, order)) }).toString() });
await settled();
const neha = rows('SELECT * FROM attendees WHERE email = ?', ['neha@agentco.example.com'])[0] || {};
check('the gateway confirms the pass', neha.payment_status === 'paid' && neha.badge_type === 'Delegate Pass' && rows('SELECT status FROM payment_orders WHERE id = ?', [order.id])[0]?.status === 'paid', JSON.stringify(neha));
const welcome = to('neha@agentco.example.com').find((m) => /Payment received/.test(m.Content.Subject));
check('the buyer gets the summit payment email, with no Bharat AI app block', !!welcome && /AI Agent Summit 2027/.test(welcome.Content.Subject) && /World Trade Center/.test(bodyOf(welcome)) && !/Save the Bharat AI app/i.test(bodyOf(welcome)), mail.map((m) => m.Content.Subject).join(' | '));
check('the team is told it was paid online for the summit', mail.some((m) => /Paid online, AI Agent Summit/.test(m.Content.Subject)), mail.map((m) => m.Content.Subject).join(' | '));
const receipt = rows("SELECT item_desc FROM invoices WHERE order_ref = ?", [order.order_id])[0];
check('the receipt names the summit', !receipt || /AI Agent Summit 2027/.test(receipt.item_desc), JSON.stringify(receipt));
const loc = r.location || '';
const result = loc ? await hit(new URL(loc, 'https://bharataiinnovation.com').pathname + new URL(loc, 'https://bharataiinnovation.com').search) : { status: 0, text: '' };
check('the result page is the summit\'s', result.status === 200 && /AI Agent Summit 2027 is confirmed/.test(result.text), loc + ' ' + result.text.slice(0, 200));

// ---- showcase application ----
const A = { package: 'growth', company: 'AgentCo', agent_name: 'InvoiceBot', category: 'finance-ops', stage: 'pilots', agent_summary: 'Reconciles vendor invoices against purchase orders and routes mismatches to finance.', contact_name: 'Neha Iyer', email: 'Neha@AgentCo.example.com', phone: '+91 98200 33333', demo_url: 'https://loom.example/x', consent: 'yes' };
r = await post('/api/agent-summit/apply', { ...A, agent_summary: 'too short' });
check('a showcase application with a short description: refused on that field', r.status === 400 && r.json?.errors?.some((e) => e.field === 'agent_summary'), r.text);
mail = [];
r = await post('/api/agent-summit/apply', A);
await settled();
const app = rows("SELECT * FROM inquiries WHERE inquiry_type = 'agent_showcase'")[0] || {};
const meta = JSON.parse(app.metadata || '{}');
check('an application is an agent_showcase enquiry, event 1, edition agent-summit-2027', r.status === 201 && app.event_id === 1 && meta.edition === 'agent-summit-2027' && meta.package === 'growth' && meta.agent_name === 'InvoiceBot' && app.email === 'neha@agentco.example.com', r.text + ' ' + JSON.stringify(app));
check('its subject and message carry the package, category and demo link', /AI Agent Summit 2027 · Showcase: InvoiceBot \(Growth Showcase\)/.test(app.subject) && /Finance, BFSI/.test(app.message) && /loom\.example/.test(app.message), app.subject);
check('the team is told about the application', mail.some((m) => /enquiry/i.test(m.Content.Subject) && /InvoiceBot|Neha/.test(m.Content.Subject + bodyOf(m))), mail.map((m) => m.Content.Subject).join(' | '));
r = await post('/api/agent-summit/apply', A);
check('the same agent from the same email again: the same application', r.status === 200 && r.json?.already === true && rows("SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'agent_showcase'")[0].n === 1, r.text);

// ---- partner enquiry ----
r = await post('/api/agent-summit/enquire', { name: 'Rahul Mehta', email: 'rahul@cloudco.example.com', company: 'CloudCo', tier: 'gold', message: 'Interested in Gold.', consent: 'yes' });
const enq = rows("SELECT * FROM inquiries WHERE inquiry_type = 'sponsorship'")[0] || {};
check('a partner enquiry is a sponsorship enquiry marked for the summit', r.status === 201 && /AI Agent Summit 2027 · Partner: Gold/.test(enq.subject) && JSON.parse(enq.metadata || '{}').edition === 'agent-summit-2027', r.text + ' ' + enq.subject);

// ---- the app stays closed to event 3; Admin ----
r = await post('/api/events/3/attendees/register', { name: 'X', email: 'x@example.com' });
check('the app\'s public routes refuse event 3', r.status === 404, r.status + ' ' + r.text);
r = await hit('/api/admin/agent-summit/passes');
check('the summit list needs Admin', r.status === 401 || r.status === 403, String(r.status));
r = await hit('/api/admin/agent-summit/passes', { headers: { Authorization: 'Bearer smoke-admin' } });
check('Admin lists event 3 only: visitor, buyer, delegate', r.status === 200 && r.json?.results?.length === 3 && r.json.results.every((a) => ['Visitor Pass', 'Buyer Pass', 'Delegate Pass'].includes(a.badge_type)), r.text.slice(0, 300));
check('Mumbai is untouched: no event-1 attendee was made', rows('SELECT COUNT(*) AS n FROM attendees WHERE event_id = 1')[0].n === 0, '');

// ---- the Admin section: one answer for the dashboard, Confirm for Buyer/Investor ----
const AUTH = { Authorization: 'Bearer smoke-admin', 'Content-Type': 'application/json' };
r = await hit('/api/admin/agent-summit/overview', { headers: AUTH });
check('the dashboard: numbers, passes, applications and partner enquiries in one answer', r.status === 200 && r.json?.sales?.registered === 3 && r.json.sales.paid === 1 && r.json.sales.review === 1 && r.json.sales.applications === 1 && r.json.sales.partners === 1 && r.json.passes.length === 3 && r.json.applications[0]?.agent === 'InvoiceBot' && r.json.partners[0]?.tier === 'Gold (Rs 5,00,000)', r.text.slice(0, 400));
const vik = rows("SELECT id FROM attendees WHERE email = 'vikram@bigbank.example.com'")[0];
mail = [];
r = await hit('/api/admin/agent-summit/passes/' + vik.id + '/confirm', { method: 'POST', headers: AUTH, body: '{}' });
await settled();
check('confirming a Buyer Pass emails them and is recorded once', r.status === 200 && r.json?.ok === true && to('vikram@bigbank.example.com').some((m) => /Confirmed: your Buyer Pass/.test(m.Content.Subject)) && rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'summit.confirm'")[0].n === 1, r.text);
r = await hit('/api/admin/agent-summit/passes/' + vik.id + '/confirm', { method: 'POST', headers: AUTH, body: '{}' });
check('confirming again changes nothing', r.json?.already === true && rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'summit.confirm'")[0].n === 1, r.text);
r = await hit('/api/admin/agent-summit/overview', { headers: AUTH });
check('after confirming, nothing is left to confirm', r.json?.sales?.review === 0 && !!r.json.passes.find((a) => a.badge_type === 'Buyer Pass')?.confirmed_at, r.text.slice(0, 200));
const nehaId = rows("SELECT id FROM attendees WHERE email = 'neha@agentco.example.com'")[0].id;
r = await hit('/api/admin/agent-summit/passes/' + nehaId + '/confirm', { method: 'POST', headers: AUTH, body: '{}' });
check('a Delegate Pass is not confirmed by hand', r.status === 400, r.text);
r = await hit('/api/admin/agent-summit/overview');
check('the dashboard needs Admin', r.status === 401 || r.status === 403, String(r.status));

console.log(fails ? `\n${fails} FAILED` : '\nall AI Agent Summit checks passed');
process.exit(fails ? 1 : 0);
