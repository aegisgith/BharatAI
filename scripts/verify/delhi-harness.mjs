// Harness on :8786 (HARNESS_PORT) for browser-delhi.cjs: the WHOLE built worker on
// real SQLite (sql.js) with the production schema answers /api/*; every other path
// comes from public/ with clean URLs, as Cloudflare Pages serves it (/delhi is
// delhi.html). The email service is played here. /__inquiries and /__mail let the
// test read what really landed. Started by run-all.mjs.
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.HARNESS_PORT || 8786);
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;
const SQL = await initSqlJs();
const db = new SQL.Database();
db.exec(readFileSync(join(ROOT, 'scripts', 'verify', 'prod-schema.sql'), 'utf8'));
db.run("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'Bharat AI Innovation 2026', '2026-11-20', '2026-11-21')");

const clean = (a) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const rows = (sql, args = []) => { const st = db.prepare(sql); st.bind(args); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
const D1 = {
  prepare(sql) {
    let args = [];
    const s = {
      bind(...a) { args = clean(a); return s; },
      async first() { return rows(sql, args)[0] || null; },
      async all() { return { results: rows(sql, args) }; },
      async run() { db.run(sql, args); return { meta: { last_row_id: db.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: db.getRowsModified() } }; },
    };
    return s;
  },
  async batch(list) { return Promise.all(list.map(s => s.all())); },
};
const env = new Proxy({ ADMIN_SECRET: 'h-admin', SESSION_SECRET: 'h', ELASTIC_EMAIL_API_KEY: 'test-key', DB: D1 }, { get: (t, k) => (k in t ? t[k] : undefined) });
const pending = [];
const ctx = { waitUntil(p) { pending.push(p); }, passThroughOnException() {} };

// The email service, played: nothing leaves this machine.
const mail = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('elasticemail.com')) { mail.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  throw new Error('harness: no outside calls, asked for ' + url);
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ics': 'text/calendar; charset=utf-8', '.json': 'application/json', '.ico': 'image/x-icon', '.avif': 'image/avif', '.txt': 'text/plain', '.xml': 'application/xml' };
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  if (url.pathname === '/__inquiries') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(rows('SELECT * FROM inquiries ORDER BY id'))); }
  if (url.pathname === '/__mail') { await Promise.allSettled(pending); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(mail)); }
  const p = decodeURIComponent(url.pathname);
  const base = join(ROOT, 'public', p);
  const f = p.endsWith('/') ? join(base, 'index.html') : isFile(base) ? base : base + '.html';
  // As on the live site: a path with no static file belongs to the worker.
  if (!isFile(f)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const init = { method: req.method, headers: req.headers };
    if (chunks.length) init.body = Buffer.concat(chunks);
    const r = await worker.fetch(new Request('https://bharataiinnovation.com' + req.url, init), env, ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(await readFile(f));
}).listen(PORT, () => console.log('delhi harness on :' + PORT));
