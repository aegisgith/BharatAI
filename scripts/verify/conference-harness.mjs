// Harness on :8857 (HARNESS_PORT) for browser-conference.cjs: the WHOLE built worker
// on real SQLite with migration 0054 applied and a small programme seeded
// (conference-world.mjs). /admin, /app and every /api/* go through the worker;
// everything else is served from public/. Mail is answered here (GET /__sent);
// GET /__db?q= reads the database. Started by run-all.mjs.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { makeWorld, ROOT } from './conference-world.mjs';

const W = await makeWorld({ migrated: process.env.CONF_MIGRATED !== '0' });
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const viaWorker = (p) => p.startsWith('/api/') || p === '/admin' || p === '/admin.js' || p === '/app' || p === '/app.js';
const PORT = Number(process.env.HARNESS_PORT || 8857);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const p = url.pathname;
  if (p === '/__sent') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(W.sent)); return; }
  if (p === '/__db') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(W.rows(url.searchParams.get('q') || 'SELECT 1'))); return; }
  if (viaWorker(p)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await W.worker.fetch(new Request('https://bharataiinnovation.com' + p + url.search, { method: req.method, headers: req.headers, redirect: 'manual', body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), W.env, W.ctx);
    const headers = Object.fromEntries(r.headers);
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
}).listen(PORT, () => console.log('conference harness on http://localhost:' + PORT));
