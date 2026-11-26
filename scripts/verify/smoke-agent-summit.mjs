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
//  - a showcase package: accepted on the desk, emailed a signed pay link, paid through the same
//    checkout; the application is paid and Won, a paid pass is kept, no pass becomes Exhibitor;
//    the stage limit counts paid slots.
//  - the commercials of 26 Nov 2026: Startup Showcase Rs 38,000, no pod without a stage slot,
//    a custom booth at Rs 6,000 a sq ft from 200 sq ft, slots per package, three partner
//    tiers, 50 slots until 19:00 and the cocktail evening until 21:00.
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
check('the first registration brings event 3 into being, on Friday 16 April 2027', rows('SELECT title, start_date, end_date FROM events WHERE id = 3').map((e) => e.title + ' ' + e.start_date + ' ' + e.end_date)[0] === 'AI Agent Summit 2027 2027-04-16 2027-04-16', JSON.stringify(rows('SELECT * FROM events')));
const ashaMail = to('asha.rao@example.com')[0];
check('one email to them, in summit words, with no Bharat AI app block', to('asha.rao@example.com').length === 1 && /AI Agent Summit 2027/.test(ashaMail.Content.Subject) && /Visitor Pass/.test(bodyOf(ashaMail)) && !/Save the Bharat AI app|Get the app/i.test(bodyOf(ashaMail)), ashaMail ? ashaMail.Content.Subject : 'none');
check('the email gives the day as Friday 16 April 2027', !!ashaMail && /Friday 16 April 2027/.test(bodyOf(ashaMail)) && !/17 April|Saturday/.test(bodyOf(ashaMail)), ashaMail ? bodyOf(ashaMail).slice(0, 300) : 'none');
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

