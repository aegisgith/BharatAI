// Phone check for Visitor passes on the exhibitor dashboard (19 Nov 2026, src/routes/team-guests.ts,
// public/static/team-guest.js opened for an exhibitor). The booth contact signs in on a phone,
// opens Visitor passes from the folded menu, types one visitor (no pass to choose: a Visitor
// Pass), gets the WhatsApp and email buttons, uploads a CSV and then an Excel sheet, closes
// the sheet and sees the count go up; nothing wider than the screen, no page errors.
// Needs team-harness.mjs (HARNESS_PORT, default 8851). Started by run-all.mjs.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('./playwright.cjs');
// The vendored SheetJS is a browser script (a top-level var XLSX): run it in a sandbox.
const XLSX = (() => { const box = {}; require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'vendor', 'xlsx.full.min.js'), 'utf8') + ';this.XLSX = XLSX;', box); return box.XLSX; })();
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8851);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(200); } return false; };
const hmac = (m) => crypto.createHmac('sha256', 'h-mp').update(m).digest('hex');
const signInLink = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const fp = hmac('mplink-pw:').slice(0, 16); return `/marketplace/signin?t=${id}.${exp}.${fp}.${hmac(`mplink:${id}.${exp}.${fp}`)}&go=team`; };
const openMenuItem = async (pg, sel) => {
  await sleep(500);
  const inView = await pg.locator(sel).evaluate(e => { const r = e.getBoundingClientRect(); return r.right > 4 && r.left < innerWidth - 4; });
  if (!inView) { await pg.locator('#dash-sidebar-toggle').click(); await sleep(450); }
  await pg.locator(sel).click();
};

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/payments/config')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exg-'));
  const csv = path.join(dir, 'visitors.csv');
  fs.writeFileSync(csv, 'Name,Mobile,Company,Email ID\r\n"Shah, Sunil",9000000011,Shah Steel,\r\nKiran Rao,+91 90000 00012,,kiran@rao.in\r\n');
  const xlsx = path.join(dir, 'visitors.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Full Name', 'Mobile No.', 'Organisation'], ['Neha Joshi', '9000000013', 'Joshi Labs'], ['Arjun Das', '9000000014', '']]), 'Sheet1');
  fs.writeFileSync(xlsx, Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const noSideScroll = async (where) => {
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      check('nothing wider than the screen on ' + where, w <= 391, 'scrollWidth ' + w);
    };

    await page.goto(BASE + signInLink(1));
    await until(() => page.locator('#section-team').isVisible());
    check('the menu has Visitor passes for an exhibitor', await until(async () => !(await page.locator('#dash-nav-guests').getAttribute('class')).includes('hidden')), '');
    await openMenuItem(page, '#dash-nav-guests');
    const card = page.locator('#guests-card');
    check('Visitor passes opens: the booth and the count', await until(() => card.isVisible()) && /Booth 21/.test(await card.innerText()) && /0 of 100 Visitor Passes given/.test(await card.innerText()), await card.innerText().catch(() => ''));
    await noSideScroll('Visitor passes');

    // ---- one person ----
    await card.getByRole('button', { name: /Add one person/ }).click();
    const sheet = page.locator('.tg-sheet');
    check('the sheet opens as "Invite visitors" with a Visitor Pass and nothing to choose', await until(() => sheet.isVisible()) && (await page.locator('#tg-title').innerText()) === 'Invite visitors'
      && await page.locator('.tg-fixed').count() === 1 && await page.locator('input[name="pass"]').count() === 0 && /100 more Visitor Passes/.test(await sheet.innerText()), await sheet.innerText().catch(() => ''));
    await page.locator('#tg-name').fill('Meera Iyer');
    await page.locator('#tg-mobile').fill('98765 43210');
    await page.locator('#tg-email').fill('meera@iyer.in');
    await page.locator('#tg-go').click();
    check('the pass is made, with WhatsApp and Send by email', await until(() => page.locator('.tg-done').isVisible()) && /Pass ready for Meera Iyer/.test(await page.locator('.tg-done').innerText())
      && (await page.locator('.tg-wa').getAttribute('href')).startsWith('https://wa.me/919876543210?text=') && (await sheet.getByRole('link', { name: 'Send by email' }).getAttribute('href')).startsWith('mailto:meera%40iyer.in?'), await sheet.innerText().catch(() => ''));
    check('the button below says Invite another visitor', (await page.locator('#tg-again').innerText()) === 'Invite another visitor');

    // ---- a CSV, then an Excel sheet ----
    await sheet.getByRole('tab', { name: /Upload a list/ }).click();
    check('the upload says every guest gets a Visitor Pass, and the blank sheet is the exhibitor\'s', /Everyone on it gets a free Visitor Pass/.test(await sheet.innerText()) && (await sheet.getByRole('link', { name: 'Download a blank one' }).getAttribute('href')) === '/api/mp/dashboard/guests/template.csv', '');
    await page.locator('#tg-file').setInputFiles(csv);
    check('the CSV preview: two rows, no Pass column', await until(() => page.locator('#tg-upload').isVisible()) && /Register 2 guests/.test(await page.locator('#tg-upload').innerText()) && await sheet.locator('th', { hasText: 'Pass' }).count() === 0 && /Shah, Sunil/.test(await sheet.innerText()), await sheet.innerText().catch(() => ''));
    await page.locator('#tg-upload').click();
    check('the CSV registers both', await until(async () => /2 guests registered/.test(await sheet.innerText())), await sheet.innerText().catch(() => ''));
    await page.locator('#tg-file').setInputFiles(xlsx);
    check('the Excel sheet is read in the browser', await until(() => page.locator('#tg-upload').isVisible(), 15000) && /Register 2 guests/.test(await page.locator('#tg-upload').innerText()) && /Neha Joshi/.test(await sheet.innerText()), await sheet.innerText().catch(() => ''));
    await page.locator('#tg-upload').click();
    check('and registers both', await until(async () => /2 guests registered/.test(await sheet.innerText())), await sheet.innerText().catch(() => ''));
    const rows = await (await fetch(BASE + '/__db?q=' + encodeURIComponent("SELECT name, badge_type, registration_source FROM attendees WHERE registration_source = 'exhibitor:1' ORDER BY id"))).json();
    check('five Visitor Passes, all the company\'s', rows.length === 5 && rows.every(r => r.badge_type === 'Visitor Pass') && rows.map(r => r.name).join('|') === 'Meera Iyer|Shah, Sunil|Kiran Rao|Neha Joshi|Arjun Das', JSON.stringify(rows));

    // ---- send, close, the count ----
    await sheet.getByRole('tab', { name: /Send/ }).click();
    check('Send lists them with no "whole team" switch', await until(async () => /Next:/.test(await sheet.innerText())) && await page.locator('#tg-everyone').count() === 0, await sheet.innerText().catch(() => ''));
    await noSideScroll('the sheet');
    await page.locator('.tg-x').click();
    check('closing updates the dashboard count and the list', await until(async () => /5 of 100 Visitor Passes given/.test(await card.innerText()) && /Arjun Das/.test(await page.locator('#guests-list').innerText())), await card.innerText().catch(() => ''));
    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
