// Harness on :8780 for browser-login-links.cjs: the REAL built worker on real
// SQLite (sql.js, production schema) for every /api/* call and /app, static
// files from public/, Elastic Email played here with every message kept. Started
// automatically by run-all.mjs. The emailed links point at this harness, so a
// real browser can open them.
// - GET  /__mail         every email sent so far
// - POST /__mail/clear   forget them
// - POST /__sql          {sql, args}: a SELECT returns rows, anything else runs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld } from './login-world.mjs';
import { SECRETS } from './pay-db.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// run-all.mjs hands over another port when :8780 is taken (another session's run).
const PORT = Number(process.env.HARNESS_PORT || 8780), BASE = 'http://localhost:' + PORT;
// CCAvenue's test credentials, so checkout opens (the gateway itself is played by
// browser-already-registered.cjs).
const W = await makeWorld({ appUrl: BASE + '/app', extraEnv: SECRETS });
const { worker, env, ctx, db, q, sent } = W;

const TYPES = {
  '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf',
};
const WORKER_PAGES = new Set(['/app', '/app.js', '/admin', '/admin.js']);
const DROP = new Set(['host', 'connection', 'content-length', 'accept-encoding']);

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (url.pathname === '/__mail') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(sent)); }
    if (url.pathname === '/__mail/clear') { sent.length = 0; res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/__sql' && req.method === 'POST') {
      const { sql, args = [] } = JSON.parse(body || '{}');
      let out;
      if (/^\s*select/i.test(sql)) out = q(sql, ...args);
      else { db.run(sql, args); out = { changes: db.getRowsModified() }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
    }
    if (!url.pathname.startsWith('/api/') && !WORKER_PAGES.has(url.pathname)) {
      try {
        const file = join(ROOT, 'public', decodeURIComponent(url.pathname));
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
        return res.end(data);
      } catch { /* not a public file: the worker's */ }
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !DROP.has(k)) headers[k] = v;
    // The browser says it is on localhost; the worker is told its own address.
    if (headers.origin) headers.origin = 'https://bharataiinnovation.com';
    if (headers.referer) headers.referer = headers.referer.replace(BASE, 'https://bharataiinnovation.com');
    const r = await worker.fetch(new Request('https://bharataiinnovation.com' + url.pathname + url.search, {
      method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body, redirect: 'manual',
    }), env, ctx);
    const out = {};
    r.headers.forEach((v, k) => { if (k !== 'content-encoding' && k !== 'content-length' && k !== 'set-cookie') out[k] = v; });
    // Every Set-Cookie, not only the last; and localhost is not https.
    const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    if (cookies.length) out['set-cookie'] = cookies.map(c => c.replace(/;\s*Secure/gi, ''));
    res.writeHead(r.status, out);
    return res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String((e && e.stack) || e));
  }
}).listen(PORT, () => console.log('harness on ' + BASE));
