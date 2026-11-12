// Harness on :8867 (HARNESS_PORT) for browser-media-pass.cjs (12 Nov 2026): the WHOLE built
// worker on real SQLite with the production schema (inquiry-world.mjs), the clock at
// 10:00 in India on 12 Nov 2026, a paid VIP and a media enquiry from the contact page
// already there. The email service is played; GET /__mail lists what was sent and
// GET /__db the attendees and media requests. /media-pass, /contact, /admin, its script
// and /api/* go through the worker; everything else is served from public/.
// Started by run-all.mjs.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld, mail } from './inquiry-world.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const W = makeWorld();
const { insert, ago, rows } = W;
insert('attendees', { event_id: 1, name: 'Vikram Paid', email: 'vikram@paid.in', badge_type: 'VIP Pass', payment_status: 'paid' });
insert('inquiries', { event_id: 1, inquiry_type: 'media', status: 'new', metadata: '{}', name: 'Old Press', email: 'press@daily.in', phone: '9000000001', organization: 'Daily Times', subject: 'Media Pass for 20th Nov', message: 'Hi Team, I cover tech for Daily Times.', created_at: ago(30) });

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
const viaWorker = (p) => ['/admin', '/admin.js', '/app', '/app.js', '/media-pass', '/contact'].includes(p) || p.startsWith('/api/');
const PORT = Number(process.env.HARNESS_PORT || 8867);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const p = url.pathname;
  if (p === '/__mail') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(mail)); return; }
  if (p === '/__db') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ attendees: rows('SELECT * FROM attendees ORDER BY id'), requests: rows("SELECT * FROM inquiries WHERE inquiry_type = 'media' ORDER BY id") }));
    return;
  }
  if (viaWorker(p)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await W.worker.fetch(new Request('https://bharataiinnovation.com' + p + url.search, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), W.env, W.ctx);
    await W.settle();
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  try {
    const f = await readFile(join(ROOT, 'public', p.replace(/^\//, '')));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(f);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log('media harness on :' + PORT));
