// END TO END for visitors from outside India, Delhi 2027 (13 Nov 2026), real browsers on the
// built worker and real SQLite (delhi-harness.mjs): the /delhi section on a phone; the
// /delhi-visa form (an empty box said in words, a sent request with its reference, both
// emails); no sideways scroll at 390 or 320 px; Admin -> Delhi 2027 counts the request and
// opens it on the Inquiries desk.
// Needs delhi-harness.mjs (HARNESS_PORT). Started by run-all.mjs.
const path = require('path');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8804);
const SHOTS = process.env.SHOTS_DIR || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/delhi-visa')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: 'block', reducedMotion: 'reduce' });
    await c.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    const p = await c.newPage();
    p.setDefaultTimeout(30000);
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));

    // ---- /delhi ----
    await p.goto(BASE + '/delhi#travel', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#travel', { timeout: 20000 });
    const sec = await p.evaluate(() => { const s = document.getElementById('travel'); return { text: s.innerText, items: s.querySelectorAll('dl > div').length, visa: !!s.querySelector('a[href="/delhi-visa"]'), official: !!s.querySelector('a[href="https://indianvisaonline.gov.in/"]') }; });
    check('/delhi: "Coming from outside India" with visa, airport, metro, time and money', /Coming from\s*outside India/.test(sec.text) && sec.items === 4 && /Supreme Court/.test(sec.text) && /UTC\+5:30/.test(sec.text) && sec.visa && sec.official, JSON.stringify(sec));
    check('/delhi: no sideways scroll at 390 px', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    if (SHOTS) { await p.evaluate(() => document.getElementById('travel').scrollIntoView()); await p.waitForTimeout(400); await p.screenshot({ path: path.join(SHOTS, 'delhi-travel.png') }); }

    // ---- /delhi-visa ----
    await p.goto(BASE + '/delhi-visa', { waitUntil: 'domcontentloaded' });
    await p.locator('#dv-submit').tap();
    const empty = await p.evaluate(() => ({ err: document.getElementById('dv-error').textContent, focus: document.activeElement && document.activeElement.id }));
    check('an empty form says what is missing and goes to that box', /passport/.test(empty.err) && empty.focus === 'dv-name', JSON.stringify(empty));
    await p.fill('#dv-name', 'Amelia Jane Watson');
    await p.fill('#dv-nationality', 'British');
    await p.fill('#dv-country', 'United Kingdom');
    await p.fill('#dv-org', 'Watson Analytics Ltd');
    await p.fill('#dv-job', 'Chief Data Officer');
    await p.fill('#dv-email', 'amelia.watson@example.co.uk');
    await p.fill('#dv-phone', '+44 7700 900123');
    await p.locator('#dv-submit').tap();
    check('the part in the event is asked for in words', /part in the event/.test(await p.evaluate(() => document.getElementById('dv-error').textContent)));
    await p.selectOption('#dv-pass', 'buying');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'delhi-visa-form.png'), fullPage: true });
    await p.locator('#dv-submit').tap();
    await p.waitForSelector('#dv-done:not([hidden])', { timeout: 20000 }).catch(() => {});
    const done = await p.evaluate(() => ({ text: document.getElementById('dv-done').innerText, ref: document.getElementById('dv-ref').textContent }));
    check('sent: thanked by name, the email address, the reference', /Thank you, Amelia/.test(done.text) && /amelia\.watson@example\.co\.uk/.test(done.text) && /^BHAI-INQ-\d{5}$/.test(done.ref), JSON.stringify(done));
    const inq = await (await fetch(BASE + '/__inquiries')).json();
    const row = inq.find((x) => x.inquiry_type === 'visa_letter') || {};
    check('the request is on the desk as a visa letter', row.name === 'Amelia Jane Watson' && row.status === 'new', JSON.stringify(row));
    const mail = await (await fetch(BASE + '/__mail')).json();
    check('two emails: the team and the person', mail.filter((m) => /Visa letter|visa letter/.test(m.Content.Subject + m.Content.Body[0].Content)).length >= 2, mail.map((m) => m.Content.Subject).join(' | '));
    await p.setViewportSize({ width: 320, height: 640 });
    await p.goto(BASE + '/delhi-visa', { waitUntil: 'domcontentloaded' });
    check('/delhi-visa: no sideways scroll at 320 px', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    check('no script errors on the pages', errors.length === 0, errors.join(' | '));
    await c.close();

    // ---- Admin ----
    const d = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    await d.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    await d.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Check'); });
    const a = await d.newPage();
    a.setDefaultTimeout(30000);
    const aerr = [];
    a.on('pageerror', (e) => aerr.push(e.message));
    await a.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await a.waitForFunction(() => typeof switchSection === 'function', null, { timeout: 30000 });
    await a.click('[data-section="delhi2027"]');
    await a.waitForSelector('#section-delhi2027 [data-act="visa"]', { timeout: 30000 }).catch(() => {});
    const card = await a.evaluate(() => document.getElementById('section-delhi2027').innerText);
    check('Admin -> Delhi 2027: "1 request, 1 open" and the clearances named', /1 request, 1 open/.test(card) && /conference\.mha\.gov\.in/.test(card), card.slice(-400));
    await a.click('#section-delhi2027 [data-act="visa"]');
    await a.waitForFunction(() => document.getElementById('page-title').textContent === 'Inquiry Management' && /Amelia Jane Watson/.test(document.getElementById('section-inquiries').innerText), null, { timeout: 30000 }).catch(() => {});
    const desk = await a.evaluate(() => ({ title: document.getElementById('page-title').textContent, text: document.getElementById('section-inquiries').innerText }));
    check('"Open them in Inquiries" opens the desk on the visa letters, labelled as such', desk.title === 'Inquiry Management' && /Amelia Jane Watson/.test(desk.text) && /Visa letter/.test(desk.text), desk.text.slice(0, 300));
    check('no script errors on Admin', aerr.length === 0, aerr.join(' | '));
    await d.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall visitor browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