// ---- a showcase package, accepted on the desk and paid online (26 Nov 2026) ----
{
  const appRow = rows("SELECT * FROM inquiries WHERE inquiry_type = 'agent_showcase' ORDER BY id LIMIT 1")[0];
  const acceptUrl = (id) => '/api/admin/agent-summit/applications/' + id + '/accept';
  r = await hit(acceptUrl(appRow.id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('accepting an application needs Admin', r.status === 401 || r.status === 403, String(r.status));
  mail = [];
  r = await hit(acceptUrl(appRow.id), { method: 'POST', headers: AUTH, body: JSON.stringify({ package: 'startup' }) });
  await settled();
  const acc = JSON.parse(rows('SELECT metadata FROM inquiries WHERE id = ?', [appRow.id])[0].metadata || '{}');
  const price = 38000;
  check('accepting records the package and its price (the Startup Showcase is Rs 38,000), and the link is on bharataiinnovation.com',
    r.status === 200 && r.json?.ok && /^https:\/\/bharataiinnovation\.com\/pay\/summit-showcase\?t=/.test(r.json.link || '') && acc.accepted_package === 'startup' && acc.accepted_inr === price && !!acc.accepted_at,
    r.text + ' ' + JSON.stringify(acc));
  const acceptMail = to('neha@agentco.example.com')[0];
  check('the company is emailed the pay link, in summit words, with no Bharat AI app block',
    !!acceptMail && /^Accepted: InvoiceBot at AI Agent Summit 2027$/.test(acceptMail.Content.Subject) && bodyOf(acceptMail).includes('/pay/summit-showcase?t=') && /Friday 16 April 2027/.test(bodyOf(acceptMail)) && !/Save the Bharat AI app|Get the app/i.test(bodyOf(acceptMail)),
    mail.map((m) => m.Recipients.To.join(',') + ': ' + m.Content.Subject).join(' | '));
  const link = new URL(r.json.link);
  const t = link.searchParams.get('t');
  let page = await hit(link.pathname + link.search);
  check('the pay page shows the package and what it costs with GST', page.status === 200 && /Startup Showcase/.test(page.text) && /InvoiceBot/.test(page.text) && /securely/.test(page.text), page.text.slice(0, 300));
  page = await hit(link.pathname + '?t=' + encodeURIComponent(t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a')));
  check('a changed link is refused', page.status === 404 && /not valid/.test(page.text), String(page.status));
  const form = (o) => hit('/pay/summit-showcase', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  const pkgOrders = () => rows("SELECT * FROM payment_orders WHERE pass_type IN ('Startup Showcase', 'Growth Showcase', 'Enterprise Showcase', 'Custom Booth', 'Showcase Pod') ORDER BY id");
  page = await form({ t, legal_name: 'AgentCo Private Limited', gstin: 'NOTAGSTIN', address: '' });
  check('a wrong GSTIN is refused in words on the page, and no order is made', page.status === 400 && /GSTIN/.test(page.text) && pkgOrders().length === 0, page.status + ' ' + pkgOrders().length);
  page = await form({ t, legal_name: 'AgentCo Private Limited', gstin: '', address: '' });
  const po = pkgOrders()[0] || {};
  check('paying makes an event-3 order at the package price plus 18% GST and goes to the checkout on bharataiinnovation.com',
    page.status === 303 && /^https:\/\/bharataiinnovation\.com\/pay\/ccavenue\//.test(page.location || '') && po.event_id === 3 && po.pass_type === 'Startup Showcase' && po.base_paise === price * 100 && po.gst_paise === Math.round(price * 100 * 0.18),
    page.status + ' ' + page.location + ' ' + JSON.stringify(po));
  const co = await hit(new URL(page.location).pathname);
  check('the checkout page opens for the package and marks it for CCAvenue reports', co.status === 200 && /AI Agent Summit 2027/.test(co.text) && /Startup Showcase/.test(co.text), co.text.slice(0, 300));
  mail = [];
  r = await hit('/pay/ccavenue/return', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ encResp: kitEncrypt(gatewayAnswer(SECRET, po)) }).toString() });
  await settled();
  const paidApp = rows('SELECT status, metadata FROM inquiries WHERE id = ?', [appRow.id])[0];
  const pm = JSON.parse(paidApp.metadata || '{}');
  const nehaNow = rows("SELECT badge_type, payment_status FROM attendees WHERE event_id = 3 AND email = 'neha@agentco.example.com'")[0] || {};
  check('the gateway marks the application paid and Won; her paid Delegate Pass is kept',
    rows('SELECT status FROM payment_orders WHERE id = ?', [po.id])[0]?.status === 'paid' && paidApp.status === 'won' && pm.paid_order === po.order_id && pm.paid_paise === po.amount_paise && !!pm.paid_at && nehaNow.badge_type === 'Delegate Pass',
    JSON.stringify(paidApp) + ' ' + JSON.stringify(nehaNow));
  const paidMail = to('neha@agentco.example.com').find((m) => /^Payment received: Startup Showcase at AI Agent Summit 2027$/.test(m.Content.Subject));
  check('the company gets the package confirmation with what happens next, and no pass wording', !!paidMail && /What happens next/.test(bodyOf(paidMail)) && /ten-minute slot/.test(bodyOf(paidMail)) && !/Save the Bharat AI app/i.test(bodyOf(paidMail)), mail.map((m) => m.Content.Subject).join(' | '));
  check('the team is told the showcase is paid', mail.some((m) => /^Showcase paid, AI Agent Summit: InvoiceBot, AgentCo, Startup Showcase, Rs /.test(m.Content.Subject)), mail.map((m) => m.Content.Subject).join(' | '));
  check('no pass payment email went out for a package', !mail.some((m) => /Paid online, AI Agent Summit/.test(m.Content.Subject)), mail.map((m) => m.Content.Subject).join(' | '));
  const pr = rows('SELECT item_desc FROM invoices WHERE order_ref = ?', [po.order_id])[0];
  check('the receipt names the package and the summit', !pr || /^Startup Showcase - AI Agent Summit 2027$/.test(pr.item_desc), JSON.stringify(pr));
  const loc = r.location || '';
  const res = loc ? await hit(new URL(loc, 'https://bharataiinnovation.com').pathname + new URL(loc, 'https://bharataiinnovation.com').search) : { status: 0, text: '' };
  check('the result page confirms the package', res.status === 200 && /Startup Showcase<\/strong> at AI Agent Summit 2027 is confirmed/.test(res.text), loc + ' ' + res.text.slice(0, 200));
  page = await hit(link.pathname + link.search);
  check('the pay link, opened again, says it is paid', page.status === 200 && /This package is paid/.test(page.text), page.text.slice(0, 200));
  r = await hit(acceptUrl(appRow.id), { method: 'POST', headers: AUTH, body: '{}' });
  check('accepting a paid application changes nothing', r.status === 200 && r.json?.paid === true, r.text);
  r = await hit('/api/admin/agent-summit/overview', { headers: AUTH });
  const ov = (r.json?.applications || []).find((x) => x.id === appRow.id) || {};
  check('the desk shows it paid, lists the packages, and counts the package apart from the passes', !!ov.paid_at && ov.paid_paise === po.amount_paise && r.json?.packages?.startup?.label === 'Startup Showcase' && r.json?.sales?.packages_paid === 1 && r.json?.sales?.passes_paid === 1, JSON.stringify(ov) + ' ' + JSON.stringify(r.json?.sales));

  // A second company with no pass: it becomes an Exhibitor; the stage limit is kept.
  await post('/api/agent-summit/apply', { ...A, company: 'LedgerWorks', agent_name: 'LedgerBot', contact_name: 'Ravi Menon', email: 'ravi@ledgerworks.example.com', phone: '+91 98200 44444' }, '10.3.3.9');
  await settled();
  const ravi = rows("SELECT id FROM inquiries WHERE email = 'ravi@ledgerworks.example.com'")[0];
  db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('summit_stage_cap', '1')");
  r = await hit(acceptUrl(ravi.id), { method: 'POST', headers: AUTH, body: JSON.stringify({ package: 'growth' }) });
  await settled();
  const rt = new URL(r.json.link).searchParams.get('t');
  page = await form({ t: rt, legal_name: 'LedgerWorks LLP' });
  check('a stage package past the limit of paid slots is refused in words, with no order', page.status === 409 && /stage slots/.test(page.text) && pkgOrders().length === 1, page.status + ' ' + pkgOrders().length);
  db.run("DELETE FROM app_settings WHERE key = 'summit_stage_cap'");
  page = await form({ t: rt, legal_name: 'LedgerWorks LLP' });
  const ro = pkgOrders()[1] || {};
  check('the Growth Showcase is Rs 1,49,000 plus GST', page.status === 303 && ro.pass_type === 'Growth Showcase' && ro.base_paise === 14900000, JSON.stringify(ro));
  await hit('/pay/ccavenue/return', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ encResp: kitEncrypt(gatewayAnswer(SECRET, ro)) }).toString() });
  await settled();
  const raviNow = rows("SELECT badge_type, payment_status, registration_source FROM attendees WHERE event_id = 3 AND email = 'ravi@ledgerworks.example.com'")[0] || {};
  check('a contact with no pass becomes an Exhibitor of the summit, on event 3', raviNow.badge_type === 'Exhibitor' && raviNow.payment_status === 'paid' && raviNow.registration_source === 'agent-summit-showcase', JSON.stringify(raviNow));
  // The commercials of 26 Nov 2026 (the organiser): three showcase choices and a custom booth.
  const customOpen = Date.now() <= Date.parse('2027-02-15T23:59:59+05:30');
  const B = { ...A, company: 'BigCo', agent_name: 'BigBot', contact_name: 'Meera Shah', email: 'meera@bigco.example.com', phone: '+91 98200 55555' };
  r = await post('/api/agent-summit/apply', { ...B, package: 'pod' }, '10.3.3.10');
  check('the pod without a stage slot is no longer on the form', r.status === 400 && (r.json?.errors || []).some((e) => e.field === 'package'), r.text);
  r = await post('/api/agent-summit/apply', { ...B, package: 'custom', booth_sqft: '150' }, '10.3.3.10');
  check(customOpen ? 'a custom booth under 200 sq ft is refused on its size field' : 'custom booths are closed after 15 February 2027',
    r.status === 400 && (r.json?.errors || []).some((e) => e.field === (customOpen ? 'booth_sqft' : 'package')), r.text);
  r = await post('/api/agent-summit/apply', { ...B, package: customOpen ? 'custom' : 'enterprise', booth_sqft: '300' }, '10.3.3.10');
  await settled();
  const big = rows("SELECT * FROM inquiries WHERE email = 'meera@bigco.example.com'")[0] || {};
  const bigMeta = JSON.parse(big.metadata || '{}');
  check('a custom booth application keeps its size and says what it comes to',
    r.status === 201 && (!customOpen || (bigMeta.package === 'custom' && bigMeta.booth_sqft === 300 && /300 sq ft at Rs 6,000 per sq ft: Rs 18,00,000/.test(big.message || ''))), r.text + ' ' + JSON.stringify(bigMeta));
  r = await hit(acceptUrl(big.id), { method: 'POST', headers: AUTH, body: JSON.stringify({ package: 'custom', sqft: 250, send: false }) });
  const bigAcc = JSON.parse(rows('SELECT metadata FROM inquiries WHERE id = ?', [big.id])[0].metadata || '{}');
  check('a custom booth is Rs 6,000 a sq ft at the size the desk sets: 250 sq ft is Rs 15,00,000',
    r.status === 200 && r.json?.package === 'Custom Booth' && r.json?.price_inr === 1500000 && bigAcc.accepted_sqft === 250 && bigAcc.accepted_inr === 1500000, r.text + ' ' + JSON.stringify(bigAcc));
  const bt = new URL(r.json.link).searchParams.get('t');
  page = await hit('/pay/summit-showcase?t=' + encodeURIComponent(bt));
  check('its pay page names the size and the price', page.status === 200 && /250 sq ft custom booth/.test(page.text) && /15,00,000/.test(page.text), page.text.slice(0, 300));
  db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('summit_cap_enterprise', '0')");
  page = await form({ t: bt, legal_name: 'BigCo Limited' });
  check('a package whose own slots are all paid is refused in words (a custom booth takes an Enterprise slot)', page.status === 409 && /Enterprise Showcase slots/.test(page.text) && pkgOrders().length === 2, page.status + ' ' + pkgOrders().length);
  db.run("DELETE FROM app_settings WHERE key = 'summit_cap_enterprise'");
  r = await hit(acceptUrl(big.id), { method: 'POST', headers: AUTH, body: JSON.stringify({ package: 'custom', sqft: 50, send: false }) });
  check('a custom booth is never under 200 sq ft: Rs 12,00,000', r.json?.price_inr === 1200000, r.text);
  db.run("UPDATE inquiries SET metadata = json_set(metadata, '$.accepted_package', 'startup', '$.accepted_inr', 79000) WHERE id = ?", [big.id]);
  page = await hit('/pay/summit-showcase?t=' + encodeURIComponent(bt));
  check('a Startup Showcase accepted at the old Rs 79,000 pays Rs 38,000', page.status === 200 && /Startup Showcase/.test(page.text) && /38,000/.test(page.text) && !/79,000/.test(page.text), page.text.slice(0, 300));
  r = await hit(acceptUrl(big.id), { method: 'POST', headers: AUTH, body: JSON.stringify({ package: 'pod', send: false }) });
  check('the desk cannot accept anyone for the old pod: it keeps the package they have', r.json?.package === 'Startup Showcase' && r.json?.price_inr === 38000, r.text);
  r = await hit('/api/admin/agent-summit/overview', { headers: AUTH });
  const pk = r.json?.packages || {};
  check('the desk offers the three packages and the custom booth, with their slots and what is paid, and no pod',
    Object.keys(pk).join() === 'startup,growth,enterprise,custom' && pk.startup.inr === 38000 && pk.startup.slots === 20 && pk.growth.slots === 14 && pk.enterprise.slots === 10
      && pk.custom.per_sqft === 6000 && pk.custom.shares === 'enterprise' && pk.startup.sold === 1 && pk.growth.sold === 1, JSON.stringify(pk));
  check('Mumbai is still untouched', rows('SELECT COUNT(*) AS n FROM attendees WHERE event_id = 1')[0].n === 0, '');
}

