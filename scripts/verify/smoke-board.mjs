// Built-worker checks for the Overview board (4 Nov 2026): who holds which pass,
// money from passes, pace, and what is waiting on a person. Run against real
// SQLite (sql.js) loaded with the production schema, so every SQL in the route
// is executed, not pattern-matched. The organiser's question was "how many are
// free, academic, delegate, premium, VIP, speaker, media, and how much money
// from paid passes"; this proves each number means what the card says.
// Run after `npm run build`:  node scripts/verify/smoke-board.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(new URL('./prod-schema.sql', import.meta.url), 'utf8'));

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
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const hit = async (path, headers = {}) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { headers }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const ADMIN = { Authorization: 'Bearer smoke-admin' };
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
person(1, 'Free One');
person(2, 'Free Two', { checked_in_at: '2026-11-20 04:10:00' });
person(3, 'Paid Delegate Online', { badge_type: 'Delegate Pass' });                       // paid order below
person(4, 'Left Checkout Vip', { badge_type: 'VIP Pass', payment_status: 'pending' });     // a created order, never paid
person(5, 'Refunded Delegate', { badge_type: 'Delegate Pass', payment_status: 'refunded' });
person(6, 'Given Premium', { badge_type: 'Premium Delegate Pass', payment_status: 'waived' }); // no workshop seat
person(7, 'Paid Vip By Hand', { badge_type: 'VIP Pass', payment_amount: '23599' });        // mUni era, amount typed
person(8, 'Paid Academic By Hand No Amount', { badge_type: 'Academic Pass', payment_amount: '' });
person(9, 'Paid Vip Online', { badge_type: 'VIP Pass', photo_flagged_at: '2026-11-01 10:00:00' }); // failed once, then paid; has a seat
person(10, 'A Speaker', { badge_type: 'Speaker', role: 'speaker' });
person(11, 'Press', { badge_type: 'Media Pass' });
person(12, 'Panel Only', { main_event: 0 });                                                // not a conference registration
db.run("INSERT INTO payment_orders (order_id, attendee_id, pass_type, base_paise, gst_paise, amount_paise, status, paid_at) VALUES " +
  "('BAI3-A', 3, 'Delegate Pass', 899900, 161982, 1061882, 'paid', datetime('now'))," +
  "('BAI4-A', 4, 'VIP Pass', 1999900, 359982, 2359882, 'created', NULL)," +
  "('BAI9-A', 9, 'VIP Pass', 1999900, 359982, 2359882, 'failed', NULL)," +
  "('BAI9-B', 9, 'VIP Pass', 1999900, 359982, 2359882, 'paid', datetime('now', '-3 days'))");
// The automatic receipt for order 3 (not an invoice), a real tax invoice for order 9.
db.run("INSERT INTO invoices (invoice_no, attendee_id, buyer_name, buyer_email, item_desc, order_ref, taxable_paise, total_paise) VALUES " +
  "('RCT/26-27/1', 3, 'Paid Delegate Online', 'p3@example.com', 'Delegate Pass', 'BAI3-A', 899900, 1061882)," +
  "('AKT/26-27/7', 9, 'Paid Vip Online', 'p9@example.com', 'VIP Pass', 'BAI9-B', 1999900, 2359882)");
