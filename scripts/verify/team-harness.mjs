// Harness on :8851 (HARNESS_PORT) for browser-exhibitor-team.cjs: the WHOLE built
// worker on real SQLite (sql.js) with the production schema plus migration 0050, and
// a seed of two exhibitors (an Explorer Booth with its contact's account, and a
// company known only from the booking sheet). /marketplace pages, /register and every
// /api/* go through the worker; everything else is served from public/. The mail
// service is answered here, so no email leaves; GET /__sent lists what was "sent".
// Started by run-all.mjs.
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
db.exec(readFileSync(join(ROOT, 'migrations', '0050_exhibitor_team.sql'), 'utf8'));
db.exec(readFileSync(join(ROOT, 'migrations', '0051_leads_and_daily_checkins.sql'), 'utf8'));

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
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ MessageID: 'm' + sent.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const env = new Proxy({ ADMIN_SECRET: 'h-admin', SESSION_SECRET: 'h', MP_SESSION_SECRET: 'h-mp', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };

// ---- seed ----
db.run("INSERT INTO events (id, title, venue, start_date, end_date, status) VALUES (1, 'Bharat AI Innovation 2026', 'World Trade Center, Mumbai', '2026-11-20', '2026-11-21', 'upcoming')");
db.run("INSERT INTO app_settings (key, value) VALUES ('elastic_email_api_key', 'test-key')");
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (1, 1, 'Harness Explorer Pvt Ltd', 'spoc@explorer.test', '21')");
db.run("INSERT INTO booths (id, event_id, code, type_key, name, dim) VALUES (1, 1, '21', 'explorer', 'Explorer Booth', '2m x 2m')");
db.run("INSERT INTO booth_allocations (event_id, booth_id, exhibitor_id, company_name, contact_name, status, amount_inr, gst_inr, grand_total_inr, amount_paid_inr, invoice_number) VALUES (1, 1, 1, 'Harness Explorer Pvt Ltd', 'Richa', 'confirmed', 129000, 23220, 152220, 100000, 'BAI/26-27/9')");
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (1, 'Harness Explorer Pvt Ltd', 'spoc@explorer.test', '', 1)");
db.run("INSERT INTO exhibitor_team_settings (exhibitor_id, contact_name, owner_name, owner_email) VALUES (1, 'Richa Roy', 'Test Owner', 'owner@example.test')");
db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (2, 1, 'Sheet Only Labs', 'spoc@sheet.test', '40')");
db.run("INSERT INTO mp_companies (id, company_name, email, password_hash, exhibitor_id) VALUES (2, 'Sheet Only Labs', 'spoc@sheet.test', '', 2)");
db.run("INSERT INTO exhibitor_team_settings (exhibitor_id, booth_type, booth_name, booth_dim, booths, contact_name) VALUES (2, 'pod', 'Startup Pod', '1.5m x 1.5m', 1, 'Shweta Bhanot')");
db.run("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, at_booth, speaker, added_by) VALUES (1, 2, 'Shivendra', 'Singh', 'Founder', 'Sheet Only Labs', 'shivendra@sheet.test', 1, 1, 'sheet')");
// Someone whose mobile is already registered, to see the refusal on screen.
db.run("INSERT INTO attendees (event_id, name, email, mobile, badge_type, main_event) VALUES (1, 'Somebody Else', 'someone@else.test', '9820012345', 'Visitor Pass', 1)");

// A Premium Delegate whose workshop is over and who was checked in that day: for the
// workshop certificate. The dates are in the past so the harness needs no moved clock.
db.run("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event, checked_in_at, checked_in_by) VALUES (900, 1, 'Wendy Workshop', 'wendy@example.test', 'Premium Delegate Pass', 'paid', 1, '2026-11-10 05:00:00', 'Desk One')");
db.run("INSERT INTO workshops (id, event_id, slug, title, speaker, starts_at, ends_at) VALUES (1, 1, 'cxo-guide', 'The CXO Guide to AI', 'Dr. Vinay Kulkarni', '2026-11-10 10:00', '2026-11-10 13:00')");
db.run("INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (1, 900, 1)");
db.run("INSERT INTO checkins (event_id, attendee_id, day, checked_in_at, checked_in_by) VALUES (1, 900, '2026-11-10', '2026-11-10 05:00:00', 'Desk One')");

// A badge desk account, for the scanner opening from the home screen and with no internet.
db.run("INSERT INTO staff (id, name, username, password_hash, active, role) VALUES (1, 'Desk One', 'desk1', 'x', 1, 'desk')");

const TYPES = { '.webmanifest': 'application/manifest+json', '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
// /app too: run-all.mjs asks for it to know the harness is up.
const viaWorker = (p) => p.startsWith('/api/') || p === '/marketplace' || p.startsWith('/marketplace/') || p === '/register' || p === '/app' || p === '/app.js' || p.startsWith('/verify/') || p.startsWith('/exhibitor/') || p === '/staff' || p.startsWith('/staff/');
const PORT = Number(process.env.HARNESS_PORT || 8851);
let down = false;
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const p = url.pathname;
  // /__down?on=1 cuts every connection, as a venue with no signal does; ?on=0 restores it.
  if (p === '/__down') { down = url.searchParams.get('on') === '1'; res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(String(down)); return; }
  if (down) { req.socket.destroy(); return; }
  if (p === '/__sent') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(sent)); return; }
  if (p === '/__db') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(rows(url.searchParams.get('q') || 'SELECT 1', []))); return; }
  if (viaWorker(p)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request('https://bharataiinnovation.com' + p + url.search, { method: req.method, headers: req.headers, redirect: 'manual', body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, ctx);
    const headers = Object.fromEntries(r.headers);
    // The worker's cookies are Secure for https; the harness is plain http on localhost.
    const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    if (cookies.length) headers['set-cookie'] = cookies.map(c => c.replace(/;\s*Secure/i, ''));
    if (headers.location) headers.location = headers.location.replace('https://bharataiinnovation.com', '');
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  try {
    const f = await readFile(join(ROOT, 'public', decodeURIComponent(p).replace(/^\//, '')));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(f);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log('team harness on http://localhost:' + PORT));
