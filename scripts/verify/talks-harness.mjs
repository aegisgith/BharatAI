// Harness on :8863 (HARNESS_PORT) for browser-innovation-talks.cjs: the WHOLE built
// worker on real SQLite (talks-world.mjs: the production schema, migrations 0050 and
// 0052, the 48 real talks and the real talk times), plus two booth contacts and one
// signed-in attendee. /admin, /app and every /api/* go through the worker; everything
// else is served from public/. No email leaves: GET /__sent lists what was "sent",
// GET /__db?q= reads the database. Started by run-all.mjs.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { talksWorld } from './talks-world.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const W = await talksWorld({ times: true });
W.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (21, 1, 'P99SOFT', 'spoc@p99soft.test', '69')");
W.db.run("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (22, 1, 'Joget INC', 'spoc@joget.test', '10')");
W.db.run("INSERT INTO attendees (id, event_id, name, email, mobile, company, job_title, badge_type, main_event) VALUES (500, 1, 'Priya Phone', 'priya@example.test', '9820099999', 'Phone Co', 'Analyst', 'Visitor Pass', 1)");

const TYPES = { '.webmanifest': 'application/manifest+json', '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
const viaWorker = (p) => p === '/admin' || p === '/admin.js' || p === '/app' || p === '/app.js' || p.startsWith('/api/');
const PORT = Number(process.env.HARNESS_PORT || 8863);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const p = url.pathname;
  if (p === '/__sent') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(W.sent)); return; }
  if (p === '/__db') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(W.rows(url.searchParams.get('q') || 'SELECT 1'))); return; }
  if (viaWorker(p)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== 'host'));
    const out = await W.fetchRaw(new Request('https://bharataiinnovation.com' + p + url.search, { method: req.method, headers, redirect: 'manual', body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }));
    const h = Object.fromEntries(out.headers);
    const cookies = typeof out.headers.getSetCookie === 'function' ? out.headers.getSetCookie() : [];
    if (cookies.length) h['set-cookie'] = cookies.map(c => c.replace(/;\s*Secure/i, ''));
    if (h.location) h.location = h.location.replace('https://bharataiinnovation.com', '');
    res.writeHead(out.status, h);
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  try {
    const f = await readFile(join(ROOT, 'public', decodeURIComponent(p).replace(/^\//, '')));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(f);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log('talks harness on http://localhost:' + PORT));