// ---- The AI Agent Challenge and the problem board (26 Nov 2026) ----
{
  const T = { team_name: 'Pune Builders', name: 'Aditi Kulkarni', email: 'Aditi@college.example.edu', phone: '+91 98200 11223', members: '3', idea: 'An agent that reads a GST notice, finds the invoices it is about and drafts the reply.', org: 'COEP', city: 'Pune', eligible: 'yes', consent: 'yes' };
  let q = await post('/api/agent-summit/challenge', { ...T, eligible: '' });
  check('a challenge team that has raised funding (or did not say): refused on that field', q.status === 400 && q.json?.errors?.some((e) => e.field === 'eligible'), q.text);
  q = await post('/api/agent-summit/challenge', { ...T, members: '5' });
  check('a challenge team of five: refused, one to four people', q.status === 400 && q.json?.errors?.some((e) => e.field === 'members'), q.text);
  mail = [];
  q = await post('/api/agent-summit/challenge', T);
  await settled();
  const ch = rows("SELECT * FROM inquiries WHERE inquiry_type = 'agent_challenge'")[0] || {};
  const cm = JSON.parse(ch.metadata || '{}');
  check('a challenge team is an agent_challenge enquiry, event 1, edition agent-summit-2027, with reference AAS27-C',
    q.status === 201 && ch.event_id === 1 && cm.edition === 'agent-summit-2027' && cm.team_name === 'Pune Builders' && cm.members === 3 && ch.email === 'aditi@college.example.edu' && /^AAS27-C\d+$/.test(q.json?.reference || ''), q.text);
  check('its subject names the team, and the team is told', /AI Agent Summit 2027 · Challenge: Pune Builders/.test(ch.subject) && mail.length > 0, ch.subject + ' / mails ' + mail.length);
  q = await post('/api/agent-summit/challenge', T);
  check('the same team from the same email again: the same registration', q.status === 200 && q.json?.already === true && rows("SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'agent_challenge'")[0].n === 1, q.text);

  const Pb = { name: 'Kavita Rao', email: 'kavita@bigbank.example.com', company: 'BigBank', job_title: 'Head of Operations', sector: 'banking', problem: 'Reconcile about 3,000 vendor invoices a month against purchase orders and flag the ones that do not match.', consent: 'yes' };
  q = await post('/api/agent-summit/problem', { ...Pb, sector: 'space' });
  check('a problem with an unknown sector: refused on that field', q.status === 400 && q.json?.errors?.some((e) => e.field === 'sector'), q.text);
  q = await post('/api/agent-summit/problem', Pb);
  const pr = rows("SELECT * FROM inquiries WHERE inquiry_type = 'agent_problem'")[0] || {};
  const pm = JSON.parse(pr.metadata || '{}');
  check('a problem is an agent_problem enquiry kept off the board by name unless asked, with reference AAS27-P',
    q.status === 201 && pr.event_id === 1 && pm.edition === 'agent-summit-2027' && pm.sector === 'banking' && pm.show_name === false && /^AAS27-P\d+$/.test(q.json?.reference || '') && /Problem: Reconcile about 3,000 vendor invoices a month against pur\.\.\./.test(pr.subject), q.text + ' ' + pr.subject);
  check('the sender is told nothing goes up before we write to them', /before yours is published/.test(q.json?.message || ''), q.text);
  q = await post('/api/agent-summit/enquire', { name: 'Sameer Shah', email: 'sameer@cloud.example.com', company: 'CloudCo', tier: 'challenge', consent: 'yes' });
  const ce = rows("SELECT subject FROM inquiries WHERE inquiry_type = 'sponsorship' ORDER BY id DESC LIMIT 1")[0] || {};
  check('a partner can ask about the challenge or the Break the agent booth', q.status === 201 && /Partner: AI Agent Challenge partner/.test(ce.subject || ''), ce.subject);
}

