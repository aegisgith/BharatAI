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
// serviceWorkers 'block': the scan page registers /sw.js (2 Nov 2026), and the script
// request is not seen by page.route, so it would install the PRODUCTION worker and
// send later pages to the live site.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

async function scenario(name, { payload, native, expectPath, expectNoNav, offline }) {
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
  await page.addInitScript(({ qrSrc, payload, native, offline }) => {
    // A phone that knows it has no signal (2 Nov 2026).
    if (offline) Object.defineProperty(navigator, 'onLine', { get: () => false });
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
  }, { qrSrc, payload, native, offline });
  await page.goto('https://bharataiinnovation.com/staff/scan', { waitUntil: 'domcontentloaded' });
  let navigated = false;
  try { await page.waitForURL(/\/verify\//, { timeout: 8000 }); navigated = true; } catch (e) { /* no navigation */ }
  const where = page.url();
  const msg = navigated ? '' : await page.evaluate(() => (document.getElementById('e') || {}).textContent || '');
  if (offline) {
    const red = await page.evaluate(() => { const d = document.getElementById('desk-offline'); return d ? d.innerText : ''; });
    check(name, !navigated && verifyHit === null && /This pass was NOT checked/.test(red) && /Scan again/.test(red) && !errors.length, `navigated=${navigated} hit=${verifyHit} red="${red.slice(0, 80)}" errors=${errors.join('|')}`);
  } else if (expectNoNav) check(name, !navigated && verifyHit === null && !errors.length, `navigated=${navigated} hit=${verifyHit} errors=${errors.join('|')}`);
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
await scenario('a phone with no signal says the pass was NOT checked, in red, and opens nothing', { payload: PASS_QR, native: 'absent', offline: true });

// ---- check in on scan, and the desk without internet (11 Nov 2026) ----
// The same page with the scanner's own call answered (POST /api/staff/scan): the
// answer is a card over the camera, which keeps running. `reply` is what the server
// says, or 'down' for a call that never arrives; `saved` is the list a phone keeps for
// working offline, put in its storage as an earlier visit would have left it.
import crypto from 'node:crypto';
const sha10 = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 10);
async function fast(name, { reply, saved, run }) {
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const seen = { scans: [], undo: 0, verify: null, reply };
  await page.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname === '/staff/scan') {
      const r = await worker.fetch(new Request('https://bharataiinnovation.com/staff/scan', { headers: { Cookie: staffCookie(SECRET, 1) } }), env, ctxw);
      return route.fulfill({ status: r.status, contentType: 'text/html; charset=utf-8', body: await r.text() });
    }
    if (u.pathname.startsWith('/js/')) return route.fulfill({ contentType: 'application/javascript', body: readFileSync(new URL('public' + u.pathname, ROOT), 'utf8') });
    if (u.pathname === '/api/staff/scan') {
      if (seen.reply === 'down') return route.abort('internetdisconnected');
      seen.scans.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(seen.reply) });
    }
    if (u.pathname === '/api/staff/roster') return seen.reply === 'down' ? route.abort('internetdisconnected') : route.fulfill({ status: 404, body: '' });
    if (/^\/api\/verify\/.+\/undo$/.test(u.pathname)) { seen.undo++; return route.fulfill({ contentType: 'application/json', body: '{"success":true}' }); }
    if (u.pathname.startsWith('/verify/')) { seen.verify = u.pathname; return route.fulfill({ contentType: 'text/html', body: '<title>verify stub</title>ok' }); }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(({ qrSrc, payload, saved }) => {
    if (saved) localStorage.setItem('desk_roster', JSON.stringify(saved));
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
    delete window.BarcodeDetector;
  }, { qrSrc, payload: PASS_QR, saved: saved || null });
  await page.goto('https://bharataiinnovation.com/staff/scan', { waitUntil: 'domcontentloaded' });
  const cardText = async (ms = 9000) => { try { await page.waitForSelector('#card', { timeout: ms }); } catch { return ''; } return page.evaluate(() => { const d = document.getElementById('card'); return d.getAttribute('data-state') + ' | ' + d.innerText.replace(/\s+/g, ' '); }); };
  try { await run({ page, seen, cardText, errors }); }
  catch (e) { check(name, false, 'crashed: ' + e.message.split('\n')[0]); }
  await page.close();
}
const PERSON = { name: 'Asha Rao', company: 'Infosys', job_title: 'Director', pass: 'Delegate Pass', photo: '' };

