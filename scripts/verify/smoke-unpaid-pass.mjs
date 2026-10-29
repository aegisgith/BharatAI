// Built-worker checks that a paid pass nobody paid for is not shown as that pass
// (29 Oct 2026), run against real SQLite (sql.js) loaded with the production
// schema, so the CASE that hides it is tested as SQL, not pattern-matched.
// Everyone who left the CCAvenue page on a VIP checkout had read as a VIP: in the
// admin grid, in Analytics, at the desk, and to every attendee in the directory.
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
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: SESSION, DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
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

r = await hit('/api/admin/checkin-stats', ADMIN);
const tiers = Object.fromEntries((r.json?.byTier || []).map(x => [x.badge_type, x.total]));
check('the badge desk card counts unpaid VIPs apart', !r.json?.ready || (tiers['VIP Pass'] === 1 && tiers['VIP Pass · not paid'] === 2), r.status + ' ' + JSON.stringify(r.json).slice(0, 200));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
