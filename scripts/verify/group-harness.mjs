// Harness on :8883 (HARNESS_PORT) for browser-group-booking.cjs: the WHOLE built worker
// on real SQLite (sql.js) with the production schema and 0059 (group_orders); every
// path with no static file (/group, /api/*, /pay/*) goes to the worker, the rest comes
// from public/ as Cloudflare Pages serves it. Checkout is on with the kit's made-up
// keys; the email service is played. /__answer is the gateway's answer for the latest
// order, /__rows and /__mail what really landed. Started by run-all.mjs.
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SECRETS, kitEncrypt, gatewayAnswer } from './pay-db.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.HARNESS_PORT || 8883);
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(join(ROOT, 'scripts', 'verify', 'prod-schema.sql'), 'utf8'));
db.exec(readFileSync(join(ROOT, 'migrations', '0059_group_orders.sql'), 'utf8'));
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI Innovation 2026', '2026-11-20', '2026-11-21')");
// Someone who already holds a confirmed Delegate Pass: the form must refuse them by row.
db.run("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, payment_amount) VALUES (7, 1, 'Has A Pass', 'holder@paid.example', '9800000007', 'Delegate Pass', 'paid', '10618.82')");

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
  // Real results for a SELECT, a real last_row_id for a write (issueInvoice reads it).
  async batch(list) { const out = []; for (const s of list) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); return out; },
};
for (const [k, v] of [['inv_legal_name', 'Aegis Knowledge Trust'], ['inv_gstin', '27AAATA1234B1Z5'], ['inv_state', 'Maharashtra'], ['inv_state_code', '27']]) db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', [k, v]);
const env = new Proxy({ ADMIN_SECRET: 'h-admin', SESSION_SECRET: 'h', ELASTIC_EMAIL_API_KEY: 'test-key', DB: D1, ...SECRETS }, { get: (t, k) => (k in t ? t[k] : undefined) });
const pending = [];
const ctx = { waitUntil(p) { pending.push(p); }, passThroughOnException() {} };

// The email service, played: nothing leaves this machine.
const mail = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { mail.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  throw new Error('harness: no outside calls, asked for ' + url);
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.avif': 'image/avif', '.txt': 'text/plain' };
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  if (url.pathname === '/__rows') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ attendees: rows('SELECT * FROM attendees ORDER BY id'), orders: rows('SELECT * FROM payment_orders ORDER BY id'), groups: rows('SELECT * FROM group_orders ORDER BY id'), invoices: rows('SELECT * FROM invoices ORDER BY id') }));
  }
  if (url.pathname === '/__answer') {
    const o = rows('SELECT * FROM payment_orders ORDER BY id DESC LIMIT 1')[0];
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(kitEncrypt(gatewayAnswer('h', o, { order_status: url.searchParams.get('status') || 'Success' })));
  }
  if (url.pathname === '/__mail') { await Promise.allSettled(pending); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(mail)); }
  const p = decodeURIComponent(url.pathname);
  const base = join(ROOT, 'public', p);
  const f = p.endsWith('/') ? join(base, 'index.html') : isFile(base) ? base : base + '.html';
  // As on the live site: a path with no static file belongs to the worker.
  if (!isFile(f)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const init = { method: req.method, headers: req.headers, redirect: 'manual' };
    if (chunks.length) init.body = Buffer.concat(chunks);
    const r = await worker.fetch(new Request('https://bharataiinnovation.com' + req.url, init), env, ctx);
    const headers = Object.fromEntries(r.headers);
    if (headers.location) headers.location = headers.location.replace('https://bharataiinnovation.com', '');
    res.writeHead(r.status, headers);
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(await readFile(f));
}).listen(PORT, () => console.log('group harness on :' + PORT));
