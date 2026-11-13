// "Save the app on your phone" (13 Nov 2026) in real Edge against login-harness.mjs
// (the built worker on real SQLite). The page's clock is pinned to 15 Nov 2026.
// - Android, signed in from the emailed link: the card under the pass, the steps
//   sheet when the browser offers no install box, the browser's own box when it
//   does (accepted: the card goes and "added" is counted), closing the card, the
//   account menu line, no sideways scroll;
// - an iPhone opening "Show me how" signed out: the iPhone steps with the
//   sign-in-once line, and the action gone from the address;
// - the saved app (display-mode standalone): no card, "opened" counted once;
// - an in-app browser: open it in Chrome or Safari, Copy the link;
// - a laptop: no card; "Show me how" says to open it on the phone, both phones' steps.
// Needs login-harness.mjs (HARNESS_PORT, default 8780).
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8780);
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const LINKEDIN = ANDROID.replace('Mobile Safari/537.36', 'Mobile Safari/537.36 [LinkedInApp]');
const EMAIL = 'phone.saver.' + Date.now() + '@example.com';
const PINNED = new Date('2026-11-15T10:00:00+05:30');
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sql = async (s, args = []) => (await post('/__sql', { sql: s, args })).json;
const mail = async () => (await fetch(BASE + '/__mail')).json();
const to = (p) => (p?.Recipients?.To || [])[0] || '';
const body = (p) => p?.Content?.Body?.[0]?.Content || '';
const linkIn = (p) => ((body(p).match(/href="([^"]*token=[0-9a-f]{64}[^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');

(async () => {
  await sql("DELETE FROM attendees WHERE email = ?", [EMAIL]);
  await sql("INSERT INTO attendees (event_id, name, email, mobile, badge_type, payment_status, company) VALUES (1, 'Priya Saver', ?, '9820055501', 'Delegate Pass', 'paid', 'Saver Labs')", [EMAIL]);
  const id = Number(((await sql('SELECT id FROM attendees WHERE email = ?', [EMAIL]))[0] || {}).id || 0);
  const freshLink = async () => {
    await post('/__mail/clear', {});
    await post('/api/events/1/attendees/send-magic-link', { email: EMAIL });
    await sleep(150);
    const p = (await mail()).filter(m => to(m) === EMAIL).pop();
    await sql("UPDATE login_tokens SET created_at = datetime('now', '-3 minutes') WHERE email = ?", [EMAIL]);
    return { href: linkIn(p), html: body(p) };
  };

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const phone = async (ua, opts = {}) => {
    const ctx = await browser.newContext(opts.laptop
      ? { viewport: { width: 1440, height: 1000 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0', serviceWorkers: 'block' }
      : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ua, serviceWorkers: 'block' });
    await ctx.clock.setFixedTime(PINNED);
    if (opts.standalone) {
      await ctx.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q) => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : real(q);
      });
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    return { ctx, page, errors };
  };
  const signedIn = async (page, href) => {
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { const u = JSON.parse(localStorage.getItem('agba_user') || 'null'); return !!(u && u.id); } catch (e) { return false; } }, null, { timeout: 20000 });
    await page.waitForSelector('#pass-card-cta:not(.hidden)', { timeout: 15000 }).catch(() => {});
    await sleep(500);
  };
  const shown = (page, sel) => page.locator(sel).isVisible().catch(() => false);
  const sheet = (page) => page.locator('#app-phone-steps').innerText().catch(() => '');

  // ---- the email that brings them: the block is there and points at the steps ----
  let link = await freshLink();
  check('the sign-in email carries "Save the Bharat AI app on your phone" and Show me how', /Save the Bharat AI app on your phone/.test(link.html) && /action=save-app/.test(link.html), link.html.slice(-600));

  // ---- 1. Android, signed in ----
  let { ctx, page, errors } = await phone(ANDROID);
  await signedIn(page, link.href);
  check('Android: the card shows under the pass', await shown(page, '#app-phone-card'), await page.locator('#app-phone-card').getAttribute('class').catch(() => 'missing'));
  const order = await page.evaluate(() => { const a = document.getElementById('pass-card-cta'), b = document.getElementById('app-phone-card'); return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); });
  check('Android: the card comes after the pass card', order, '');
  const note = (await page.locator('#apc-note').innerText().catch(() => '')).trim();
  check('Android: the card says what it is for', /one tap at the gate/.test(note), note);
  const tapSize = await page.locator('#apc-btn').boundingBox();
  check('Android: Save the app is a 44px target', !!tapSize && tapSize.height >= 44, JSON.stringify(tapSize));
  await sleep(400);
  let seen = await sql("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'home.shown' AND entity_id = ?", [String(id)]);
  check('Android: "saw the card" counted once', Number(seen?.[0]?.n) === 1, JSON.stringify(seen));
  // No install box offered (headless Edge never fires one): the steps.
  await page.locator('#apc-btn').click();
  await page.waitForSelector('#app-phone-steps', { timeout: 5000 }).catch(() => {});
  let s = await sheet(page);
  check('Android: no install box, so the Android steps', /three dots/.test(s) && /Add to Home screen/.test(s) && /Install app/.test(s) && /stay signed in/.test(s) && !/Add to Home Screen, then/.test(s), s.slice(0, 400));
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('Android: no sideways scroll with the sheet open', wide, '');
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Android: Escape closes the sheet', !(await page.locator('#app-phone-steps').count()), '');
  // The browser offers its box: accepted, the card goes and "added" is counted.
  await page.evaluate(() => {
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    ev.prompt = () => Promise.resolve();
    ev.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(ev);
  });
  await page.locator('#apc-btn').click();
  await sleep(700);
  check('Android: the install box accepted: the card is gone', !(await shown(page, '#app-phone-card')), '');
  let added = await sql("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'home.added' AND entity_id = ?", [String(id)]);
  check('Android: "added" counted', Number(added?.[0]?.n) === 1, JSON.stringify(added));
  check('Android: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ---- 2. Android again on a fresh phone: closing the card, the account menu ----
  link = await freshLink();
  ({ ctx, page, errors } = await phone(ANDROID));
  await signedIn(page, link.href);
  await page.locator('#app-phone-card button[aria-label="Close"]').click();
  await sleep(300);
  const hide = await page.evaluate(() => localStorage.getItem('bhai_app_hide'));
  check('closing before 18 Nov hides it for now', !(await shown(page, '#app-phone-card')) && hide === 'later', String(hide));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pass-card-cta:not(.hidden)', { timeout: 15000 }).catch(() => {});
  await sleep(500);
  check('after a reload it stays hidden', !(await shown(page, '#app-phone-card')), '');
  await page.locator('#nav-mobile-me').click().catch(() => {});
  await sleep(400);
  const menu = await page.locator('#account-menu-panel').innerText().catch(() => '');
  check('the account menu has Save the app on my phone', /Save the app on my phone/.test(menu), menu.slice(0, 300));
  await page.getByText('Save the app on my phone').click().catch(() => {});
  await page.waitForSelector('#app-phone-steps', { timeout: 5000 }).catch(() => {});
  check('the account menu line opens the steps', /Add to Home screen/.test(await sheet(page)), '');
  // From 18 Nov it comes back once.
  await ctx.clock.setFixedTime(new Date('2026-11-18T09:00:00+05:30'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pass-card-cta:not(.hidden)', { timeout: 15000 }).catch(() => {});
  await sleep(500);
  check('on 18 Nov the card comes back once', await shown(page, '#app-phone-card'), '');
  await page.locator('#app-phone-card button[aria-label="Close"]').click();
  await sleep(200);
  check('closed on 18 Nov: gone for good', (await page.evaluate(() => localStorage.getItem('bhai_app_hide'))) === 'done', '');
  check('closing and the menu: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ---- 3. An iPhone opens "Show me how" signed out ----
  ({ ctx, page, errors } = await phone(IPHONE));
  await page.goto(BASE + '/app?action=save-app', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app-phone-steps', { timeout: 10000 }).catch(() => {});
  s = await sheet(page);
  check('iPhone: the iPhone steps, signed out', /Safari/.test(s) && /Share/.test(s) && /Add to Home Screen/.test(s) && /6-digit code/.test(s) && /keeps its own sign-in/.test(s) && !/three dots/.test(s), s.slice(0, 400));
  check('iPhone: the action leaves the address', !/action=save-app/.test(page.url()), page.url());
  const done = await page.locator('#aps-done').boundingBox();
  check('iPhone: Done is a 44px target and closes it', !!done && done.height >= 44 && (await page.locator('#aps-done').click().then(() => true, () => false)) && !(await page.locator('#app-phone-steps').count()), JSON.stringify(done));
  check('iPhone: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ---- 4. The saved app (opened from the icon) ----
  link = await freshLink();
  ({ ctx, page, errors } = await phone(ANDROID, { standalone: true }));
  await signedIn(page, link.href);
  await sleep(400);
  check('in the saved app: no card', !(await shown(page, '#app-phone-card')), '');
  let opened = await sql("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'home.opened' AND entity_id = ?", [String(id)]);
  check('in the saved app: "opened from the icon" counted', Number(opened?.[0]?.n) === 1, JSON.stringify(opened));
  await page.goto(BASE + '/app?action=save-app', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  check('in the saved app: Show me how opens nothing', !(await page.locator('#app-phone-steps').count()), '');
  check('saved app: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ---- 5. Inside LinkedIn ----
  ({ ctx, page, errors } = await phone(LINKEDIN));
  await page.goto(BASE + '/app?action=save-app', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app-phone-steps', { timeout: 10000 }).catch(() => {});
  s = await sheet(page);
  check('in-app browser: open it in Chrome or Safari first, with Copy the link', /inside another app/.test(s) && /Open in browser/.test(s) && (await page.locator('#aps-copy').count()) === 1, s.slice(0, 300));
  check('in-app: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ---- 6. A laptop ----
  link = await freshLink();
  ({ ctx, page, errors } = await phone('', { laptop: true }));
  await signedIn(page, link.href);
  check('laptop: no card', !(await shown(page, '#app-phone-card')), '');
  await page.goto(BASE + '/app?action=save-app', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app-phone-steps', { timeout: 10000 }).catch(() => {});
  s = await sheet(page);
  check('laptop: Show me how says to open it on the phone, with both phones', /on your phone, then/.test(s) && /Android/i.test(s) && /iPhone/i.test(s) && /three dots/.test(s) && /Add to Home Screen/.test(s), s.slice(0, 300));
  check('laptop: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('crashed:', e && e.message); process.exit(1); });