db.run("INSERT INTO inquiries (event_id, inquiry_type, name, email, status) VALUES (1, 'speaking', 'S', 's@example.com', 'new'), (1, 'sponsorship', 'P', 'p@example.com', 'new'), (1, 'speaking', 'Old', 'o@example.com', 'responded')");
db.run("INSERT INTO booth_types (id, slug, name, size_label, width_m, depth_m, area_sqm, area_sqft, price_inr) VALUES (1, 'pod', 'Pod', '2x2', 2, 2, 4, 43, 48000)");
db.run("INSERT INTO booth_requests (event_id, booth_type_id, company_name, contact_name, email, status) VALUES (1, 1, 'Booth Co', 'B', 'b@example.com', 'submitted'), (1, 1, 'Done Co', 'D', 'd@example.com', 'approved')");
db.run("INSERT INTO mp_listings (company_id, company_name, product_name, description, status) VALUES (1, 'Mp Co', 'Thing', 'd', 'pending'), (1, 'Mp Co', 'Live', 'd', 'approved')");
db.run("INSERT INTO room_bookings (event_id, room_id, slot_date, slot_start, slot_end, kind, status) VALUES (1, 1, '2026-11-20', '2026-11-20 10:00', '2026-11-20 11:00', 'booking', 'held'), (1, 1, '2026-11-20', '2026-11-20 11:00', '2026-11-20 12:00', 'block', 'held')");
db.run("INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, 9, 1)");

// ---- the door ----
let r = await hit('/api/admin/events/1/board');
check('the board needs the admin secret', r.status === 401, r.status + ' ' + r.text.slice(0, 80));
r = await hit('/api/admin/events/1/board', ADMIN);
check('the board answers 200 with passes, money and todo', r.status === 200 && Array.isArray(r.json?.passes) && r.json?.money && r.json?.todo, r.status + ' ' + r.text.slice(0, 200));
const b = r.json || {};
const pass = Object.fromEntries((b.passes || []).map(p => [p.pass, p]));

// ---- who holds which pass ----
check('the free Visitor Pass is counted, and a panel-only registrant is not', pass['Visitor Pass']?.total === 2, JSON.stringify(pass['Visitor Pass']));
check('Delegate Pass: one paid online, one refunded under Not paid', pass['Delegate Pass']?.total === 2 && pass['Delegate Pass']?.not_paid === 1 && pass['Delegate Pass']?.complimentary === 0, JSON.stringify(pass['Delegate Pass']));
check('VIP Pass: two paid, the abandoned checkout under Not paid', pass['VIP Pass']?.total === 3 && pass['VIP Pass']?.not_paid === 1, JSON.stringify(pass['VIP Pass']));
check('a Premium given by hand is complimentary, not sold', pass['Premium Delegate Pass']?.total === 1 && pass['Premium Delegate Pass']?.complimentary === 1 && pass['Premium Delegate Pass']?.not_paid === 0, JSON.stringify(pass['Premium Delegate Pass']));
check('Academic, Speaker and Media Pass each have their own row', pass['Academic Pass']?.total === 1 && pass['Speaker']?.total === 1 && pass['Media Pass']?.total === 1, Object.keys(pass).join(','));
check('checked in is counted on the pass row', pass['Visitor Pass']?.checked_in === 1 && pass['VIP Pass']?.checked_in === 0, JSON.stringify(pass['Visitor Pass']));
const totals = (b.passes || []).reduce((s, p) => ({ total: s.total + p.total, today: s.today + p.today, week: s.week + p.week }), { total: 0, today: 0, week: 0 });
check('eleven conference registrations in all, every one of them today and this week', totals.total === 11 && totals.today === 11 && totals.week === 11, JSON.stringify(totals));
check('a paid tier carries today\'s list price before GST; a free pass carries none', pass['Delegate Pass']?.price > 0 && pass['VIP Pass']?.price > pass['Delegate Pass']?.price && pass['Visitor Pass']?.price === 0 && pass['Speaker']?.price === 0, JSON.stringify([pass['Delegate Pass']?.price, pass['VIP Pass']?.price, pass['Visitor Pass']?.price]));
check('as_of is a stamp', typeof b.as_of === 'string' && b.as_of.length > 8, JSON.stringify(b.as_of));

