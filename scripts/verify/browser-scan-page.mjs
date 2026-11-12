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
    if (u.pathname === '/api/staff/logout') { seen.logout = (seen.logout || 0) + 1; return route.fulfill({ contentType: 'application/json', body: '{"success":true}' }); }
    if (u.pathname === '/staff') return route.fulfill({ contentType: 'text/html', body: '<title>sign-in stub</title>sign in' });
    if (u.pathname.startsWith('/verify/')) { seen.verify = u.pathname; return route.fulfill({ contentType: 'text/html', body: '<title>verify stub</title>ok' }); }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(({ qrSrc, payload, saved }) => {
    if (saved) localStorage.setItem('desk_roster', JSON.stringify(saved));
    // The buzz is recorded; __blank empties the camera's view (nobody at the desk).
    // The count and sound live in localStorage, which every page of this context shares:
    // each page starts from none, as a fresh phone would.
    window.__buzz = []; window.__camStarts = 0; window.__blank = false;
    if (location.pathname === '/staff/scan') { localStorage.removeItem('desk_count'); localStorage.removeItem('desk_sound'); }
    try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__buzz.push(p); return true; } }); } catch (e) {}
    eval(qrSrc);
    const q = qrcode(0, 'M'); q.addData(payload); q.make();
    const n = q.getModuleCount(), cell = 7, margin = 4, size = (n + 2 * margin) * cell;
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    const paint = () => {
      g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 640, 480);
      const ox = Math.round((640 - size) / 2), oy = Math.round((480 - size) / 2);
      if (!window.__blank) {
        g.fillStyle = '#fff'; g.fillRect(ox, oy, size, size); g.fillStyle = '#000';
        for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(ox + (k + margin) * cell, oy + (r + margin) * cell, cell, cell);
      }
      g.fillStyle = 'rgba(0,0,0,0.01)'; g.fillRect(0, 0, 2, 2);
    };
    paint(); setInterval(paint, 100);
    // A new stream each time, as a phone gives: a camera that was stopped stays stopped.
    navigator.mediaDevices.getUserMedia = async () => { window.__camStarts++; return c.captureStream(10); };
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

