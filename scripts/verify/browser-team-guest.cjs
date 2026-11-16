// Phone check for "Register guests" (16 Nov 2026, src/routes/team-guests.ts): on an
// emulated Android phone against login-harness.mjs (the real built worker on real SQLite).
// A team member (Organiser pass) signs in from their email, opens the account menu, taps
// Register guests, gives a guest with only a mobile a complimentary VIP Pass, and gets
// "Send on WhatsApp" on the guest's number. Then uploads a .csv of three (one already on
// the list), and works the Send tab: a tap opens WhatsApp (played here) and marks the
// guest sent, Undo puts it back. A laptop gets WhatsApp Web links instead. The guest's
// pass page draws the pass, and its QR decodes to the desk's /verify/<token>. A Visitor
// never sees the menu item. Needs login-harness.mjs (HARNESS_PORT, default 8780).
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8780);
const SHOTS = process.env.SHOTS_DIR || '';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const LAPTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
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

async function signedIn(browser, email, laptop = false) {
  await post('/api/events/1/attendees/send-magic-link', { email });
  await sleep(200);
  const m = (await mail()).filter(p => to(p) === email).pop();
  const href = linkIn(m);
  const ctx = await browser.newContext(laptop
    ? { viewport: { width: 1280, height: 800 }, userAgent: LAPTOP_UA, serviceWorkers: 'block' }
    : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA, serviceWorkers: 'block' });
  // WhatsApp itself is never reached from a test: wa.me and web.whatsapp.com answer here.
  await ctx.route(/^https:\/\/(wa\.me|web\.whatsapp\.com)\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>WhatsApp (played)</title>' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(href || BASE + '/app', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { const u = JSON.parse(localStorage.getItem('agba_user') || 'null'); return !!(u && u.id); } catch (e) { return false; } }, null, { timeout: 20000 }).catch(() => {});
  await sleep(1200);
  return { ctx, page, errors, href };
}
async function openMenu(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => { if (typeof toggleAccountMenu === 'function') toggleAccountMenu(); });
  await sleep(400);
  return (await page.locator('#account-menu-panel').innerText().catch(() => '')) || '';
}
const tabText = (page, key) => page.locator('.tg-tab[data-tab="' + key + '"]').innerText().catch(() => '');

