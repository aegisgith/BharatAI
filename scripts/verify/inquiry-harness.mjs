// Harness on :8861 (HARNESS_PORT) for browser-inquiry-desk.cjs: the WHOLE built worker
// on real SQLite with the production schema and 0053, the clock at 10:00 in India on
// 12 Nov 2026, and a seed shaped like the real list (booths, sponsors, a flood of
// speaking requests, General ones that are really something else, a paid delegate,
// someone who wrote three times). The email service is played; GET /__mail lists what
// was sent. /admin, its script and /api/* go through the worker; everything else is
// served from public/. Started by run-all.mjs.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld, mail } from './inquiry-world.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const W = makeWorld({ pipeline: process.env.PIPELINE !== '0' });
const { insert, ago } = W;

insert('attendees', { event_id: 1, name: 'Asha Paid', email: 'asha@tatai.com', badge_type: 'Delegate Pass', payment_status: 'paid' });
const booth = insert('booths', { event_id: 1, code: '12', type_key: 'explorer', name: 'Explorer', sqm: 9, list_price_inr: 150000 });
insert('booth_allocations', { event_id: 1, booth_id: booth, company_name: 'Booth Co', email: 'buyer@boothco.in', status: 'confirmed', amount_inr: 150000 });
insert('staff', { name: 'Anita Ram', username: 'anita', password_hash: 'x', role: 'admin' });
const mk = (o) => insert('inquiries', { event_id: 1, status: 'new', metadata: '{}', ...o });
mk({ inquiry_type: 'sponsorship', name: 'Asha Paid', email: 'asha@tatai.com', organization: 'Tata AI', subject: 'Title sponsorship', message: 'We would like the title slot.', created_at: ago(30) });
mk({ inquiry_type: 'booth_inquiry', name: 'Ravi Kumar', email: 'ravi@acme.in', phone: '+91 98200 11111', organization: 'Acme Robotics', subject: 'Booth Inquiry: explorer', message: 'Warehouse robot demo', metadata: JSON.stringify({ booth_type: 'explorer', estimated_total: 150000 }), created_at: ago(3) });
mk({ inquiry_type: 'booth_inquiry', name: 'Buyer', email: 'buyer@boothco.in', organization: 'Booth Co', subject: 'Second stand?', message: 'Can we add a stand', created_at: ago(5) });
mk({ inquiry_type: 'general', name: 'Rida Dange', email: 'ridadange2408@gmail.com', phone: '9920432519', subject: 'Rida Dange', message: 'want to ask about events', created_at: ago(2) });
mk({ inquiry_type: 'media', name: 'Abhilekh Verma', email: 'ceo@abhilekhvermaconsultancy.com', phone: '9505604477', organization: 'Abhilekh Verma Consultancy OPC Private Limited', subject: 'Media Pass for 20th Nov', message: 'Hi Team, I have done media work for over 50+ conferences globally', created_at: ago(4) });
mk({ inquiry_type: 'general', name: 'Vishweshwar Joshi', email: 'vishweshwar@startupsgurukul.com', phone: '+918830403955', organization: 'startupsgurukul', subject: 'Looking for speaker opportunity', message: 'Hi Team I have submitted my details as speaker please let me know if you need to', created_at: ago(70) });
mk({ inquiry_type: 'speaking', name: 'Vishweshwar Joshi', email: 'vishweshwar@startupsgurukul.com', organization: 'startupsgurukul', subject: 'AI in governance', message: 'Talk proposal', created_at: ago(72) });
mk({ inquiry_type: 'group_registration', name: 'Prof Mehta', email: 'mehta@college.edu', organization: 'City College', subject: '40 students', message: 'Passes for 40 students', metadata: JSON.stringify({ group_size: '40' }), created_at: ago(26) });
mk({ inquiry_type: 'general', name: 'Formula Person', email: 'f@x.in', subject: 'Spreadsheet', message: '=HYPERLINK("http://evil","click")', created_at: ago(1) });
// A name typed into the public form to attack the admin who reads it.
mk({ inquiry_type: 'sponsorship', name: '<img src=x onerror="window.__iqXss=1">Mallory', email: 'mallory@evil.example', organization: '<b onmouseover="window.__iqXss=2">Evil</b>', subject: '<script>window.__iqXss=3</script>Deal', message: '<img src=x onerror="window.__iqXss=4">', created_at: ago(2) });
mk({ inquiry_type: 'sponsorship', name: 'Won Deal', email: 'won@won.in', organization: 'Won Ltd', status: 'won', created_at: ago(240) });
for (let i = 0; i < 28; i++) mk({ inquiry_type: 'speaking', name: 'Speaker ' + String.fromCharCode(65 + (i % 26)) + i, email: `speaker${i}@talks.in`, subject: 'Speaking request ' + i, message: 'I would like to speak about AI ' + i, created_at: ago(6 + i * 9) });
mk({ inquiry_type: 'delhi_pass', name: 'Delhi Visitor', email: 'd@delhi.in', status: 'waitlisted', subject: 'Delhi 2027 · Free Visitor Pass' });

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
const viaWorker = (p) => p === '/admin' || p === '/admin.js' || p.startsWith('/api/') || p === '/app' || p === '/app.js';
const PORT = Number(process.env.HARNESS_PORT || 8861);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const p = url.pathname;
  if (p === '/__mail') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(mail)); return; }
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
}).listen(PORT, () => console.log('inquiry harness on :' + PORT));
