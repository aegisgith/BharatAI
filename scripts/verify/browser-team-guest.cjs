// Phone check for "Register a guest" (16 Nov 2026, src/routes/team-guests.ts): on an
// emulated Android phone against login-harness.mjs (the real built worker on real SQLite).
// A team member (Organiser pass) signs in from their email, opens the account menu, taps
// Register a guest, gives a guest with only a mobile a complimentary VIP Pass, and gets
// "Send on WhatsApp" on the guest's number. The guest's pass page then draws the pass,
// and its QR decodes to the desk's /verify/<token>. A Visitor never sees the menu item.
// Needs login-harness.mjs (HARNESS_PORT, default 8780).
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8780);
const SHOTS = process.env.SHOTS_DIR || '';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sql = async (s, args = []) => (await post('/__sql', { sql: s, args })).json;
const mail = async () => (await fetch(BASE + '/__mail')).json();
const to = (p) => (p?.Recipients?.To || [])[0] || '';
const body = (p) => p?.Content?.Body?.[0]?.Content || '';
const linkIn = (p) => ((body(p).match(/href="([^"]*token=[0-9a-f]{64}[^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');
const shot = (page, name) => SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: false }).catch(() => {}) : null;

async function signedInPhone(browser, email) {
  await post('/api/events/1/attendees/send-magic-link', { email });
  await sleep(200);
  const m = (await mail()).filter(p => to(p) === email).pop();
  const href = linkIn(m);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(href || BASE + '/app', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { const u = JSON.parse(localStorage.getItem('agba_user') || 'null'); return !!(u && u.id); } catch (e) { return false; } }, null, { timeout: 20000 }).catch(() => {});
  await sleep(1200);
  return { ctx, page, errors, href };
}

async function openMenu(page) {
  // Whatever the app put up on arrival (a welcome sheet, a prompt) is closed first.
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => { if (typeof toggleAccountMenu === 'function') toggleAccountMenu(); });
  await sleep(400);
  return (await page.locator('#account-menu-panel').innerText().catch(() => '')) || '';
}