(async () => {
  await sql("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event, registration_source, mobile, company, job_title, city) VALUES (108, 1, 'Anita Ram', 'anita.r@bharataiinnovation.com', 'Organiser', 'waived', 1, 'admin', '9800000108', 'Bharat AI Innovation', 'Organiser', 'Mumbai')");
  await sql("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event, registration_source, mobile, company, job_title, city) VALUES (501, 1, 'Asha Rao', 'asha@example.com', 'Visitor Pass', 'paid', 1, 'website', '9820012345', 'Rao Labs', 'Founder', 'Pune')");
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ---- a Visitor does not get it ----
  const v = await signedIn(browser, 'asha@example.com');
  const vMenu = await openMenu(v.page);
  check('a Visitor\'s account menu has no "Register guests"', vMenu.includes('My pass') && !vMenu.includes('Register guests'), vMenu.slice(0, 200));
  await v.ctx.close();

  // ---- the team member: one guest ----
  const t = await signedIn(browser, 'anita.r@bharataiinnovation.com');
  const { page } = t;
  const menu = await openMenu(page);
  check('the team member\'s account menu has "Register guests"', menu.includes('Register guests') && menu.includes('Send the passes on WhatsApp'), menu.slice(0, 300) + ' ' + t.errors.join(' | '));
  await shot(page, 'tg-1-menu');
  await page.getByRole('button', { name: /Register guests/ }).click();
  await page.waitForSelector('#tg-form', { timeout: 10000 });
  await sleep(300);
  await shot(page, 'tg-2-form');
  const box = await page.evaluate(() => {
    const s = document.querySelector('.tg-sheet').getBoundingClientRect();
    return { w: s.width, sx: document.documentElement.scrollWidth, vw: window.innerWidth,
      inputs: [...document.querySelectorAll('.tg-in')].map(i => ({ h: i.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(i).fontSize) })),
      tabs: [...document.querySelectorAll('.tg-tab')].map(b => b.textContent.trim()) };
  });
  check('the sheet fits a 390 px phone, no sideways scroll, three tabs', box.w <= 390 && box.sx <= box.vw && box.tabs.length === 3 && box.tabs[1] === 'Upload a list', JSON.stringify(box));
  check('every box is at least 44 px tall with 16 px type (no zoom on iPhone)', box.inputs.length === 5 && box.inputs.every(i => i.h >= 44 && i.fs >= 16), JSON.stringify(box.inputs));

  await page.fill('#tg-name', 'Dr. Kavita Shah');
  await page.fill('#tg-mobile', '98765');
  await page.click('#tg-go');
  await sleep(300);
  const bad = await page.locator('#tg-mobile-bad').innerText().catch(() => '');
  check('a short number is caught at the box, with the words kept', /mobile number/.test(bad) && (await page.inputValue('#tg-name')) === 'Dr. Kavita Shah', bad);

  await page.fill('#tg-mobile', '91234 56789');
  await page.locator('#tg-form label.tg-pass', { hasText: 'VIP Pass' }).click();
  await page.fill('#tg-company', 'Shah Labs');
  await page.click('#tg-go');
  await page.waitForSelector('.tg-wa[data-send]', { timeout: 10000 }).catch(() => {});
  await sleep(400);
  await shot(page, 'tg-3-done');
  const done = await page.evaluate(() => ({
    head: (document.querySelector('.tg-done h3') || {}).textContent || '',
    line: (document.querySelector('.tg-done p') || {}).textContent || '',
    wa: (document.querySelector('.tg-wa[data-send]') || {}).href || '',
    waText: (document.querySelector('.tg-wa[data-send]') || {}).textContent || '',
    pass: ([...document.querySelectorAll('.tg-sec')].find(a => /Open the pass/.test(a.textContent)) || {}).href || '',
  }));
  check('"Pass ready for Dr. Kavita Shah", VIP Pass, the number', done.head === 'Pass ready for Dr. Kavita Shah' && done.line.includes('VIP Pass') && done.line.includes('+91 91234 56789'), JSON.stringify(done));
  check('on a phone, "Send on WhatsApp" opens WhatsApp on her number with the message', /Send on WhatsApp/.test(done.waText) && done.wa.startsWith('https://wa.me/919123456789?text=') && decodeURIComponent(done.wa.split('text=')[1]).startsWith('Hello Dr. Shah,'), done.wa.slice(0, 120));
  check('the Send tab counts her', /1 to send/.test(await tabText(page, 'send')), await tabText(page, 'send'));
  const row = (await sql("SELECT badge_type, payment_status, email FROM attendees WHERE name = 'Dr. Kavita Shah'"))[0];
  check('the row is a complimentary VIP Pass with the stand-in address', row && row.badge_type === 'VIP Pass' && row.payment_status === 'waived' && row.email === 'wa919123456789@no-email.invalid', JSON.stringify(row));

  // ---- a sheet of guests ----
  await page.click('.tg-tab[data-tab="list"]');
  await page.waitForSelector('#tg-file', { timeout: 5000 });
  const csv = 'Name,Mobile No.,Pass,Organisation\r\nPriya Nair,98200 55555,,Nair Foods\r\nSunil Rao,+91 98200 66666,VIP,"Rao & Co, Pune"\r\nKavita Dup,9123456789,,\r\n';
  await page.setInputFiles('#tg-file', { name: 'guests.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.waitForSelector('#tg-upload', { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await shot(page, 'tg-4-sheet');
  const prev = await page.evaluate(() => ({
    sum: (document.querySelector('.tg-sum') || {}).textContent || '',
    cells: [...document.querySelectorAll('.tg-table tbody td')].map(td => td.textContent.trim()),
    btn: (document.getElementById('tg-upload') || {}).textContent || '',
  }));
  check('the sheet is read on the phone: 3 rows, names and numbers shown, "Register 3 guests"', /3 rows/.test(prev.sum) && prev.cells.includes('Priya Nair') && prev.cells.includes('Rao & Co, Pune') === false && prev.cells.includes('+91 98200 66666') && prev.btn === 'Register 3 guests', JSON.stringify(prev));
  await page.locator('#tg-sheetform label.tg-pass', { hasText: 'Delegate Pass' }).click();
  await page.click('#tg-upload');
  await page.waitForSelector('#tg-tosend', { timeout: 10000 }).catch(() => {});
  await sleep(300);
  await shot(page, 'tg-5-uploaded');
  const up = await page.evaluate(() => ({
    head: (document.querySelector('.tg-done h3') || {}).textContent || '',
    line: (document.querySelector('.tg-done p') || {}).textContent || '',
    trouble: [...document.querySelectorAll('.tg-table tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim()),
  }));
  check('"2 guests registered", 1 already on the list, named', up.head === '2 guests registered' && /1 already on the list/.test(up.line) && up.trouble.length === 1 && /Kavita Dup/.test(up.trouble[0]) && /already registered as Dr\. Kavita Shah/.test(up.trouble[0]), JSON.stringify(up));
  const rows = await sql("SELECT name, badge_type, payment_status, company FROM attendees WHERE registration_source = 'team:108' ORDER BY id");
  check('Priya a Delegate (the sheet\'s default), Sunil a VIP, the organisation with its comma', rows.length === 3 && rows[1].name === 'Priya Nair' && rows[1].badge_type === 'Delegate Pass' && rows[1].payment_status === 'waived' && rows[2].badge_type === 'VIP Pass' && rows[2].company === 'Rao & Co, Pune', JSON.stringify(rows));

  // ---- the Send tab ----
  await page.click('#tg-tosend');
  await sleep(500);
  await shot(page, 'tg-6-send');
  const q1 = await page.evaluate(() => ({
    next: (document.querySelector('.tg-next p') || {}).textContent || '',
    chips: [...document.querySelectorAll('.tg-chip')].map(b => b.textContent.trim()),
    rows: [...document.querySelectorAll('.tg-g b')].map(b => b.textContent.trim()),
  }));
  check('"Next" is the newest guest; To send (3); all three listed', /Next:/.test(q1.next) && q1.chips[0] === 'To send (3)' && q1.rows.length === 3, JSON.stringify(q1));
  const popup = page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
  await page.click('.tg-next .tg-wa[data-send]');
  const pop = await popup;
  // A new tab starts blank; its address is WhatsApp's only once it has gone there.
  if (pop) await pop.waitForURL(/wa\.me|web\.whatsapp\.com/, { timeout: 8000 }).catch(() => {});
  const popUrl = pop ? pop.url() : '';
  if (pop) await pop.close().catch(() => {});
  await sleep(700);
  await shot(page, 'tg-7-sent');
  const q2 = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.tg-chip')].map(b => b.textContent.trim()),
    next: (document.querySelector('.tg-next p') || {}).textContent || '',
  }));
  check('the tap opened WhatsApp on that number and marked the guest sent: To send (2), Next moves on', popUrl.startsWith('https://wa.me/') && q2.chips[0] === 'To send (2)' && q2.chips[1] === 'Sent (1)' && q2.next !== q1.next, JSON.stringify({ popUrl: popUrl.slice(0, 60), q2 }));
  const marks = await sql("SELECT action, actor FROM admin_audit WHERE action IN ('team.guest.sent', 'team.guest.unsent') ORDER BY id");
  check('it is recorded in Anita\'s name', marks.length === 1 && marks[0].action === 'team.guest.sent' && marks[0].actor === 'Anita Ram', JSON.stringify(marks));
  await page.click('.tg-chip[data-filter="sent"]');
  await sleep(200);
  const sentRow = await page.locator('.tg-g .sent').innerText().catch(() => '');
  check('under Sent: the time, and "Not sent? Undo"', /Sent /.test(sentRow) && /Undo/.test(sentRow), sentRow);
  await page.click('.tg-g [data-unsend]');
  await sleep(500);
  const q3 = await page.evaluate(() => [...document.querySelectorAll('.tg-chip')].map(b => b.textContent.trim()));
  check('Undo: To send (3) again', q3[0] === 'To send (3)' && q3[1] === 'Sent (0)', JSON.stringify(q3));
  check('no errors on the page', t.errors.length === 0, t.errors.join(' | '));
  await t.ctx.close();

  // ---- a laptop gets WhatsApp Web ----
  const l = await signedIn(browser, 'anita.r@bharataiinnovation.com', true);
  await openMenu(l.page);
  await l.page.getByRole('button', { name: /Register guests/ }).click();
  await l.page.waitForSelector('#tg-form', { timeout: 10000 });
  await l.page.click('.tg-tab[data-tab="send"]');
  await sleep(600);
  await shot(l.page, 'tg-8-laptop');
  const lap = await l.page.evaluate(() => ({
    href: (document.querySelector('.tg-next .tg-wa[data-send]') || {}).href || '',
    text: (document.querySelector('.tg-next .tg-wa[data-send]') || {}).textContent || '',
    lead: (document.querySelector('.tg-lead') || {}).textContent || '',
  }));
  check('on a laptop the button opens WhatsApp Web on the number, and says to link the phone', lap.href.startsWith('https://web.whatsapp.com/send?phone=91') && /WhatsApp Web/.test(lap.text) && /Linked devices/.test(lap.lead), JSON.stringify(lap).slice(0, 300));
  check('no errors on the laptop', l.errors.length === 0, l.errors.join(' | '));
  await l.ctx.close();

  // ---- the guest opens the link on their phone ----
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA, serviceWorkers: 'block' });
  const g = await ctx.newPage();
  const gErr = [];
  g.on('pageerror', e => gErr.push(e.message));
  const local = done.pass.replace('https://bharataiinnovation.com', BASE);
  await g.goto(local, { waitUntil: 'load' });
  await g.waitForSelector('#gp-img:not([hidden])', { timeout: 20000 }).catch(() => {});
  await sleep(300);
  await shot(g, 'tg-9-pass');
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
