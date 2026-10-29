// The badge desk scanner (/staff/scan), end to end in a real browser, no server:
// the page comes from the built worker with a desk cookie, /js/* from public/, the
// camera is a canvas showing a pass QR, and /verify/<token> is answered by a stub
// that records the path. Runs the page in every reader situation a phone at the
// door can be in. Run after `npm run build`:  node scripts/verify/browser-scan-page.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { staffCookie } from './pay-db.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('./playwright.cjs');
const ROOT = new URL('../../', import.meta.url);
const worker = (await import(new URL('dist/_worker.js?' + Date.now(), ROOT).href)).default;

const SECRET = 'scan-secret';
const DB = { prepare(sql) { let args = []; const flat = sql.replace(/\s+/g, ' ').trim(); const s = {
  bind(...a) { args = a; return s; },
  async first() { if (/FROM staff WHERE id = \?$/.test(flat)) return { id: 1, name: 'Desk One', username: 'desk1', active: 1, role: 'desk' }; return null; },
  async all() { if (/^PRAGMA table_info\(staff\)$/.test(flat)) return { results: ['id', 'role', 'failed_attempts'].map(name => ({ name })) }; return { results: [] }; },
  async run() { return { meta: { changes: 1 } }; } }; return s; } };
const env = { ADMIN_SECRET: 'a', SESSION_SECRET: SECRET, DB };
const ctxw = { waitUntil() {}, passThroughOnException() {} };
const TOKEN = '12345.abcdefabcdefabcdefabcdef';
const PASS_QR = 'https://bharataiinnovation.com/verify/' + TOKEN;
const qrSrc = readFileSync(new URL('public/js/vendor/qrcode-generator.js', ROOT), 'utf8');
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function scenario(name, { payload, native, expectPath, expectNoNav }) {
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let verifyHit = null;
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/staff/scan') {
      const r = await worker.fetch(new Request('https://bharataiinnovation.com/staff/scan', { headers: { Cookie: staffCookie(SECRET, 1) } }), env, ctxw);
      return route.fulfill({ status: r.status, contentType: 'text/html; charset=utf-8', body: await r.text() });
    }
    if (u.pathname.startsWith('/js/')) return route.fulfill({ contentType: 'application/javascript', body: readFileSync(new URL('public' + u.pathname, ROOT), 'utf8') });
    if (u.pathname.startsWith('/verify/')) { verifyHit = u.pathname; return route.fulfill({ contentType: 'text/html', body: '<title>verify stub</title>ok' }); }
    return route.fulfill({ status: 404, body: '' });
  });
  // The camera: a canvas with the code drawn on it, repainted so the stream keeps
  // delivering frames. The native reader is removed, broken, empty or faked.
  await page.addInitScript(({ qrSrc, payload, native }) => {
    eval(qrSrc);
    const q = qrcode(0, 'M'); q.addData(payload); q.make();
    const n = q.getModuleCount(), cell = 7, margin = 4, size = (n + 2 * margin) * cell;
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    const paint = () => {
      g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 640, 480);
      const ox = Math.round((640 - size) / 2), oy = Math.round((480 - size) / 2);
      g.fillStyle = '#fff'; g.fillRect(ox, oy, size, size); g.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(ox + (k + margin) * cell, oy + (r + margin) * cell, cell, cell);
      g.fillStyle = 'rgba(0,0,0,0.01)'; g.fillRect(0, 0, 2, 2);
    };
    paint(); setInterval(paint, 100);
    const stream = c.captureStream(10);
    navigator.mediaDevices.getUserMedia = async () => stream;
    if (native === 'absent') { delete window.BarcodeDetector; }
    else if (native === 'throws') { window.BarcodeDetector = class { static getSupportedFormats() { return Promise.resolve(['qr_code']); } async detect() { throw new Error('Barcode detection service unavailable'); } }; }
    else if (native === 'noformat') { window.BarcodeDetector = class { static getSupportedFormats() { return Promise.resolve([]); } async detect() { return []; } }; }
    else if (native === 'works') { window.BarcodeDetector = class { static getSupportedFormats() { return Promise.resolve(['qr_code']); } async detect() { return [{ rawValue: payload, format: 'qr_code' }]; } }; }
  }, { qrSrc, payload, native });
  await page.goto('https://bharataiinnovation.com/staff/scan', { waitUntil: 'domcontentloaded' });
  let navigated = false;
  try { await page.waitForURL(/\/verify\//, { timeout: 8000 }); navigated = true; } catch (e) { /* no navigation */ }
  const where = page.url();
  const msg = navigated ? '' : await page.evaluate(() => (document.getElementById('e') || {}).textContent || '');
  if (expectNoNav) check(name, !navigated && verifyHit === null && !errors.length, `navigated=${navigated} hit=${verifyHit} errors=${errors.join('|')}`);
  else check(name, navigated && verifyHit === expectPath && /^https:\/\/bharataiinnovation\.com\//.test(where) && !errors.length, `navigated=${navigated} hit=${verifyHit} url=${where} msg="${msg}" errors=${errors.join('|')}`);
  await page.close();
}

await scenario('iPhone (no BarcodeDetector): jsQR reads the pass QR off the camera and opens /verify/<token>', { payload: PASS_QR, native: 'absent', expectPath: '/verify/' + TOKEN });
await scenario('BarcodeDetector present but detect() throws: falls back to jsQR, still opens /verify/<token>', { payload: PASS_QR, native: 'throws', expectPath: '/verify/' + TOKEN });
await scenario('BarcodeDetector present but lists no qr_code: jsQR, still opens /verify/<token>', { payload: PASS_QR, native: 'noformat', expectPath: '/verify/' + TOKEN });
await scenario('BarcodeDetector works (Android Chrome): opens /verify/<token>', { payload: PASS_QR, native: 'works', expectPath: '/verify/' + TOKEN });
await scenario('a hostile QR with /verify/ on another host goes to /verify/ on THIS origin', { payload: 'https://evil.example/verify/9.deadbeefdeadbeefdeadbeef?x=1', native: 'absent', expectPath: '/verify/9.deadbeefdeadbeefdeadbeef' });
await scenario('a QR that is not a pass (plain text) never navigates', { payload: 'hello world, not a pass', native: 'absent', expectNoNav: true });
await scenario('a QR to the app (the old pre-token pass) never navigates', { payload: 'https://bharataiinnovation.com/app', native: 'absent', expectNoNav: true });

await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall scanner page checks passed');
process.exit(fails ? 1 : 0);
