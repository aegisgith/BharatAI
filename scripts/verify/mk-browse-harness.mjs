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
// A product page's own record: every field filled, with hostile text where a vendor could put it.
const RICH = fake(1, {
  company_slug: 'rich-co', product_slug: 'rich-product', company_name: 'Rich Company', product_name: 'Rich Product',
  description: Array.from({ length: 9 }, (_, i) => 'Paragraph ' + (i + 1) + ' of the description, long enough to fill a line or two on a phone screen by itself.').join('\n'),
  target_customer: 'Bank CIOs and their teams', current_customers: 'A made-up bank', innovation: 'It does a made-up thing differently.',
  use_cases: 'Answer calls\nRead forms\nWrite letters', pricing_type: 'Freemium', pricing_details: 'From INR 99 a month',
  access_info: 'Sign up at https://rich.example/start/. Bad: javascript:alert(1)', website_url: 'https://rich.example', demo_url: 'https://rich.example/demo', product_image_url: '/api/mp/uploads/1',
  screenshot_urls: '/api/mp/uploads/2,/api/mp/uploads/3', supported_platforms: 'Web, Android', tech_stack: 'Python', integration_requirements: 'An API key', security_protocols: 'Encryption',
  support_offering: 'Email', onboarding_process: 'Self-serve', sla_details: '99.9%', case_studies: 'A made-up case study.', founder_name: 'A Founder', sales_contact_name: 'A Seller', sales_contact_email: 'sales@rich.example', exhibitor_booth: 'B7',
});
const PRODUCTS = {
  'rich-co/rich-product': RICH,
  'long-co/long-name': fake(101, { company_slug: 'long-co', product_slug: 'long-name', product_name: 'Enterprise AI And Custom Cloud Solutions For Every Team In The Company (Custom AI Development)', ai_category: 'Nothing Else Uses This' }),
  'same-co/same-price': fake(104, { company_slug: 'same-co', product_slug: 'same-price', product_name: 'Same Price', pricing_type: 'Freemium', pricing_details: 'Freemium' }),
  'bare-co/bare': fake(102, { company_slug: 'bare-co', product_slug: 'bare', product_name: 'Bare', company_name: 'Bare', description: '', logo_url: '', pricing_type: '', ai_category: '', tags: '', target_industry: '', website_url: '' }),
  'hostile-co/hostile': fake(103, { company_slug: 'hostile-co', product_slug: 'hostile', product_name: '<img src=x onerror=window.__hit=1> Evil', description: '<script>window.__hit=1</script>Words', website_url: 'javascript:window.__hit=1', access_info: 'https://ok.example/"><img src=x onerror=window.__hit=1>' }),
};
const inquiries = [];
let mode = 'ok';
const refused = [];
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const ctx = { waitUntil() {}, passThroughOnException() {} };

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE), p = url.pathname;
  try {
    if (p === '/api/__mode') { mode = url.searchParams.get('m') || 'ok'; return json(res, 200, { mode, refused }); }
    if (p === '/api/__state') return json(res, 200, { mode, refused, inquiries });
    const slug = p.match(/^\/api\/mp\/listings\/by-slug\/([^/]+)\/([^/]+)$/);
    if (slug) {
      if (mode === 'detail-down') return json(res, 500, { error: 'Something went wrong' });
      const l = PRODUCTS[slug[1] + '/' + slug[2]];
      return l ? json(res, 200, { listing: l }) : json(res, 404, { error: 'Listing not found' });
    }
    if (/^\/api\/mp\/listings\/\d+\/reviews$/.test(p)) return json(res, 200, { reviews: p.includes('/1/') ? [{ company_name: 'A Reviewer', rating: 5, comment: 'Made up.', created_at: '2026-11-01 10:00:00' }] : [] });
    if (p === '/api/mp/inquiries' && req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      inquiries.push(JSON.parse(raw));
      return json(res, 200, { ok: true });
    }
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
