// End to end: a phone and a laptop in a real browser on /training-workshop, through
// delhi-harness.mjs (the real worker and real SQLite behind the form; it is not Delhi
// specific). Animations are off on the phone, as style.css does for people who turned
// them off, and the page must still show everything.
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8790);
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' };
const fill = async (page, v) => { for (const [id, val] of Object.entries(v)) await page.fill('#wp-' + id, val); };
const shot = process.env.WP_SHOTS;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ======== the phone ========
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    const errors = [];
    const missing = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE) && !r.url().includes('/api/')) missing.push(r.url()); });
    await page.goto(BASE + '/training-workshop', { waitUntil: 'load' });
    await page.waitForTimeout(800);

    const link = await page.evaluate(() => { const a = document.querySelector('.wp-herolink'); const r = a.getBoundingClientRect(); return { bottom: r.bottom, h: r.height, right: r.right, vh: innerHeight, vw: innerWidth }; });
    check('the link to the call is on the first screen, big enough to tap', link.bottom <= link.vh && link.h >= 44 && link.right <= link.vw, JSON.stringify(link));
    await page.tap('.wp-herolink');
    await page.waitForTimeout(1200);
    check('it lands on the call, under the bar', await page.evaluate(() => { const r = document.getElementById('workshop-partners').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }));
    check('the words and the form show with animations off', await page.evaluate(() => ['.wp-left', '.wp-card'].every((s) => getComputedStyle(document.querySelector(s)).opacity === '1')));
    const size = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('.wp-field input, .wp-field textarea, .wp-field select, .wp-submit, .wp-opt span')].filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.id || e.textContent),
      font: [...document.querySelectorAll('.wp-field input, .wp-field textarea, .wp-field select')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id),
    }));
    check('no sideways scroll on a phone', size.over <= 0, size.over);
    check('every box and button is big enough to tap', size.small.length === 0, size.small.join(', '));
    check('boxes are 16px or more, so the phone does not zoom in', size.font.length === 0, size.font.join(', '));
    if (shot) await page.locator('#workshop-partners').screenshot({ path: shot + '/wp-phone.png' });

    // The form, for real
    await page.locator('#wp-submit').scrollIntoViewIfNeeded();
    await page.click('#wp-submit');
    check('empty: asks for the topic, under its box, on screen', (await page.textContent('#wp-error')).includes('topic') && await page.locator('#wp-error').isVisible() && await page.evaluate(() => document.getElementById('wp-error').parentNode === document.getElementById('wp-topic').parentNode && document.activeElement.id === 'wp-topic'));
    await fill(page, { topic: 'Speech models for Indian languages', brief: 'Build a working voice bot from open models.' });
    await page.click('#wp-submit');
    check('no format: asks, under the pair', (await page.textContent('#wp-error')).includes('hands-on or pure theory') && await page.evaluate(() => document.getElementById('wp-error').parentNode.id === 'wp-format-set'));
    await page.locator('label.wp-opt', { hasText: 'Hands-on' }).click();
    check('tapping a choice chooses it', await page.isChecked('input[value="Hands-on"]'));
    await fill(page, { min: '120', max: '90' });
    await page.click('#wp-submit');
    check('longest under shortest: says so', (await page.textContent('#wp-error')).includes('cannot be less'));
    await fill(page, { min: '60', max: '90', attend: 'Software developers with some Python', prereq: 'Basic Python', setup: 'Projector, GPU access' });
    await page.locator('label.wp-opt', { hasText: 'An AI company' }).click();
    await page.click('#wp-submit');
    check('a company must name itself', (await page.textContent('#wp-error')).includes('company name'));
    await page.fill('#wp-company', 'Vaani Labs');
    await page.selectOption('#wp-salutation', 'Dr.');
    await fill(page, { first: 'Asha', last: 'Rao', email: 'asha@' });
    await page.click('#wp-submit');
    check('bad email: says so, under the email box', (await page.textContent('#wp-error')).includes('email') && await page.evaluate(() => document.getElementById('wp-error').parentNode === document.getElementById('wp-email').parentNode));
    await page.fill('#wp-email', 'asha@vaanilabs.example');
    await page.click('#wp-submit');
    check('no mobile: says so', (await page.textContent('#wp-error')).includes('mobile'));
    await page.fill('#wp-mobile', '98765 43210');
    await page.click('#wp-submit');
    await page.waitForSelector('#wp-done:not([hidden])');
    check('the thank-you names the person and the email', /Dr\. Asha Rao.*asha@vaanilabs\.example/.test(await page.textContent('#wp-done-text')));
    check('and the form has gone', !(await page.locator('#wp-form').isVisible()));
    const saved = await (await ctx.request.get(BASE + '/__inquiries')).json();
    const mine = saved.filter((s) => s.inquiry_type === 'workshop_partner');
    check('it really landed in the database', mine.length === 1 && mine[0].name === 'Dr. Asha Rao' && mine[0].organization === 'Vaani Labs' && mine[0].message.includes('Time needed: 60 to 90 minutes') && mine[0].message.includes('Who should attend: Software developers'), JSON.stringify(mine));
    const mail = await (await ctx.request.get(BASE + '/__mail')).json();
    check('and the team was emailed', mail.some((m) => m.Content.ReplyTo.includes('asha@vaanilabs.example')), mail.length);
    check('no missing files', missing.length === 0, missing.join(', '));
    check('no page errors on the phone', errors.length === 0, errors.join('; '));
    await ctx.close();

    // ======== sizes ========
    for (const [w, h] of [[360, 740], [820, 1180], [1280, 720], [1440, 900]]) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
      const p = await c.newPage();
      await p.goto(BASE + '/training-workshop#workshop-partners', { waitUntil: 'load' });
      await p.waitForTimeout(600);
      const r = await p.evaluate(() => ({
        over: document.documentElement.scrollWidth - innerWidth,
        bad: [...document.querySelectorAll('#workshop-partners *')].filter((e) => { if (e.closest('.wp-hp') || e.closest('[hidden]')) return false; const x = e.getBoundingClientRect(); return x.width && (x.right > innerWidth + 1 || x.left < -1); }).map((e) => e.tagName + '#' + e.id),
      }));
      check(`${w}px: nothing runs off the screen`, r.over <= 0 && r.bad.length === 0, JSON.stringify(r));
      if (shot && w === 1440) await p.locator('#workshop-partners').screenshot({ path: shot + '/wp-laptop.png' });
      await c.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('crashed: ' + e.message); process.exit(1); });
