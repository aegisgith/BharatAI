// Harness on :8865 (HARNESS_PORT) for browser-submissions.cjs: the WHOLE built worker
// on real SQLite with the production schema, 0050, 0052 and 0055, the uploads bucket
// played in memory, and five emails pushed through the real route AImailPilot uses: a
// logo from a booth contact, a photo from a speaker, a team list, a vector logo with a
// script inside from a colleague, and a stranger whose name, subject and file name try
// to attack the admin who reads them. The pictures are real PNGs so thumbnails draw.
// /admin, its script and /api/* go through the worker; the rest is served from public/.
// Started by run-all.mjs.
import http from 'node:http';
import zlib from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld, file, svg } from './submissions-world.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const W = makeWorld();

// A real PNG of one colour, w by h.
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
const realPng = (w, h, [r, g, b]) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const line = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { line[1 + x * 3] = r; line[2 + x * 3] = g; line[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => line));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]));
};

await W.push({ source_id: 'h-logo', received_at: '2026-11-12T03:00:00.000Z', subject: 'Our logo for the website', text: 'Hi Puja,\nWhile the logos of the other exhibitors are on the website, ours has not been added.\nCan you please add our logo.\n\nRegards,\nRavi Kumar', attachments: [file('Acme logo.png', realPng(300, 100, [200, 79, 0]), 'image/png')] });
await W.push({ source_id: 'h-photo', received_at: '2026-11-12T03:10:00.000Z', from_email: 'asha.rao@acmerobotics.in', from_name: 'Asha Rao', subject: 'My photo for the talk', text: 'Hello, please find my photograph attached.', attachments: [file('IMG_2231.png', realPng(120, 160, [40, 90, 160]), 'image/png')] });
await W.push({ source_id: 'h-team', received_at: '2026-11-12T03:20:00.000Z', subject: 'Team members for passes', text: 'Hi Team,\nOur team members for the exhibitor passes:\n1. Priya Nair - Marketing Head - priya.nair@acmerobotics.in - 98200 12345\n2. Arjun Mehta, Sales Manager, arjun@acmerobotics.in, +91 9820098200\n3) Kiran Rao | CTO | kiran@acmerobotics.in\n\nThanks,\nRavi' });
await W.push({ source_id: 'h-svg', received_at: '2026-11-12T03:30:00.000Z', from_email: 'newperson@acmerobotics.in', from_name: 'New Person', subject: 'Logo in vector', text: 'Sharing the logo in vector.', attachments: [file('brandmark.svg', svg(true), 'image/svg+xml')] });
await W.push({ source_id: 'h-evil', received_at: '2026-11-12T03:40:00.000Z', from_email: 'mallory@evil.example', from_name: '<img src=x onerror="window.__subXss=1">Mallory', subject: '<script>window.__subXss=2</script>Logo', text: '<b onmouseover="window.__subXss=3">our logo</b> "quoted" \'single\'\n<img src=x onerror="window.__subXss=4">', link: 'javascript:window.__subXss=5',
  attachments: [file('logo"><img src=x onerror=window.__subXss=6>.png', realPng(200, 60, [10, 10, 10]), 'image/png')] });

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
const viaWorker = (p) => p === '/admin' || p === '/admin.js' || p.startsWith('/api/') || p === '/app' || p === '/app.js';
const PORT = Number(process.env.HARNESS_PORT || 8865);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const p = url.pathname;
  // What the tests ask the database directly.
  if (p === '/__db') {
    const out = {
      exhibitors: W.rows('SELECT id, company_name, logo_url FROM exhibitors ORDER BY id'),
      talks: W.rows('SELECT id, speaker_name, speaker_photo_url FROM innovation_talks ORDER BY id'),
      team: W.rows('SELECT first_name, last_name, email, added_by, pass, pass_note FROM exhibitor_team ORDER BY id'),
      subs: W.rows('SELECT id, source_id, status, kind FROM inbox_submissions ORDER BY id'),
      settings: W.rows("SELECT value FROM app_settings WHERE key = 'inbox_submissions_auto'"),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
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
}).listen(PORT, () => console.log('submissions harness on :' + PORT));
