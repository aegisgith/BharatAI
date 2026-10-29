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
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall live phone checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('crashed:', e.message); process.exit(2); });