// ---- the scanner as an app (12 Nov 2026): the screen, battery, count, sound, home screen ----
const camOn = (page) => page.evaluate(() => { const v = document.getElementById('v'); return !!(v.srcObject && v.srcObject.active); });
const waitFor = async (fn, ms = 6000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await new Promise(r => setTimeout(r, 100)); } return false; };
await fast('the scanner as an app', { reply: { state: 'ok', undoable: true, ...PERSON }, run: async ({ page, seen, cardText, errors }) => {
  const head = await page.evaluate(() => { const a = (s, k) => { const e = document.querySelector(s); return e ? e.getAttribute(k) : null; }; return { manifest: a('link[rel=manifest]', 'href'), touch: a('link[rel=apple-touch-icon]', 'href'), title: a('meta[name=apple-mobile-web-app-title]', 'content'), theme: a('meta[name=theme-color]', 'content'), robots: a('meta[name=robots]', 'content') }; });
  check('the page carries the Badge Desk app: its manifest, icon, name and colour, and stays out of search', head.manifest === '/staff.webmanifest' && head.touch === '/images/icon-desk-192.png' && head.title === 'Badge Desk' && head.theme === '#0a0e1f' && head.robots === 'noindex', JSON.stringify(head));
  let t = await cardText();
  check('a good pass: one short buzz, and it is counted on this phone', /^ok \|/.test(t) && JSON.stringify(await page.evaluate(() => window.__buzz)) === '[70]' && await page.locator('#cnt').innerText() === 'Checked in on this phone today: 1', t + ' buzz=' + JSON.stringify(await page.evaluate(() => window.__buzz)) + ' ' + await page.locator('#cnt').innerText());
  // Undo it; the pass still under the camera is then read again, this time as not valid.
  seen.reply = { state: 'invalid' };
  await page.locator('#card-undo').tap();
  // The old card goes and the pass still under the camera is read again: wait for the new card.
  await waitFor(() => page.evaluate(() => { const d = document.getElementById('card'); return !!d && d.getAttribute('data-state') === 'invalid'; }));
  t = await cardText();
  check('undo takes it off the count; a bad pass buzzes twice, long', seen.undo === 1 && /^invalid \|/.test(t) && await page.locator('#cnt').innerText() === 'Checked in on this phone today: 0' && JSON.stringify((await page.evaluate(() => window.__buzz)).slice(-1)[0]) === '[160,90,160]', t + ' ' + await page.locator('#cnt').innerText() + ' buzz=' + JSON.stringify(await page.evaluate(() => window.__buzz)));
  await page.evaluate(() => { window.__blank = true; });
  await page.locator('#card-next').tap();
  check('the screen says who is signed in and until which day', /^Signed in as Desk One until \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\. Point the camera at the QR/.test(await page.locator('#who').innerText()), await page.locator('#who').innerText());
  const look = await page.evaluate(() => { const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), shown: getComputedStyle(e).display !== 'none' }; }; const aim = document.querySelector('.aim').getBoundingClientRect(), cam = document.getElementById('camBox').getBoundingClientRect(); return { aim: aim.width > 100 && aim.left > cam.left && aim.right < cam.right && aim.top > cam.top && aim.bottom < cam.bottom, torch: r('torch'), snd: r('snd'), net: document.getElementById('net').textContent, wide: document.documentElement.scrollWidth }; });
  check('the camera has an aiming frame inside it, and no light button on a camera without a light', look.aim && !look.torch.shown, JSON.stringify(look));
  check('the status line: Online, and a Sound button big enough to press; nothing wider than the phone', look.net === 'Online' && look.snd.shown && look.snd.h >= 40 && look.wide <= 391, JSON.stringify(look));
  await page.locator('#snd').tap();
  check('Sound off is remembered on the phone', await page.locator('#snd').innerText() === 'Sound off' && await page.evaluate(() => localStorage.getItem('desk_sound')) === 'off' && await page.locator('#snd').getAttribute('aria-pressed') === 'false', await page.locator('#snd').innerText());
  const hint = await page.locator('#a2hs').innerText();
  check('in a browser it says how to put Badge Desk on the home screen, and that the phone stays signed in', /Keep Badge Desk on this phone\./.test(hint) && /three dots/.test(hint) && /Add to Home screen/.test(hint) && /You stay signed in until \d{1,2} [A-Z][a-z]{2}\./.test(hint), hint);

  // Battery: nobody at the desk.
  check('the camera is running, started once', await camOn(page) && await page.evaluate(() => window.__camStarts) === 1, await page.evaluate(() => window.__camStarts));
  await page.evaluate(() => { IDLE_MS = 500; });
  const pausedIdle = await waitFor(() => page.locator('#pz').isVisible());
  check('with no scan and no touch the camera stops by itself and the screen says so', pausedIdle && !(await camOn(page)) && !(await page.locator('#camBox').isVisible()) && /Camera paused to save battery\./.test(await page.locator('#pz').innerText()) && /Tap to scan/.test(await page.locator('#pz').innerText()), await page.locator('#pz').innerText().catch(() => ''));
  await page.evaluate(() => { IDLE_MS = 120000; window.__blank = false; });
  seen.reply = { state: 'ok', undoable: true, ...PERSON };
  await page.locator('#pz-go').tap();
  t = await cardText();
  check('one tap starts it again and the next pass is checked in', /^ok \|/.test(t) && await page.evaluate(() => window.__camStarts) === 2 && await page.locator('#camBox').isVisible() && !(await page.locator('#pz').isVisible()), t + ' starts=' + await page.evaluate(() => window.__camStarts));
  // The card left on screen with nobody there: the camera rests behind it, and wakes with the next tap.
  await page.evaluate(() => { window.__blank = true; IDLE_MS = 500; });
  const pausedBehind = await waitFor(() => page.evaluate(() => document.getElementById('pz').style.display === 'block'));
  await page.evaluate(() => { IDLE_MS = 120000; });
  await page.locator('#card-next').tap();
  check('a result left on screen lets the camera rest, and Scan next pass wakes it', pausedBehind && await waitFor(() => camOn(page)) && await page.evaluate(() => window.__camStarts) === 3, 'paused=' + pausedBehind + ' starts=' + await page.evaluate(() => window.__camStarts));
  // The page leaves the screen (phone locked, another app) and comes back.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const offHidden = await waitFor(async () => !(await camOn(page)));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  check('off the screen the camera stops; back on screen it starts by itself, no tap', offHidden && await waitFor(() => camOn(page)) && await page.evaluate(() => window.__camStarts) === 4 && !(await page.locator('#pz').isVisible()), 'off=' + offHidden + ' starts=' + await page.evaluate(() => window.__camStarts));

  // Signing out with a check-in still waiting.
  await page.evaluate(() => localStorage.setItem('desk_queue', JSON.stringify([{ token: 'x', at: 1 }])));
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.locator('.bar a').tap();
  await new Promise(r => setTimeout(r, 400));
  check('signing out with a check-in not yet sent asks first, and No keeps the desk signed in', /1 check-in is still waiting to be sent from this phone\./.test(asked) && !seen.logout && /\/staff\/scan$/.test(page.url()), asked + ' ' + page.url());
  page.once('dialog', d => d.accept());
  await page.locator('.bar a').tap();
  check('Yes signs out, and the check-in stays on the phone to be sent later', await waitFor(() => /\/staff$/.test(page.url())) && seen.logout === 1 && await page.evaluate(() => JSON.parse(localStorage.getItem('desk_queue') || '[]').length) === 1, page.url() + ' logout=' + seen.logout);
  check('no page errors through all of it', errors.length === 0, errors.join(' | '));
} });

await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall scanner page checks passed');
process.exit(fails ? 1 : 0);
