// Harness on :8881 (HARNESS_PORT) for browser-talk-self.cjs: the WHOLE built worker on
// real SQLite with 0052 and two talks (talk-self-world.mjs). /app, /app/my-talk and
// every /api/* go through the worker; everything else is served from public/.
// GET /__db?q= reads the database; GET /__link?id=&exp= makes a link the way the
// server does. Started by run-all.mjs.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { makeWorld, tokenMaker, ROOT } from './talk-self-world.mjs';

const W = await makeWorld();
const T = await tokenMaker();
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
const viaWorker = (p) => p.startsWith('/api/') || p === '/app' || p.startsWith('/app/') || p === '/app.js' || p === '/admin' || p === '/admin.js';
const PORT = Number(process.env.HARNESS_PORT || 8881);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const p = url.pathname;
  if (p === '/__db') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(W.rows(url.searchParams.get('q') || 'SELECT 1'))); return; }
  if (p === '/__link') {
    const exp = Number(url.searchParams.get('exp')) || Math.floor(Date.now() / 1000) + 86400;
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(await T.signTalkToken('h', Number(url.searchParams.get('id')), exp)); return;
  }
  if (viaWorker(p)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await W.worker.fetch(new Request('https://bharataiinnovation.com' + p + url.search, { method: req.method, headers: req.headers, redirect: 'manual', body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), W.env, W.ctx);
    const headers = Object.fromEntries(r.headers);
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
}).listen(PORT, () => console.log('talk-self harness on http://localhost:' + PORT));
