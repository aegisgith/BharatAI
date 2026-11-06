// Harness for browser-marketplace-browse.cjs: the /marketplace page from the REAL built worker,
// public/ from disk, and made-up listings so the suite never depends on real companies.
// - /api/__mode?m=ok|empty|fail|few: what GET /api/mp/listings answers from now on.
// - /api/mp/auth/me answers 401 (signed out); any other write is refused and counted.
// Started by run-all.mjs.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.HARNESS_PORT || 8812), BASE = 'http://localhost:' + PORT;
const worker = (await import(pathToFileURL(join(ROOT, 'dist', '_worker.js')).href + '?' + Date.now())).default;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };

const CATS = ['AI Agents', 'Speech / Voice AI', 'Sales Automation', 'Recruitment Automation', 'Content Generation', 'Workflow Automation'];
const fake = (id, over = {}) => ({
  id, status: 'approved', company_name: 'Test Company ' + id, company_slug: 'test-company-' + id, product_name: 'Test Product ' + id, product_slug: 'test-product-' + id,
  description: 'A made-up product for the page test. It is long enough to run past two lines on a phone so the card has to cut it off the way a real description would be cut off.',
  ai_category: CATS[id % CATS.length] + ', ' + CATS[(id + 1) % CATS.length], tags: 'alpha, beta', target_industry: id % 2 ? 'Banking' : 'Retail', pricing_type: 'Custom',
  logo_url: '/api/mp/uploads/' + id, exhibitor_booth: null, booth_number: null, ...over,
});
const ALL = [
  ...Array.from({ length: 12 }, (_, i) => fake(i + 1)),
  fake(13, { product_name: 'Adi Test', company_name: 'Ministry of Testing', company_slug: 'ministry', product_slug: 'adi-test' }),
  fake(14, { product_name: 'Booth Product', exhibitor_booth: 'B7' }),
  fake(15, { product_name: 'Hall Product', booth_number: '38' }),
  fake(16, { product_name: 'No Logo Product', logo_url: '', pricing_type: '' }),
];
let mode = 'ok';
const refused = [];
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const ctx = { waitUntil() {}, passThroughOnException() {} };

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE), p = url.pathname;
  try {
    if (p === '/api/__mode') { mode = url.searchParams.get('m') || 'ok'; return json(res, 200, { mode, refused }); }
    if (p === '/api/__state') return json(res, 200, { mode, refused });
    if (p === '/api/mp/listings') {
      if (mode === 'fail') return json(res, 500, { error: 'down' });
      return json(res, 200, { listings: mode === 'empty' ? [] : mode === 'few' ? ALL.slice(0, 3) : ALL });
    }
    if (/^\/api\/mp\/uploads\/\d+$/.test(p)) {
      res.writeHead(200, { 'Content-Type': 'image/webp' });
      return res.end(await readFile(join(ROOT, 'public', 'images', 'logo-nav.webp')));
    }
    if (p === '/api/mp/auth/me') return json(res, 401, { error: 'signed out' });
    if (p.startsWith('/api/')) { refused.push(req.method + ' ' + p); return json(res, 401, { error: 'refused here' }); }
    if (p.startsWith('/marketplace')) {
      const r = await worker.fetch(new Request(BASE + req.url), new Proxy({}, { get: () => undefined }), ctx);
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'text/html' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const body = await readFile(join(ROOT, 'public', p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    if (e && e.code === 'ENOENT') { res.writeHead(404); return res.end('not found'); }
    res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(e && e.stack || e));
  }
}).listen(PORT, () => console.log('mk-browse-harness on ' + BASE));
