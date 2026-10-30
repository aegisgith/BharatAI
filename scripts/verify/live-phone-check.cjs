// Production on an emulated phone, nothing written (registration POSTs intercepted).
// node scripts/verify/live-phone-check.cjs
// Live production, emulated phone, nothing written: pages load clean, new code is served,
// the forged "are you coming?" link is refused, campus forms still work (POST intercepted).
const { chromium } = require('./playwright.cjs');
const BASE = 'https://bharataiinnovation.com';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE + '/app?live=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const fns = await page.evaluate(() => ['showImageToSave', 'deliverImage', 'answerPanelComing', 'lockedCardHTML', 'answerMainEvent', 'parseDbTime'].filter(f => typeof window[f] !== 'function'));
  check('live /app on a phone has every new function', fns.length === 0, 'missing: ' + fns.join(','));
  check('live /app has no JavaScript errors on a phone', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('live /app fits a 390px phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'overflow');
  const passJs = await page.evaluate(() => fetch('/js/pass-render.js?v=20261029').then(r => r.text()));
  check('live pass renderer hands phones to the share-or-save view', /global\.deliverImage/.test(passJs), 'old pass-render.js served');
  check('live pass renderer draws its own QR (bundled encoder first, qrserver only as fallback)', /global\.qrcode\(0, 'M'\)/.test(passJs) && /qrFailed/.test(passJs), 'old pass-render.js served');

  // A real pass, drawn on the live page with a stand-in token, and its QR read
  // back by the bundled decoder at full size and at the size a phone screen
  // shows it. Nothing is written: the token is made up, no API is called.
  const TOKEN = '12345.abcdefabcdefabcdefabcdef';
  const pass = await page.evaluate(async (token) => {
    const r = await window.BhaiPass.render({ id: 12345, name: 'Live Check', company: 'Acme AI', job_title: 'CTO', badge_type: 'Delegate Pass', avatar_url: '' }, { token });
    const shrink = async (w) => { const img = new Image(); img.src = r.dataUrl; await img.decode();
      const c = document.createElement('canvas'); c.width = w; c.height = Math.round(img.height * w / img.width);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, data: Array.from(d.data) }; };
    return { qrSource: r.qrSource, qrFailed: r.qrFailed, width: r.width, height: r.height, full: await shrink(r.width), phone: await shrink(390) };
  }, TOKEN);
  check('live pass draws its QR locally (no api.qrserver.com in the path)', pass.qrSource === 'local' && !pass.qrFailed, 'qrSource=' + pass.qrSource + ' qrFailed=' + pass.qrFailed);
  // A classic UMD script: under this package's "type": "module" a require() would
  // read it as ESM and get nothing, so it runs with a module object to export into.
  const jsQRm = { exports: {} };
  require('node:vm').runInNewContext(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public', 'js', 'vendor', 'jsQR.js'), 'utf8'), { module: jsQRm, exports: jsQRm.exports });
  const jsQR = jsQRm.exports;
  for (const [label, img] of [['full size', pass.full], ['a 390px phone screen', pass.phone]]) {
    const d = jsQR(new Uint8ClampedArray(img.data), img.w, img.h);
    check(`live pass QR decodes at ${label} to the signed verify link`, !!d && d.data === 'https://bharataiinnovation.com/verify/' + TOKEN, d ? d.data : 'no decode');
  }
  const scan = await page.goto(BASE + '/staff/scan', { waitUntil: 'domcontentloaded' });
  check('live /staff/scan without a desk session lands on the sign-in page', /\/staff(\?|$)/.test(scan.url()) && /Badge desk sign in/.test(await page.evaluate(() => document.body.innerText)), scan.url());
  const vendor = await page.evaluate(() => Promise.all(['/js/vendor/jsQR.js?v=20261029', '/js/vendor/qrcode-generator.js?v=20261029'].map(u => fetch(u).then(r => r.ok && r.headers.get('content-type')))));
  check('live vendor QR libraries are served as JavaScript', vendor.every(t => /javascript/.test(String(t))), JSON.stringify(vendor));

  const r = await page.goto(BASE + '/panel-rsvp?a=1&p=djsanghvi-21sep&r=yes&s=' + '0'.repeat(32), { waitUntil: 'load' });
  const txt = await page.evaluate(() => document.body.innerText);
  check('live forged "are you coming?" link is refused plainly', r.status() === 400 && /not valid/.test(txt), r.status() + ' ' + txt.slice(0, 80));
  check('that page fits the phone and never says RSVP', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) && !/RSVP/i.test(txt), 'layout or wording');

  for (const slug of ['campus-djsanghvi', 'campus-jnu']) {
    const p2 = await ctx.newPage();
    const errs = [];
    p2.on('pageerror', e => errs.push(e.message));
    let posted = null;
    await p2.route('**/api/events/1/attendees/register', async route => { posted = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":999999}' }); });
    await p2.goto(`${BASE}/${slug}?live=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p2.waitForTimeout(1500);
    if (await p2.locator('#cp-reg-form').count()) {
      // Pages with the "I am" choice register as a professional (the usual panel registrant).
      const pro = p2.locator('#cp-reg-form input[name="who"][value="professional"]');
      if (await pro.count()) { await pro.check(); await p2.locator('#cp-reg-form [name="industry"]').selectOption('Software & SaaS'); }
      for (const [n, v] of [['name', 'Live Check'], ['email', 'live.check@example.com'], ['mobile', '9876543210'], ['company', 'Test College'], ['job_title', 'Student'], ['city', 'Mumbai']]) {
        const l = p2.locator(`#cp-reg-form [name="${n}"]`); if (await l.count()) await l.first().fill(v);
      }
      await p2.locator('#cp-reg-submit').click();
      await p2.waitForTimeout(2000);
      check(`live ${slug} form works on a phone (nothing saved: request intercepted)`, !!posted && /You are registered/.test(await p2.evaluate(() => document.body.innerText)) && errs.length === 0, JSON.stringify({ posted: !!posted, errs }));
    } else {
      check(`live ${slug} shows the concluded notice instead of a form`, /concluded|thank you/i.test(await p2.evaluate(() => document.body.innerText)), 'no form, no notice');
    }
    await p2.close();
  }

  // The way in (29 Oct 2026), nothing written. Without its code, a fresh phone gets
  // one refresh and then the steps (the report to /api/app-boot is answered here,
  // never sent). A dead link for an address with no account opens the sign-in box
  // with the note (no account, so the server records nothing). An ordinary start
  // sends no report at all.
  {
    const phoneCtx = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: 'block' });
    const c3 = await phoneCtx();
    const boots = [];
    await c3.route(/\/api\/app-boot$/, async (r) => { boots.push(JSON.parse(r.request().postData() || '{}').stage); await r.fulfill({ json: { ok: true } }); });
    await c3.route(/\/app\.js\?/, (r) => r.abort());
    const p3 = await c3.newPage();
    await p3.goto(BASE + '/app?live=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    let shown = false;
    for (let i = 0; i < 120 && !shown; i++) { await p3.waitForTimeout(250); shown = await p3.evaluate(() => !!document.getElementById('boot-retry')).catch(() => false); }
    const panel = shown ? await p3.evaluate(() => document.getElementById('loading-screen').innerText) : '';
    check('live /app without its code: one refresh, then the steps on screen', shown && boots.filter(s => s === 'fail').length >= 2 && /Open in Chrome/.test(panel), JSON.stringify(boots));
    check('live steps screen never says anything went wrong', !/\b(error|problem|issue|fail\w*|sorry|bug|broken|wrong)\b/i.test(panel), panel.slice(0, 160));
    await c3.close();
    const c4 = await phoneCtx();
    const reports = [];
    c4.on('request', (r) => { if (/\/api\/app-boot/.test(r.url())) reports.push(r.url()); });
    await c4.route(/\/api\/app-boot$/, (r) => r.fulfill({ json: { ok: true } }));
    const p4 = await c4.newPage();
    await p4.goto(BASE + '/app?email=nobody-live-check%40example.com&action=social-card&token=' + 'ab'.repeat(32), { waitUntil: 'load', timeout: 60000 });
    await p4.waitForTimeout(3500);
    const st = await p4.evaluate(() => { const n = document.getElementById('signin-note'); return { note: n ? n.textContent : '', shown: !!n && !n.classList.contains('hidden'), email: (document.getElementById('signin-email') || {}).value, loading: getComputedStyle(document.getElementById('loading-screen')).display }; });
    check('live dead link: the sign-in box opens on the address with the note', st.shown && /expired/.test(st.note) && st.email === 'nobody-live-check@example.com' && st.loading === 'none', JSON.stringify(st));
    check('live ordinary start sends no startup report', reports.length === 0, reports.join(','));
    await c4.close();
  }

  // The AI Marketplace listing form (30 Oct 2026), nothing written. The page runs as
  // a signed-in company because the session check is answered here; the listing POST
  // is answered here, and any other write under /api/mp/ is refused here, so nothing
  // reaches production. An exhibitor had written that "Submit for review" did nothing.
  {
    const mpCtx = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' });
    const c5 = await mpCtx();
    const errs = [], sent = [], leaked = [];
    let answer = { status: 200, json: { success: true, id: 1, missing: [] } };
    await c5.route(/\/api\/mp\//, (r) => { if (r.request().method() === 'GET') return r.continue(); leaked.push(r.request().method() + ' ' + r.request().url()); return r.abort(); });
    await c5.route(/\/api\/mp\/listings$/, (r) => { if (r.request().method() !== 'POST') return r.fallback(); sent.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: answer.status, json: answer.json }); });
    await c5.route(/\/api\/mp\/auth\/me$/, (r) => r.fulfill({ json: { user: { id: 999999, company_name: 'Live Check Pvt Ltd', email: 'live.check@example.com', role: 'company' }, event_admin: false } }));
    const p5 = await c5.newPage();
    p5.on('pageerror', e => errs.push(e.message));
    const open = async (title) => { const d = p5.locator('#listing-form details', { has: p5.locator('summary', { hasText: title }) }).first(); if (!(await d.evaluate(e => e.open))) await d.locator('summary').click(); };
    const isOpen = (title) => p5.locator('#listing-form details', { has: p5.locator('summary', { hasText: title }) }).first().evaluate(e => e.open);
    const press = () => p5.click('#listing-form button[type="submit"]');
    const shown = (sel) => p5.locator(sel).first().innerText().catch(() => '');
    const load = async () => { await p5.goto(BASE + '/marketplace?submit=true&live=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 }); await p5.waitForSelector('#listing-form-section:not(.hidden)', { timeout: 20000 }).catch(() => {}); await p5.waitForTimeout(500); };
    await load();
    const form = await p5.evaluate(() => { const f = document.getElementById('listing-form'), w = f && f.querySelector('[name="website_url"]'), cs = w && getComputedStyle(w);
      return { novalidate: !!(f && f.noValidate), type: w && w.type, border: cs ? parseFloat(cs.borderTopWidth) : 0 }; });
    // The page script's top-level names, read the way the console would (no eval in the page).
    form.fns = [];
    for (const n of ['validateListing', 'showFormError', 'signedOutMidForm', 'restoreDraft']) if ((await p5.evaluate('typeof ' + n).catch(() => 'missing')) !== 'function') form.fns.push(n);
    check('live marketplace form: no silent browser check, a plain box for links, the new code served', form.novalidate && form.type === 'text' && form.fns.length === 0, JSON.stringify(form));
    check('live marketplace form: its boxes have a visible border on a phone', form.border >= 1, 'border ' + form.border);
    // An empty product name inside a collapsed section: named on screen, the section opened.
    await p5.locator('#listing-form summary', { hasText: 'Basic Information' }).click();
    await press(); await p5.waitForTimeout(600);
    const e1 = await shown('#listing-form [data-form-error]');
    check('live marketplace form: an empty name in a closed section is named and the section opened', /product name/i.test(e1) && await isOpen('Basic Information') && sent.length === 0, e1);
    // A website typed without https://, the missing-details step, then Submit anyway.
    await p5.fill('#listing-form [name="product_name"]', 'Live Check Product (never saved)');
    await p5.fill('#listing-form [name="description"]', 'A check run by the organisers. This request is answered in the browser and never sent.');
    await open('Media');
    await p5.fill('#listing-form [name="website_url"]', 'www.example.com');
    await press(); await p5.waitForTimeout(500);
    check('live marketplace form: the first press says "Not submitted yet" and sends nothing', /Not submitted yet/.test(await shown('#listing-form [data-incomplete-notice]')) && sent.length === 0, String(sent.length));
    await press();
    await p5.waitForSelector('.listing-success-panel', { timeout: 15000 }).catch(() => {});
    check('live marketplace form: Submit anyway sends www.example.com as https://www.example.com', sent.length === 1 && sent[0].website_url === 'https://www.example.com' && /Listing Submitted/.test(await shown('.listing-success-panel')), JSON.stringify(sent.map(s => s.website_url)));
    check('live marketplace form: a sent listing forgets its draft', (await p5.evaluate(() => localStorage.getItem('mpListingDraft'))) === null);
    // What is typed survives a reload; a sign-in that ran out is explained and keeps it.
    await load();
    await p5.fill('#listing-form [name="product_name"]', 'Live Draft Check');
    await p5.fill('#listing-form [name="description"]', 'Kept in this browser only.');
    await p5.waitForTimeout(700);
    await load();
    const kept = await p5.evaluate(() => document.querySelector('#listing-form [name="product_name"]').value);
    check('live marketplace form: what is typed comes back after a reload, with the note', kept === 'Live Draft Check' && /kept what you typed/.test(await shown('#listing-form [data-draft-notice]')), kept);
    answer = { status: 401, json: { error: 'Login required' } };
    await press(); await p5.waitForTimeout(400); await press();
    await p5.waitForSelector('#listing-form [data-form-error]:not([hidden])', { timeout: 10000 }).catch(() => {});
    const e2 = await shown('#listing-form [data-form-error]');
    check('live marketplace form: a sign-in that ran out is explained and the form is kept', /sign-in has run out/.test(e2) && (await p5.inputValue('#listing-form [name="product_name"]')) === 'Live Draft Check', e2);
    check('live marketplace form fits the phone, with no JavaScript errors', await p5.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) && errs.length === 0, errs.slice(0, 2).join(' | '));
    check('live marketplace check wrote nothing (every other write refused in the browser)', leaked.length === 0, leaked.join(', '));
    await c5.close();
    // Signed out, the dashboard's Sign in opens the sign-in box. Only GETs leave the browser.
    const c6 = await mpCtx();
    const leaked6 = [];
    await c6.route(/\/api\/mp\//, (r) => { if (r.request().method() === 'GET') return r.continue(); leaked6.push(r.request().url()); return r.abort(); });
    const p6 = await c6.newPage();
    await p6.goto(BASE + '/marketplace/dashboard?live=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p6.waitForSelector('.dash-login-required a', { timeout: 20000 }).catch(() => {});
    await p6.click('.dash-login-required a').catch(() => {});
    await p6.waitForSelector('#auth-section:not(.hidden)', { timeout: 20000 }).catch(() => {});
    check('live marketplace dashboard, signed out: Sign in opens the sign-in box', p6.url().includes('/marketplace?signin=1') && await p6.locator('#auth-section').isVisible() && leaked6.length === 0, p6.url());
    await c6.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall live phone checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('crashed:', e.message); process.exit(2); });