(async () => {
  await sql("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event, registration_source, mobile, company, job_title, city) VALUES (108, 1, 'Anita Ram', 'anita.r@bharataiinnovation.com', 'Organiser', 'waived', 1, 'admin', '9800000108', 'Bharat AI Innovation', 'Organiser', 'Mumbai')");
  await sql("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event, registration_source, mobile, company, job_title, city) VALUES (501, 1, 'Asha Rao', 'asha@example.com', 'Visitor Pass', 'paid', 1, 'website', '9820012345', 'Rao Labs', 'Founder', 'Pune')");
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ---- a Visitor does not get it ----
  const v = await signedInPhone(browser, 'asha@example.com');
  const vMenu = await openMenu(v.page);
  check('a Visitor\'s account menu has no "Register a guest"', vMenu.includes('My pass') && !vMenu.includes('Register a guest'), vMenu.slice(0, 200));
  await v.ctx.close();

  // ---- the team member ----
  const t = await signedInPhone(browser, 'anita.r@bharataiinnovation.com');
  const { page } = t;
  const menu = await openMenu(page);
  check('the team member\'s account menu has "Register a guest"', menu.includes('Register a guest') && menu.includes('Send the pass on WhatsApp'), menu.slice(0, 300) + ' ' + t.errors.join(' | '));
  await shot(page, 'tg-1-menu');
  await page.getByRole('button', { name: /Register a guest/ }).click();
  await page.waitForSelector('#tg-form', { timeout: 10000 });
  await sleep(300);
  await shot(page, 'tg-2-form');
  const box = await page.evaluate(() => {
    const s = document.querySelector('.tg-sheet').getBoundingClientRect();
    return { w: s.width, sx: document.documentElement.scrollWidth, vw: window.innerWidth,
      inputs: [...document.querySelectorAll('.tg-in')].map(i => ({ h: i.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(i).fontSize) })) };
  });
  check('the sheet fits a 390 px phone, no sideways scroll', box.w <= 390 && box.sx <= box.vw, JSON.stringify(box));
  check('every box is at least 44 px tall with 16 px type (no zoom on iPhone)', box.inputs.length === 5 && box.inputs.every(i => i.h >= 44 && i.fs >= 16), JSON.stringify(box.inputs));

  // A mistake first: the number is short.
  await page.fill('#tg-name', 'Dr. Kavita Shah');
  await page.fill('#tg-mobile', '98765');
  await page.click('#tg-go');
  await sleep(300);
  const bad = await page.locator('#tg-mobile-bad').innerText().catch(() => '');
  check('a short number is caught at the box, with the words kept', /mobile number/.test(bad) && (await page.inputValue('#tg-name')) === 'Dr. Kavita Shah', bad);

  await page.fill('#tg-mobile', '91234 56789');
  await page.locator('label.tg-pass', { hasText: 'VIP Pass' }).click();
  await page.fill('#tg-company', 'Shah Labs');
  await page.click('#tg-go');
  await page.waitForSelector('#tg-wa', { timeout: 10000 }).catch(() => {});
  await sleep(300);
  await shot(page, 'tg-3-done');
  const done = await page.evaluate(() => ({
    head: (document.querySelector('.tg-done h3') || {}).textContent || '',
    line: (document.querySelector('.tg-done p') || {}).textContent || '',
    wa: (document.getElementById('tg-wa') || {}).href || '',
    pass: ([...document.querySelectorAll('.tg-sec')].find(a => /Open the pass/.test(a.textContent)) || {}).href || '',
    list: (document.querySelector('.tg-list') || {}).textContent || '',
  }));
  check('"Pass ready for Dr. Kavita Shah", VIP Pass, the number', done.head === 'Pass ready for Dr. Kavita Shah' && done.line.includes('VIP Pass') && done.line.includes('+91 91234 56789'), JSON.stringify(done));
  check('"Send on WhatsApp" opens WhatsApp on her number with the message', done.wa.startsWith('https://wa.me/919123456789?text=') && decodeURIComponent(done.wa.split('text=')[1]).startsWith('Hello Dr. Shah,'), done.wa.slice(0, 120));
  check('she is in "Guests you registered"', /Guests you registered \(1\)/.test(done.list) && done.list.includes('Dr. Kavita Shah'), done.list);
  const row = (await sql("SELECT badge_type, payment_status, email FROM attendees WHERE name = 'Dr. Kavita Shah'"))[0];
  check('the row is a complimentary VIP Pass with the stand-in address', row && row.badge_type === 'VIP Pass' && row.payment_status === 'waived' && row.email === 'wa919123456789@no-email.invalid', JSON.stringify(row));
  check('no errors on the page', t.errors.length === 0, t.errors.join(' | '));
  await t.ctx.close();

  // ---- the guest opens the link on their phone ----
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA, serviceWorkers: 'block' });
  const g = await ctx.newPage();
  const gErr = [];
  g.on('pageerror', e => gErr.push(e.message));
  const local = done.pass.replace('https://bharataiinnovation.com', BASE);
  await g.goto(local, { waitUntil: 'load' });
  await g.waitForSelector('#gp-img:not([hidden])', { timeout: 20000 }).catch(() => {});
  await sleep(300);
  await shot(g, 'tg-4-pass');
  const pg = await g.evaluate(() => ({
    title: (document.querySelector('.gp-title') || {}).textContent || '',
    img: !!(document.getElementById('gp-img') && !document.getElementById('gp-img').hidden && document.getElementById('gp-img').naturalWidth > 0),
    btn: !!(document.getElementById('gp-save') && !document.getElementById('gp-save').hidden),
    sx: document.documentElement.scrollWidth, vw: window.innerWidth,
    w: (document.getElementById('gp-img') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width,
  }));
  check('the guest\'s page draws the pass, with "Save the picture"', pg.title === 'Your pass, Dr. Shah' && pg.img && pg.btn, JSON.stringify(pg) + ' ' + gErr.join(' | '));
  check('the pass fills the phone without sideways scroll', pg.sx <= pg.vw && pg.w >= 300, JSON.stringify(pg));
  await g.addScriptTag({ url: BASE + '/js/vendor/jsQR.js' });
  const qr = await g.evaluate(async () => {
    const im = document.getElementById('gp-img');
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const r = window.jsQR(d.data, c.width, c.height);
    return r ? r.data : '';
  });
  const token = done.pass.split('/pass/')[1];
  check('its QR reads as the desk\'s /verify/<token>', qr === 'https://bharataiinnovation.com/verify/' + token, qr);
  const dl = g.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await g.click('#gp-save');
  const file = await dl;
  check('"Save the picture" saves a PNG named after the pass', !!file && /^BHAI-2026-VIP-Dr-Kavita-Shah\.png$/.test(file.suggestedFilename()), file ? file.suggestedFilename() : 'no download');
  check('no errors on the guest\'s page', gErr.length === 0, gErr.join(' | '));
  await ctx.close();
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nAll team-guest phone checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
