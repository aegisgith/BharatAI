// END TO END for Delhi codes (12 Nov 2026), a real phone-sized browser on the built worker
// and real SQLite (delhi-harness.mjs): a partner's link fills the code in and the total
// shows the old price struck through; another pass re-checks it; a wrong code is said in
// words; checkout charges the coded price; Admin -> Delhi 2027 lists the code and makes one.
// Needs delhi-harness.mjs (HARNESS_PORT). Started by run-all.mjs.
const path = require('path');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8803);
const SHOTS = process.env.SHOTS_DIR || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/delhi-register')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const made = await fetch(BASE + '/api/admin/delhi/codes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer h-admin' }, body: JSON.stringify({ code: 'PARTNER20', partner: 'A partner community', percent: 20 }) });
  check('a code is made through Admin', made.status === 201, String(made.status));

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: 'block' });
    await c.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    const p = await c.newPage();
    p.setDefaultTimeout(30000);
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/delhi-register?code=partner20#delegate', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => /PARTNER20/.test(document.getElementById('dr-code-msg').textContent), null, { timeout: 20000 }).catch(() => {});
    const st = await p.evaluate(() => ({ box: document.getElementById('dr-code').value, msg: document.getElementById('dr-code-msg').textContent, total: document.getElementById('dr-total').innerText, struck: (document.querySelector('#dr-total s') || {}).textContent || '' }));
    check("the partner's link fills the code in and says 20% off", st.box === 'PARTNER20' && st.msg === 'Code PARTNER20: 20% off this pass.', JSON.stringify(st));
    check('the total: the old price struck through, then 4,718.82', st.struck === '₹5,898.82' && /₹4,718\.82/.test(st.total), JSON.stringify(st));
    await p.locator('input[name="pass"][value="Academic Pass"] + span').tap();
    await p.waitForFunction(() => /942\.82/.test(document.getElementById('dr-total').innerText), null, { timeout: 15000 }).catch(() => {});
    check('another pass re-checks the code: Academic 942.82', /₹942\.82/.test(await p.evaluate(() => document.getElementById('dr-total').innerText)));
    await p.locator('input[name="pass"][value="Delegate Pass"] + span').tap();
    await p.fill('#dr-code', 'nope');
    await p.locator('#dr-code-apply').tap();
    await p.waitForFunction(() => /not valid/.test(document.getElementById('dr-code-msg').textContent), null, { timeout: 15000 }).catch(() => {});
    const bad = await p.evaluate(() => ({ msg: document.getElementById('dr-code-msg').textContent, inv: document.getElementById('dr-code').getAttribute('aria-invalid'), total: document.getElementById('dr-total').innerText }));
    check('a wrong code: said in words, marked, the full price shown', /not valid/.test(bad.msg) && bad.inv === 'true' && /₹5,898\.82/.test(bad.total) && !/4,718/.test(bad.total), JSON.stringify(bad));
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check('no sideways scroll at 390 px', wide <= 0, String(wide));
    const h = await p.evaluate(() => Math.round(document.getElementById('dr-code-apply').getBoundingClientRect().height));
    check('Apply is thumb-sized', h >= 44, String(h));
    // Checkout with the code.
    await p.fill('#dr-code', 'PARTNER20');
    await p.locator('#dr-code-apply').tap();
    await p.waitForFunction(() => /20% off/.test(document.getElementById('dr-code-msg').textContent), null, { timeout: 15000 }).catch(() => {});
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'delhi-code.png'), fullPage: true });
    await p.fill('#dr-name', 'Code Buyer');
    await p.fill('#dr-email', 'code.buyer@example.com');
    await p.fill('#dr-phone', '9820055511');
    await p.fill('#dr-org', 'Example Ltd');
    await p.fill('#dr-job', 'CIO');
    await p.fill('#dr-city', 'New Delhi');
    await p.selectOption('#dr-industry', { index: 1 });
    // Checkout hands the browser on to CCAvenue, which this test does not reach: it is
    // enough that the form was left and the order holds the coded price.
    await Promise.all([p.waitForURL((u) => !/delhi-register/.test(String(u)), { timeout: 30000 }).catch(() => {}), p.locator('#dr-submit').tap()]);
    const rows = await (await fetch(BASE + '/__rows')).json();
    const order = (rows.orders || []).slice(-1)[0] || {};
    check('checkout opens at the coded price: 4,718.82', !/delhi-register/.test(p.url()) && order.amount_paise === 471882 && order.event_id === 2 && order.status === 'created', p.url() + ' ' + JSON.stringify(order));
    check('no script errors on the form', errors.filter((m) => !/chromewebdata|ERR_FAILED/.test(m)).length === 0, errors.join(' | '));
    await c.close();

    // Admin.
    const d = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    await d.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    await d.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Check'); });
    const a = await d.newPage();
    a.setDefaultTimeout(30000);
    const aerr = [];
    a.on('pageerror', (e) => aerr.push(e.message));
    a.on('dialog', (dl) => dl.accept());
    await a.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await a.waitForFunction(() => typeof switchSection === 'function', null, { timeout: 30000 });
    await a.click('[data-section="delhi2027"]');
    await a.waitForSelector('#section-delhi2027 .dld-table', { timeout: 30000 }).catch(() => {});
    const view = await a.evaluate(() => document.getElementById('section-delhi2027').innerText);
    check('Admin -> Delhi 2027 lists PARTNER20: 20%, all passes, 1 started', /PARTNER20/.test(view) && /A partner community/.test(view) && /20%/.test(view) && /1 started/.test(view), view.slice(0, 400));
    await a.fill('#dld-form input[name="code"]', 'iitalumni');
    await a.fill('#dld-form input[name="partner"]', 'IIT alumni network');
    await a.fill('#dld-form input[name="percent"]', '0');
    await a.click('#dld-form button[type="submit"]');
    await a.waitForFunction(() => /IITALUMNI/.test(document.getElementById('section-delhi2027').innerText), null, { timeout: 15000 }).catch(() => {});
    const after = await a.evaluate(() => document.getElementById('section-delhi2027').innerText);
    check('making a code from the screen: IITALUMNI, no discount', /IITALUMNI/.test(after) && /IIT alumni network/.test(after), after.slice(0, 400));
    if (SHOTS) await a.screenshot({ path: path.join(SHOTS, 'delhi-admin.png'), fullPage: true });
    check('no script errors on Admin', aerr.length === 0, aerr.join(' | '));
    await d.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall Delhi code browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
