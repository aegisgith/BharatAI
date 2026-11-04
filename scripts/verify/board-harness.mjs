// Harness on :8782 (HARNESS_PORT) for browser-board.cjs: the WHOLE built worker
// on real SQLite (sql.js) with the production schema and a seed shaped like the
// event in early November 2026, so /admin is looked at with real answers, not
// canned ones. /app, /admin, their scripts and every /api/* go through the
// worker; everything else is served from public/. Started by run-all.mjs.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(join(ROOT, 'scripts', 'verify', 'prod-schema.sql'), 'utf8'));

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
const env = new Proxy({ ADMIN_SECRET: 'h-admin', SESSION_SECRET: 'h', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };

// ---- seed: the numbers browser-board.cjs asserts against ----
db.run("INSERT INTO events (id, title, venue, start_date, end_date, status) VALUES (1, 'Bharat AI Innovation 2026', 'World Trade Center, Mumbai', '2026-11-20', '2026-11-21', 'upcoming')");
let nextId = 1;
const person = (name, extra = {}) => {
  const id = nextId++;
  const row = { id, event_id: 1, name, email: 'p' + id + '@example.com', mobile: '98200' + String(id).padStart(5, '0'), company: ['Tata AI', 'Infosys', 'Razorpay', 'IIT Bombay', 'Zoho', 'HDFC'][id % 6],
    job_title: ['CTO', 'Director', 'Student', 'Founder', 'VP Engineering', 'Analyst'][id % 6], city: ['Mumbai', 'Pune', 'Bengaluru', 'Delhi'][id % 4], industry: ['Software & SaaS', 'BFSI', 'Education'][id % 3],
    badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, registration_source: 'website', ...extra };
  if (!row.created_at) delete row.created_at;
  const cols = Object.keys(row);
  db.run(`INSERT INTO attendees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, clean(cols.map(k => row[k])));
  return id;
};
const daysAgo = (d) => { const t = new Date(Date.now() - d * 86400000); return t.toISOString().slice(0, 19).replace('T', ' '); };
for (let i = 0; i < 2600; i++) person('Visitor ' + i, { created_at: daysAgo(Math.floor(i / 12)), pass_downloaded_at: i % 3 ? null : daysAgo(1), social_card_downloaded_at: i % 7 ? null : daysAgo(1), last_login_at: i % 2 ? daysAgo(2) : null });
const order = (id, pass, base, status, daysBack) => {
  const gst = Math.round(base * 18 / 100);
  db.run("INSERT INTO payment_orders (order_id, attendee_id, pass_type, base_paise, gst_paise, amount_paise, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ['BAI' + id + '-' + status + daysBack, id, pass, base, gst, base + gst, status, status === 'paid' ? daysAgo(daysBack) : null, daysAgo(daysBack)]);
};
// 27 Delegates paid online (one a day), 7 VIPs paid online (four chose a workshop).
for (let i = 0; i < 27; i++) { const id = person('Delegate ' + i, { badge_type: 'Delegate Pass', created_at: daysAgo(i) }); order(id, 'Delegate Pass', 899900, 'paid', i); }
for (let i = 0; i < 7; i++) { const id = person('Vip ' + i, { badge_type: 'VIP Pass', created_at: daysAgo(i * 3) }); order(id, 'VIP Pass', 1999900, 'paid', i * 3); if (i < 4) db.run("INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, ?, 1)", [id]); }
// 11 Academic confirmed by hand in the mUni era: 8 with an amount typed in, 3 without.
for (let i = 0; i < 11; i++) person('Academic ' + i, { badge_type: 'Academic Pass', payment_amount: i < 8 ? '4718.82' : '', created_at: daysAgo(20 + i) });
for (let i = 0; i < 3; i++) person('Given Premium ' + i, { badge_type: 'Premium Delegate Pass', payment_status: 'waived' });
for (let i = 0; i < 2; i++) person('Given Vip ' + i, { badge_type: 'VIP Pass', payment_status: 'waived' });
// 24 chose a paid pass and never paid (16 Delegate, 8 VIP); 12 of them tried online.
for (let i = 0; i < 24; i++) { const id = person('Left Checkout ' + i, { badge_type: i % 3 ? 'Delegate Pass' : 'VIP Pass', payment_status: 'pending', created_at: daysAgo(i) }); if (i % 2) order(id, i % 3 ? 'Delegate Pass' : 'VIP Pass', i % 3 ? 899900 : 1999900, i % 4 ? 'created' : 'failed', i); }
for (let i = 0; i < 60; i++) person('Speaker ' + i, { badge_type: 'Speaker', role: 'speaker' });
for (let i = 0; i < 9; i++) person('Media ' + i, { badge_type: 'Media Pass', role: 'media' });
for (let i = 0; i < 38; i++) person('Exhibitor ' + i, { badge_type: 'Exhibitor', role: 'exhibitor' });
for (let i = 0; i < 12; i++) person('Organiser ' + i, { badge_type: 'Organiser', role: 'organiser' });
for (let i = 0; i < 300; i++) person('Panel only ' + i, { main_event: 0 });
db.run("INSERT INTO invoices (invoice_no, attendee_id, buyer_name, buyer_email, item_desc, order_ref, taxable_paise, total_paise) VALUES ('AKT/26-27/1', 2601, 'Delegate 0', 'p2601@example.com', 'Delegate Pass', 'BAI2601-paid0', 899900, 1061882), ('AKT/26-27/2', 2602, 'Delegate 1', 'p2602@example.com', 'Delegate Pass', 'BAI2602-paid1', 899900, 1061882)");
db.run("INSERT INTO inquiries (event_id, inquiry_type, name, email, status) VALUES (1, 'speaking', 'S', 's@example.com', 'new'), (1, 'sponsorship', 'P', 'p@example.com', 'new'), (1, 'general', 'G', 'g@example.com', 'new'), (1, 'speaking', 'Old', 'o@example.com', 'responded')");
db.run("INSERT INTO booth_types (id, slug, name, size_label, width_m, depth_m, area_sqm, area_sqft, price_inr) VALUES (1, 'pod', 'Pod', '2x2', 2, 2, 4, 43, 48000)");
db.run("INSERT INTO booth_requests (event_id, booth_type_id, company_name, contact_name, email, status) VALUES (1, 1, 'Booth Co', 'B', 'b@example.com', 'submitted'), (1, 1, 'Two Co', 'T', 't@example.com', 'submitted')");
db.run("INSERT INTO mp_listings (company_id, company_name, product_name, description, status) VALUES (1, 'Mp Co', 'Thing', 'd', 'pending')");
db.run("INSERT INTO room_bookings (event_id, room_id, slot_date, slot_start, slot_end, kind, status) VALUES (1, 1, '2026-11-20', '2026-11-20 10:00', '2026-11-20 11:00', 'booking', 'held')");
for (let i = 0; i < 85; i++) db.run("INSERT INTO sessions (event_id, title, session_type, start_time, end_time) VALUES (1, ?, 'talk', '2026-11-20 10:00', '2026-11-20 10:30')", ['Session ' + i]);
for (let i = 0; i < 15; i++) db.run("INSERT INTO award_categories (event_id, name) VALUES (1, ?)", ['Category ' + i]);

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
const viaWorker = (p) => p === '/admin' || p === '/admin.js' || p.startsWith('/api/') || p === '/app' || p === '/app.js';
const PORT = Number(process.env.HARNESS_PORT || 8782);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const p = url.pathname;
  if (viaWorker(p)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request('https://bharataiinnovation.com' + p + url.search, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  try {
    const f = await readFile(join(ROOT, 'public', p.replace(/^\//, '')));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(f);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log('board harness on :' + PORT));