await fast('check in on scan', { reply: { state: 'ok', undoable: true, earlier: ['20 Nov'], ...PERSON }, run: async ({ page, seen, cardText, errors }) => {
  const t = await cardText();
  check('a scan checks the person in: a green card over the camera, no page change', /^ok \| CHECKED IN Asha Rao Director, Infosys Delegate Pass/.test(t) && /No photo on file\. Check the NAME on a government photo ID\./.test(t) && /Also came on 20 Nov\./.test(t) && seen.verify === null && seen.scans.length === 1 && seen.scans[0].token === TOKEN && !errors.length, t + ' scans=' + seen.scans.length + ' errors=' + errors.join('|'));
  check('the card offers Scan next pass, Undo and the full details', /Scan next pass/.test(t) && /Undo this check-in/.test(t) && await page.locator('#card a').getAttribute('href') === '/verify/' + TOKEN, t);
  await page.waitForTimeout(1500);
  check('while the card is up, the pass still in front of the camera is not scanned again', seen.scans.length === 1, seen.scans.length);
  await page.locator('#card-next').tap();
  const gone = await page.locator('#card').count() === 0;
  const live = await page.evaluate(() => { const v = document.getElementById('v'); return !!(v.srcObject && v.srcObject.active); });
  check('Scan next pass clears the card and the camera is still running', gone && live, 'gone=' + gone + ' live=' + live);
  const again = await cardText(9000);
  check('and the next scan works without reloading the page', /^ok \|/.test(again) && seen.scans.length === 2 && !errors.length, again + ' scans=' + seen.scans.length);
} });

await fast('already today, and undo', { reply: { state: 'already', at_ist: '20 Nov 2026, 10:00 am IST', by: 'Desk Two', undoable: true, earlier: [], ...PERSON, photo: '/img/face.jpg' }, run: async ({ page, seen, cardText }) => {
  const t = await cardText();
  check('someone already admitted today: an amber card with the time and the desk', /^already \| ALREADY CHECKED IN TODAY Asha Rao/.test(t) && /20 Nov 2026, 10:00 am IST by Desk Two\./.test(t), t);
  check('a photo on file is shown on the card', await page.locator('#card img').getAttribute('src') === '/img/face.jpg', '');
  await page.locator('#card-undo').tap();
  await page.waitForFunction(() => !document.getElementById('card'), null, { timeout: 5000 }).catch(() => {});
  check('Undo takes the check-in back and says so', seen.undo === 1 && await page.locator('#card').count() === 0 && /undone/.test(await page.locator('#e').innerText()), 'undo=' + seen.undo);
} });

await fast('payment pending', { reply: { state: 'payment_pending', ...PERSON, pass: 'VIP Pass' }, run: async ({ cardText }) => {
  const t = await cardText();
  check('an unpaid tier: an amber card that says do not admit, with no Undo', /^payment_pending \| PAYMENT PENDING Asha Rao/.test(t) && /Do not admit without checking/.test(t) && !/Undo/.test(t), t);
} });

await fast('not a pass', { reply: { state: 'invalid' }, run: async ({ cardText }) => {
  const t = await cardText();
  check('a forged pass: a red NOT VALID card', /^invalid \| NOT VALID/.test(t) && !/Undo/.test(t), t);
} });

await fast('no internet, with the saved list', { reply: 'down', saved: { day: '2026-11-20', people: [[12345, 'Asha Rao', 'Delegate Pass', 0, sha10(TOKEN)]] }, run: async ({ page, seen, cardText, errors }) => {
  const t = await cardText();
  check('no internet: the saved list recognises the pass and says whose it is', /^offline \| VALID PASS \(NO INTERNET\) Asha Rao Delegate Pass/.test(t) && /saved on this phone/.test(t) && seen.verify === null && !errors.length, t + ' errors=' + errors.join('|'));
  const q1 = await page.evaluate(() => JSON.parse(localStorage.getItem('desk_queue') || '[]'));
  check('the check-in waits on the phone, with its time', q1.length === 1 && q1[0].token === TOKEN && Math.abs(q1[0].at - Date.now()) < 60000, q1);
  await page.locator('#card-next').tap();
  check('the page says how many are waiting', /1 check-in saved on this phone, waiting for the internet\./.test(await page.locator('#qn').innerText()), await page.locator('#qn').innerText());
  // The connection returns.
  seen.reply = { state: 'ok', ...PERSON };
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('desk_queue') || '[]').length === 0, null, { timeout: 8000 }).catch(() => {});
  const q2 = await page.evaluate(() => JSON.parse(localStorage.getItem('desk_queue') || '[]'));
  const sentLate = seen.scans.find(s => s.at);
  check('when the internet returns the saved check-in is sent, with the time it was made', q2.length === 0 && !!sentLate && sentLate.token === TOKEN && sentLate.at === q1[0].at, { q2, scans: seen.scans });
} });

await fast('no internet, a pass the saved list does not vouch for', { reply: 'down', saved: { day: '2026-11-20', people: [[12345, 'Asha Rao', 'Delegate Pass', 0, 'ffffffffff'], [777, 'Una Unpaid', 'VIP Pass', 1, 'x']] }, run: async ({ page, cardText }) => {
  const t = await cardText();
  check('no internet and a made-up signature: NOT VALID, nothing saved', /^invalid \| NOT VALID/.test(t) && (await page.evaluate(() => JSON.parse(localStorage.getItem('desk_queue') || '[]'))).length === 0, t);
} });

await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall scanner page checks passed');
process.exit(fails ? 1 : 0);