// ---- money ----
const m = b.money || {};
const sold = Object.fromEntries((m.sold || []).map(s => [s.pass, s]));
check('paid on this site: the gateway\'s figures by pass, with GST', m.online === true && sold['Delegate Pass']?.n === 1 && sold['Delegate Pass']?.total === 1061882 && sold['Delegate Pass']?.gst === 161982 && sold['VIP Pass']?.n === 1 && sold['VIP Pass']?.total === 2359882, JSON.stringify(m.sold));
check('a failed attempt before the paid one is not a sale', (m.sold || []).reduce((s, x) => s + x.n, 0) === 2, JSON.stringify(m.sold));
check('today and the week: the Delegate paid today, the VIP three days ago', sold['Delegate Pass']?.today_n === 1 && sold['Delegate Pass']?.today_paise === 1061882 && sold['VIP Pass']?.today_n === 0 && sold['VIP Pass']?.week_n === 1 && sold['VIP Pass']?.week_paise === 2359882, JSON.stringify(m.sold));
const hand = Object.fromEntries((m.by_hand || []).map(h => [h.pass, h]));
check('by hand: the mUni-era VIP with its typed amount, the Academic with none', hand['VIP Pass']?.n === 1 && hand['VIP Pass']?.recorded_paise === 2359900 && hand['VIP Pass']?.no_amount === 0 && hand['Academic Pass']?.n === 1 && hand['Academic Pass']?.recorded_paise === 0 && hand['Academic Pass']?.no_amount === 1, JSON.stringify(m.by_hand));
check('a pass paid online is never also counted as by hand', !hand['Delegate Pass'] && hand['VIP Pass']?.n === 1, JSON.stringify(m.by_hand));
check('not paid: the abandoned VIP and the refunded Delegate, worth their price with GST', m.not_paid_people === 2 && m.not_paid_value > 0 && Math.abs(m.not_paid_value - ((pass['VIP Pass']?.price || 0) + (pass['Delegate Pass']?.price || 0)) * 1.18) < 200, JSON.stringify([m.not_paid_people, m.not_paid_value, pass['VIP Pass']?.price, pass['Delegate Pass']?.price]));
check('tried online and did not get through: one person, not the one who paid on the second try', m.tried_not_paid === 1, JSON.stringify(m.tried_not_paid));
check('invoices: the tax invoice counts, the automatic receipt does not', m.invoices?.n === 1 && m.invoices?.total === 2359882, JSON.stringify(m.invoices));

// ---- waiting on you ----
const t = b.todo || {};
check('not paid = the same two people', t.not_paid === 2, JSON.stringify(t));
check('one paid online still needs an invoice (a receipt is not one)', t.invoice_due === 1, JSON.stringify(t));
check('new enquiries by type, answered ones left out', t.inquiries_new === 2 && JSON.stringify(t.inquiries.map(i => i.type).sort()) === '["speaking","sponsorship"]', JSON.stringify(t.inquiries));
check('booth requests to review', t.booths_submitted === 1, JSON.stringify(t));
check('marketplace listings to approve', t.listings_pending === 1, JSON.stringify(t));
check('boardroom bookings on hold, blocks left out', t.rooms_held === 1, JSON.stringify(t));
check('Premium or VIP without a workshop seat: the given Premium and the hand-paid VIP (the online VIP chose, the unpaid VIP does not count)', t.workshop_unchosen === 2, JSON.stringify(t));
check('photos flagged at the desk', t.photos_flagged === 1, JSON.stringify(t));

// ---- a database without the newer tables still answers ----
db.run('DROP TABLE payment_orders');
db.run('DROP TABLE workshop_seats');
db.run('DROP TABLE mp_listings');
r = await hit('/api/admin/events/1/board', ADMIN);
check('without payment_orders, workshop_seats or mp_listings the board still answers, blanks only those lines', r.status === 200 && Array.isArray(r.json?.passes) && r.json.passes.length > 0 && r.json.todo?.listings_pending === 0 && r.json.todo?.booths_submitted === 1 && r.json.money?.not_paid_people === 2, r.status + ' ' + r.text.slice(0, 200));

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll board checks passed.');
process.exit(fails ? 1 : 0);