// The day is Friday 16 April 2027 (the organiser, 26 Nov 2026): no page, calendar file or script says 17 or Saturday.
{
  const dir = new URL('../../public/ai-agent-summit/', import.meta.url);
  const files = ['index.html', 'attend.html', 'showcase.html', 'partners.html', 'challenge.html', 'problems.html', 'terms.html', 'refund.html', 'privacy.html', 'thanks.html', 'llms.txt', 'ai-agent-summit-2027.ics', 'assets/site.js'];
  const bad = files.filter((f) => /17 April|April 17|Saturday|2027-04-17|20270417/.test(readFileSync(new URL(f, dir), 'utf8')));
  const home = readFileSync(new URL('index.html', dir), 'utf8');
  const ics = readFileSync(new URL('ai-agent-summit-2027.ics', dir), 'utf8');
  check('the pages, the calendar file and the countdown say Friday 16 April 2027', bad.length === 0 && home.includes('Friday 16 April 2027') && home.includes('"startDate": "2027-04-16T09:00:00+05:30"') && ics.includes('DTSTART:20270416T030000Z'), 'still the old day: ' + bad.join(', '));
  // The organiser, 26 Nov 2026: "jury" belongs to awards (the Aegis Graham Bell Awards); the summit's is an evaluation committee.
  const juryOn = files.filter((f) => /jur(y|ies|or)/i.test(readFileSync(new URL(f, dir), 'utf8')));
  check('no summit page says jury: applications go to an evaluation committee', juryOn.length === 0 && /evaluation committee/i.test(home), 'still says jury: ' + juryOn.join(', '));
  // Every booth's team passes include lunch and the cocktail evening (the organiser, 26 Nov 2026).
  const sc = readFileSync(new URL('showcase.html', dir), 'utf8');
  check('every package says its team passes include lunch and the cocktail evening', (home.match(/with lunch and the cocktail evening/g) || []).length === 3 && /custom booth is[^<]*lunch and the cocktail evening/.test(home) && /Lunch and the cocktail evening<\/th>/.test(sc), 'home: ' + (home.match(/with lunch and the cocktail evening/g) || []).length);
  // The commercials of 26 Nov 2026: three showcase choices and a custom booth, three partner tiers, 50 slots.
  const pt = readFileSync(new URL('partners.html', dir), 'utf8');
  const at = readFileSync(new URL('attend.html', dir), 'utf8');
  const old = files.filter((f) => /79,000|64,000|Silver|pod only|package=pod|[0-9] × [0-9.]+ m\b/.test(readFileSync(new URL(f, dir), 'utf8')));
  check('no page keeps the old prices, the pod without a stage slot, Silver, or sizes in metres', old.length === 0, 'still there: ' + old.join(', '));
  check('the home page sells three packages, and the custom booth by the sq ft until 15 February 2027',
    (home.match(/<article class="plan/g) || []).length === 3 && /₹38,000<small>/.test(home) && /₹6,000 per sq ft/.test(home) && /Book by 15 February 2027/.test(home) && /package=custom/.test(home), '');
  check('the showcase form offers the custom booth with its size, and no pod', /value="custom"/.test(sc) && /name="booth_sqft"/.test(sc) && !/value="pod"/.test(sc), '');
  check('partners: Presenting, Platinum and Gold, the cocktail evening partner, and no Silver',
    (pt.match(/<article class="tier/g) || []).length === 3 && /Cocktail evening partner/.test(pt) && !/value="silver"/.test(pt), '');
  check('the day has 50 slots until 19:00, then the cocktail evening until 21:00 for VIP, Buyer and Investor passes',
    /Fifty ten-minute slots/.test(home) && home.includes('"endDate": "2027-04-16T21:00:00+05:30"') && ics.includes('DTEND:20270416T153000Z') && /Cocktail evening<\/th><td class="n">No<\/td><td class="n">No<\/td><td class="n">No<\/td><td class="y">Yes<\/td><td class="y">Yes<\/td><td class="y">Yes<\/td>/.test(at), '');
  // The organiser, 26 Nov 2026: we invite buyers and investors and try to bring them, but never promise them.
  const promises = files.filter((f) => /pre-arranged buyer|panel of enterprise buyers|buyer panel|in front of the CIOs and investors|introductions to the companies|Reach the CIOs/i.test(readFileSync(new URL(f, dir), 'utf8')));
  check('no page promises buyers, investors, meetings or introductions', promises.length === 0, 'still promises: ' + promises.join(', '));
  // The challenge and the board (26 Nov 2026): each page posts to its own route, and the home page links to both.
  const chp = readFileSync(new URL('challenge.html', dir), 'utf8');
  const pbp = readFileSync(new URL('problems.html', dir), 'utf8');
  check('the challenge and problem pages post to their routes, and the home page links to both',
    /data-endpoint="\/api\/agent-summit\/challenge"/.test(chp) && /name="eligible"/.test(chp) && /data-endpoint="\/api\/agent-summit\/problem"/.test(pbp) && /name="show_name"/.test(pbp)
      && /href="\/ai-agent-summit\/challenge/.test(home) && /href="\/ai-agent-summit\/problems/.test(home), '');
}

console.log(fails ? `\n${fails} FAILED` : '\nall AI Agent Summit checks passed');
process.exit(fails ? 1 : 0);
