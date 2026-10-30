// Built-worker checks that a paid pass nobody paid for is not shown as that pass
// (29 Oct 2026), run against real SQLite (sql.js) loaded with the production
// schema, so the CASE that hides it is tested as SQL, not pattern-matched.
// Everyone who left the CCAvenue page on a VIP checkout had read as a VIP: in the
// admin grid, in Analytics, at the desk, and to every attendee in the directory.
// The door screen (/verify) also said VALID PASS for a refunded tier.
// Run after `npm run build`:  node scripts/verify/smoke-unpaid-pass.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sessionCookie } from './pay-db.mjs';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));

// A D1 binding over sql.js. These routes only read, so batch answers each
// statement's rows, which is what the dashboard's batch reads back.
const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
      _rows() { return rows(sql, args); },
    };
    return s;
  },
  async batch(list) { return list.map(s => ({ results: s._rows(), meta: {} })); },
  async exec(sql) { db.exec(sql); return { count: 1 }; },
};
const SESSION = 'smoke-session';
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SESSION, ATTENDEE_EXPORT_SECRET: 'smoke-export', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (path, headers = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { headers }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const ADMIN = { Authorization: 'Bearer smoke-admin' };
const as = (id) => ({ Cookie: sessionCookie(SESSION, id) });
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

// ---- seed ----
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI', '2026-11-20', '2026-11-21')");
const person = (id, name, extra = {}) => {
  const row = { id, event_id: 1, name, email: 'p' + id + '@example.com', mobile: '98200' + String(id).padStart(5, '0'), company: 'Co ' + id,
    job_title: 'Director', badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, ...extra };
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
};
person(1, 'Paid Delegate', { badge_type: 'Delegate Pass' });
person(2, 'Left Checkout', { badge_type: 'VIP Pass', payment_status: 'pending' });
person(3, 'Paid Vip', { badge_type: 'VIP Pass' });
person(4, 'Refunded Delegate', { badge_type: 'Delegate Pass', payment_status: 'refunded' });
person(5, 'Given Premium', { badge_type: 'Premium Delegate Pass', payment_status: 'waived' });
person(6, 'Booth Owner', { badge_type: 'Exhibitor', role: 'exhibitor' });
person(7, 'Spaced Pending', { badge_type: 'VIP Pass', payment_status: ' Pending ' });
db.run("INSERT INTO connections (event_id, from_attendee_id, to_attendee_id, status) VALUES (1, 2, 1, 'accepted'), (1, 1, 3, 'accepted')");
db.run("INSERT INTO exhibitors (id, event_id, company_name, booth_number, attendee_id) VALUES (1, 1, 'Booth Co', 'A1', 6)");
db.run("INSERT INTO booth_visits (exhibitor_id, attendee_id, event_id, interested) VALUES (1, 2, 1, 1), (1, 3, 1, 1)");

const byId = (list) => Object.fromEntries((list || []).map(a => [a.id, a]));

// ---- what other attendees see ----
let r = await hit('/api/events/1/attendees?search=&role=', as(1));
let d = byId(r.json);
check('directory is 200 for a paid Delegate', r.status === 200 && Array.isArray(r.json), r.status + ' ' + r.text.slice(0, 120));
check('an abandoned VIP checkout is shown as a Visitor Pass', d[2]?.badge_type === 'Visitor Pass', JSON.stringify(d[2]?.badge_type));
check('"Pending" with spaces and a capital is still unpaid', d[7]?.badge_type === 'Visitor Pass', JSON.stringify(d[7]?.badge_type));
check('a refunded Delegate is shown as a Visitor Pass', d[4]?.badge_type === 'Visitor Pass', JSON.stringify(d[4]?.badge_type));
check('a paid VIP is still a VIP', d[3]?.badge_type === 'VIP Pass', JSON.stringify(d[3]?.badge_type));
check('a given (waived) Premium is still Premium', d[5]?.badge_type === 'Premium Delegate Pass', JSON.stringify(d[5]?.badge_type));
check('an Exhibitor is untouched', d[6]?.badge_type === 'Exhibitor', JSON.stringify(d[6]?.badge_type));
check('the directory never carries payment_status', (r.json || []).every(a => !('payment_status' in a)), 'payment_status present');

r = await hit('/api/events/1/attendees?search=&role=' + encodeURIComponent('VIP Pass'), as(1));
check('filtering on VIP Pass finds only the paid VIP', JSON.stringify((r.json || []).map(a => a.id)) === '[3]', JSON.stringify((r.json || []).map(a => a.id)));

r = await hit('/api/attendees/2', as(1));
check('their profile says Visitor Pass', r.status === 200 && r.json?.badge_type === 'Visitor Pass', r.status + ' ' + JSON.stringify(r.json?.badge_type));

r = await hit('/api/attendees/1/connections', as(1));
d = Object.fromEntries((r.json || []).map(c => [c.other_id, c]));
check('a connection who left checkout shows as a Visitor Pass', d[2]?.other_badge === 'Visitor Pass', JSON.stringify(d[2]?.other_badge));
check('a connection who paid for VIP shows as VIP', d[3]?.other_badge === 'VIP Pass', JSON.stringify(d[3]?.other_badge));

r = await hit('/api/attendees/6/exhibitor/leads', as(6));
const leads = Object.fromEntries((r.json?.leads || []).map(l => [l.name, l.badge_type]));
check('exhibitor leads: the unpaid visitor reads Visitor Pass, the paid VIP reads VIP',
  leads['Left Checkout'] === 'Visitor Pass' && leads['Paid Vip'] === 'VIP Pass', r.status + ' ' + JSON.stringify(leads));

// ---- what the person sees of themselves: the pass they chose, so Pay now is right ----
r = await hit('/api/attendees/2/dashboard', as(2));
check('their own dashboard keeps the VIP Pass they chose', r.status === 200 && r.json?.profile?.badge_type === 'VIP Pass', r.status + ' ' + JSON.stringify(r.json?.profile?.badge_type));
check('the own dashboard row has one badge_type, not two', !/badge_type.*badge_type/.test(Object.keys(r.json?.profile || {}).join(',')), Object.keys(r.json?.profile || {}).join(','));

// ---- what the admin sees: the truth, counted apart ----
r = await hit('/api/events/1/attendees', ADMIN);
d = byId(r.json?.attendees || r.json);
check('the admin grid still gets the chosen tier and its payment_status', d[2]?.badge_type === 'VIP Pass' && d[2]?.payment_status === 'pending', JSON.stringify(d[2] || {}).slice(0, 160));

r = await hit('/api/admin/events/1/analytics', ADMIN);
const pie = Object.fromEntries((r.json?.attendeesByBadge || []).map(x => [x.badge_type, x.count]));
check('analytics counts paid VIPs apart from unpaid ones', pie['VIP Pass'] === 1 && pie['VIP Pass · not paid'] === 2 && pie['Delegate Pass · not paid'] === 1 && pie['Delegate Pass'] === 1,
  r.status + ' ' + JSON.stringify(pie));

r = await hit('/api/admin/events/1/growth', ADMIN);
const fun = Object.fromEntries((r.json?.funnel || []).map(x => [x.badge_type, x.registered]));
check('the pass funnel files unpaid VIPs under "VIP Pass · not paid"', fun['VIP Pass'] === 1 && fun['VIP Pass · not paid'] === 2, r.status + ' ' + JSON.stringify(fun));

r = await hit('/api/admin/events/1/analytics', ADMIN);
const recent = Object.fromEntries((r.json?.recentRegistrations || []).map(x => [x.id, x]));
check('Overview "Recent Registrations" carries payment_status, so the chip can say Not paid', recent[2]?.badge_type === 'VIP Pass' && recent[2]?.payment_status === 'pending', JSON.stringify(recent[2] || {}).slice(0, 160));

// ---- the door: a pass downloaded before a refund must not read VALID ----
for (const [id, who] of [[4, 'refunded Delegate'], [2, 'unpaid VIP'], [3, 'paid VIP']]) {
  const tok = (await hit('/api/my-pass-token?id=' + id, ADMIN)).json?.token;
  const v = await hit('/verify/' + encodeURIComponent(tok || 'none'));
  const pending = /PAYMENT PENDING/.test(v.text);
  check(`/verify for a ${who} ${id === 3 ? 'is a valid pass' : 'says PAYMENT PENDING'}`, !!tok && (id === 3 ? !pending && /VALID PASS/.test(v.text) : pending),
    v.status + ' ' + v.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
}

r = await hit('/api/admin/checkin-stats', ADMIN);
const tiers = Object.fromEntries((r.json?.byTier || []).map(x => [x.badge_type, x.total]));
check('the badge desk card counts unpaid VIPs apart', !r.json?.ready || (tiers['VIP Pass'] === 1 && tiers['VIP Pass · not paid'] === 2), r.status + ' ' + JSON.stringify(r.json).slice(0, 200));

// ---- a pass set by hand is given, not sold; lunch comes from the pass ----
const send = async (method, path, body) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method, headers: { 'Content-Type': 'application/json', ...ADMIN }, body: JSON.stringify(body) }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const at = (id) => rows('SELECT badge_type, payment_status, lunch_inclusion FROM attendees WHERE id = ?', [id])[0] || {};
const atEmail = (email) => rows('SELECT badge_type, payment_status, lunch_inclusion FROM attendees WHERE email = ?', [email])[0] || {};
const is = (row, badge, pay, lunch) => row.badge_type === badge && row.payment_status === pay && row.lunch_inclusion === lunch;
person(20, 'Raised By Edit', { lunch_inclusion: 'No' });
person(21, 'Raised Inline', { lunch_inclusion: 'Yes' });
person(22, 'Owes Delegate', { badge_type: 'Delegate Pass', payment_status: 'pending', lunch_inclusion: 'No' });
person(23, 'Owes Vip', { badge_type: 'VIP Pass', payment_status: 'pending', lunch_inclusion: 'No' });
person(24, 'Bulk Visitor', { lunch_inclusion: 'No' });
person(25, 'Bulk Paid Delegate', { badge_type: 'Delegate Pass', lunch_inclusion: 'No' });
person(26, 'Explicit Both', { lunch_inclusion: 'Yes' });
person(27, 'Eats Unpaid', { badge_type: 'Delegate Pass', payment_status: 'pending', lunch_inclusion: 'Yes' });

r = await send('PUT', '/api/admin/attendees/20', { badge_type: 'VIP Pass' });
check('Edit: a Visitor raised to VIP by hand is complimentary (waived), with lunch', r.status === 200 && is(at(20), 'VIP Pass', 'waived', 'Yes'), JSON.stringify(at(20)));
r = await send('PATCH', '/api/admin/attendees/21', { badge_type: 'Academic Pass' });
check('inline cell: raised to Academic is complimentary, and Academic has no lunch', r.status === 200 && is(at(21), 'Academic Pass', 'waived', 'No'), JSON.stringify(at(21)));
r = await send('PATCH', '/api/admin/attendees/22', { payment_status: 'paid' });
check('Set payment to paid on an unpaid Delegate adds the lunch the pass includes', r.status === 200 && is(at(22), 'Delegate Pass', 'paid', 'Yes'), JSON.stringify(at(22)));
r = await send('PATCH', '/api/admin/attendees/23', { badge_type: 'Delegate Pass' });
check('someone part-way through paying stays pending when the tier is changed, and gets no lunch yet', r.status === 200 && is(at(23), 'Delegate Pass', 'pending', 'No'), JSON.stringify(at(23)));
r = await send('POST', '/api/admin/attendees/bulk-update', { ids: [24, 25], changes: { badge_type: 'VIP Pass' } });
check('Set pass on a selection: the Visitor is given (waived), the paid Delegate keeps paid, both get lunch',
  r.status === 200 && is(at(24), 'VIP Pass', 'waived', 'Yes') && is(at(25), 'VIP Pass', 'paid', 'Yes'), JSON.stringify([at(24), at(25)]));
r = await send('PUT', '/api/admin/attendees/26', { badge_type: 'VIP Pass', payment_status: 'paid', lunch_inclusion: 'No' });
check('a save that sets Payment and Lunch itself is taken as it is', r.status === 200 && is(at(26), 'VIP Pass', 'paid', 'No'), JSON.stringify(at(26)));
r = await send('POST', '/api/admin/attendees', { event_id: 1, name: 'Added Vip', email: 'added-vip@example.com', badge_type: 'VIP Pass' });
const addAcad = await send('POST', '/api/admin/attendees', { event_id: 1, name: 'Added Academic', email: 'added-acad@example.com', badge_type: 'Academic Pass' });
const addVis = await send('POST', '/api/admin/attendees', { event_id: 1, name: 'Added Visitor', email: 'added-vis@example.com', badge_type: 'Visitor Pass' });
check('Add Attendee: a VIP is given with lunch, an Academic given without, a Visitor stays paid with no lunch',
  r.status === 201 && addAcad.status === 201 && addVis.status === 201 && is(atEmail('added-vip@example.com'), 'VIP Pass', 'waived', 'Yes')
  && is(atEmail('added-acad@example.com'), 'Academic Pass', 'waived', 'No') && is(atEmail('added-vis@example.com'), 'Visitor Pass', 'paid', 'No'),
  JSON.stringify([atEmail('added-vip@example.com'), atEmail('added-acad@example.com'), atEmail('added-vis@example.com')]));
r = await send('POST', '/api/admin/attendees/bulk', { event_id: 1, attendees: [{ name: 'Imported Premium', email: 'imp-premium@example.com', badge_type: 'Premium Delegate Pass' }, { name: 'Imported Visitor', email: 'imp-vis@example.com', badge_type: 'Visitor Pass' }] });
check('Bulk Upload: a Premium Delegate row is given with lunch, a Visitor row gets no lunch',
  r.status === 200 && is(atEmail('imp-premium@example.com'), 'Premium Delegate Pass', 'waived', 'Yes') && is(atEmail('imp-vis@example.com'), 'Visitor Pass', 'paid', 'No'),
  r.status + ' ' + JSON.stringify([atEmail('imp-premium@example.com'), atEmail('imp-vis@example.com')]));
r = await hit('/api/admin/events/1/analytics', ADMIN);
const pie2 = Object.fromEntries((r.json?.attendeesByBadge || []).map(x => [x.badge_type, x.count]));
check('Analytics counts passes given by hand apart from the ones sold', pie2['VIP Pass · complimentary'] === 3 && pie2['VIP Pass'] === 3, JSON.stringify(pie2));

person(60, 'Paid On Muni', { lunch_inclusion: 'No' });
db.run("INSERT INTO invoices (invoice_no, attendee_id, buyer_name, buyer_email, item_desc, taxable_paise, total_paise) VALUES ('AKT-60', 60, 'Paid On Muni', 'p60@example.com', 'Delegate Pass', 499900, 589882)");
r = await send('PUT', '/api/admin/attendees/60', { badge_type: 'Delegate Pass' });
check('raising someone with an invoice on record keeps paid (they paid, on mUni say), with lunch', r.status === 200 && is(at(60), 'Delegate Pass', 'paid', 'Yes'), JSON.stringify(at(60)));
r = await send('PATCH', '/api/admin/attendees/25', { badge_type: 'Visitor Pass' });
check('a pass lowered to Visitor by hand loses the lunch', r.status === 200 && at(25).badge_type === 'Visitor Pass' && at(25).lunch_inclusion === 'No', JSON.stringify(at(25)));
r = await hit('/api/admin/events/1/analytics', ADMIN);
const pie3 = Object.fromEntries((r.json?.attendeesByBadge || []).map(x => [x.badge_type, x.count]));
check('and Analytics counts it where it now is', pie3['VIP Pass'] === 2, JSON.stringify(pie3));

// ---- the lunch count leaves out anyone still owing for their pass ----
const lunchCount = async () => (await hit('/api/admin/events/1/lunch-stats', ADMIN)).json?.totalLunchEligible;
const owing = await lunchCount();
db.run("UPDATE attendees SET payment_status = 'paid' WHERE id = 27");
const settled = await lunchCount();
check('an unpaid Delegate marked lunch Yes is not catered for until the money lands', typeof owing === 'number' && settled === owing + 1, owing + ' -> ' + settled);

// ---- AImailPilot: the pass held, not only the pass chosen ----
const EXPORT = { Authorization: 'Bearer smoke-export' };
r = await hit('/api/external/attendees-export?event_id=1', EXPORT);
const ex = Object.fromEntries((Array.isArray(r.json) ? r.json : []).map(x => [x.id, x]));
check('export: an abandoned VIP checkout goes out as chosen VIP Pass, pending, holding a Visitor Pass',
  r.status === 200 && ex[2]?.badge_type === 'VIP Pass' && ex[2]?.payment_status === 'pending' && ex[2]?.pass_held === 'Visitor Pass', r.status + ' ' + JSON.stringify(ex[2] || r.text.slice(0, 160)));
check('export: a paid VIP holds a VIP Pass', ex[3]?.pass_held === 'VIP Pass' && ex[3]?.payment_status === 'paid', JSON.stringify(ex[3] || {}));
r = await hit('/api/external/attendees-export?event_id=1&mode=state', EXPORT);
const st = Object.fromEntries((r.json?.attendees || []).map(x => [x.id, x]));
check('mode=state carries badge, payment and the pass held for every row, so a later payment reaches AImailPilot',
  r.json?.mode === 'state' && st[2]?.pass_held === 'Visitor Pass' && st[22]?.pass_held === 'Delegate Pass' && st[22]?.payment_status === 'paid' && st[2]?.opted_out !== undefined,
  JSON.stringify([st[2], st[22]]));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
