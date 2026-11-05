// End to end: a phone and a laptop in a real browser on the Delhi 2027 page, through
// delhi-harness.mjs (the real worker and real SQLite behind the form). Animations are
// off on the phone (style.css disables them for people who turned them off, and the
// page must still show everything). Also: the menu fits on one row on every page, and
// the home page's heading font and Hindi line. Run by run-all.mjs.
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8786);
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' };
const settled = async (p) => { await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1200); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ======== the phone, top to bottom ========
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    const errors = [];
    const missing = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) missing.push(r.url()); });
    await page.goto(BASE + '/delhi', { waitUntil: 'load' });
    await settled(page);

    const hero = await page.evaluate(() => {
      const i = document.querySelector('.dl-photo img');
      const h1 = document.querySelector('h1').getBoundingClientRect();
      const b = document.querySelector('.dl-hero-actions .btn').getBoundingClientRect();
      return { src: i.currentSrc, w: i.naturalWidth, op: getComputedStyle(i).opacity, over: document.documentElement.scrollWidth - innerWidth, h1Top: h1.top, btnBottom: b.bottom, vh: innerHeight, font: getComputedStyle(document.querySelector('h1')).fontFamily, bg: getComputedStyle(document.getElementById('navbar')).backgroundRepeat };
    });
    check('the phone gets the phone photograph, fully visible', /mandapam-dusk-phone/.test(hero.src) && hero.w === 1170 && hero.op === '1', JSON.stringify(hero));
    check('no sideways scroll on a phone', hero.over <= 0, hero.over);
    check('the first button is on the first screen', hero.btnBottom <= hero.vh, hero.btnBottom);
    check('the heading is in the brand font, loaded', hero.font.includes('Bricolage') && await page.evaluate(() => [...document.fonts].some((f) => f.family.includes('Bricolage') && f.status === 'loaded')));
    const words = await page.evaluate(() => document.body.innerText);
    check('date and venue on the page', /29–30 July 2027/i.test(words) && /Bharat Mandapam/.test(words));
    check('Save the date on Android goes to Google Calendar', (await page.getAttribute('#dl-save-date', 'href')).includes('calendar.google.com'));

    await page.click('#nav-toggle');
    await page.waitForTimeout(400);
    check('the phone menu shows Delhi 2027 as the current tab', await page.locator('#nav-menu a[href="/delhi"].active').isVisible());
    await page.click('#nav-toggle');
    await page.waitForTimeout(300);

    // Past the hero the bar follows; at the form it steps aside.
    await page.evaluate(() => { const y = document.querySelector('.dl-tiles').getBoundingClientRect().top + scrollY - 90; window.scrollTo(0, y); });
    await page.waitForTimeout(500);
    check('past the hero the offer bar follows the reader', await page.locator('#stickyCta.is-on').count() === 1);
    check('and its button can be reached by keyboard', await page.getAttribute('#stickyCta a', 'tabindex') === '0');
    await page.click('#stickyCta a');
    await page.waitForTimeout(900);
    check('the bar\'s button goes to the form, and it steps aside there', await page.locator('#stickyCta.is-on').count() === 0 && await page.locator('#dl-form').isVisible());

    // Everything appears, every picture loads
    for (const sel of ['.dl-collage', '.dl-tiles', '.dl-rows', '.dl-faq']) {
      await page.locator(sel).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20000 }).catch(() => {});
    check('sections show with animations off', await page.evaluate(() => ['.dl-collage', '.dl-tiles', '.dl-rows'].every((s) => getComputedStyle(document.querySelector(s)).opacity === '1')));
    check('every picture loads', await page.evaluate(() => [...document.images].every((i) => i.naturalWidth > 0)), await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src).join(', ')));
    check('tap targets on the form are big enough', await page.evaluate(() => [...document.querySelectorAll('.dl-field input, .dl-submit, .dl-way > span')].every((e) => e.getBoundingClientRect().height >= 44)));

    // The form, for real
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('.dl-hero-alt a');
    await page.waitForTimeout(900);
    check('"Tell us here" chooses Exhibit', await page.evaluate(() => document.querySelector('input[name="interest"]:checked').value) === 'exhibit');
    await page.click('#dl-submit');
    check('empty: asks for the name, on screen', (await page.textContent('#dl-error')).includes('name') && await page.locator('#dl-error').isVisible());
    await page.fill('#dl-name', 'Priya Sharma');
    await page.fill('#dl-email', 'priya@');
    await page.click('#dl-submit');
    check('bad email: says so', (await page.textContent('#dl-error')).includes('email'));
    await page.fill('#dl-email', 'priya@example.com');
    await page.click('#dl-submit');
    check('Exhibit with no mobile: asks for it', (await page.textContent('#dl-error')).includes('mobile'));
    await page.fill('#dl-phone', '98765 43210');
    await page.fill('#dl-org', 'Example Ltd');
    // Tapping the label of another choice works, then back
    await page.locator('label.dl-way', { hasText: 'Speak' }).click();
    check('tapping a choice selects it', await page.evaluate(() => document.querySelector('input[name="interest"]:checked').value) === 'speak');
    await page.locator('label.dl-way', { hasText: 'Exhibit' }).click();
    await page.click('#dl-submit');
    await page.waitForSelector('#dl-done:not([hidden])');
    check('the thank-you names their email', (await page.textContent('#dl-done-text')).includes('priya@example.com'));
    const saved = await (await ctx.request.get(BASE + '/__inquiries')).json();
    check('it really landed in the database', saved.length === 1 && saved[0].inquiry_type === 'exhibition' && saved[0].subject === 'Delhi 2027 · Exhibit' && saved[0].email === 'priya@example.com', JSON.stringify(saved));
    const mail = await (await ctx.request.get(BASE + '/__mail')).json();
    check('and the team was emailed once', mail.length === 1 && mail[0].Content.ReplyTo.includes('priya@example.com'), mail.length);

    // Questions
    const qs = page.locator('.dl-faq details');
    for (let i = 0; i < await qs.count(); i++) await qs.nth(i).locator('summary').click();
    check('all four questions open', await page.evaluate(() => { const d = [...document.querySelectorAll('.dl-faq details')]; return d.length === 4 && d.every((x) => x.open); }));

    // The links out and the calendar file
    const ics = await ctx.request.get(BASE + '/delhi-2027.ics');
    check('the calendar file downloads', ics.status() === 200 && (await ics.text()).includes('DTSTART;VALUE=DATE:20270729'));
    const og = await ctx.request.get(BASE + '/images/og/delhi.jpg');
    check('the share card is there', og.status() === 200);

    const lost = missing.filter((u) => !u.includes('/api/'));
    check('no missing files', lost.length === 0, lost.join(', '));
    check('no page errors on the phone', errors.length === 0, errors.join('; '));
    await ctx.close();

    // ======== sizes ========
    for (const [w, h, photo] of [[360, 740, 'phone'], [820, 1180, '1600|2400'], [1280, 720, '1600|2400'], [1440, 900, '1600|2400'], [1920, 1080, '2400|1600']]) {
      const c = await browser.newContext({ viewport: { width: w, height: h } });
      const p = await c.newPage();
      await p.goto(BASE + '/delhi', { waitUntil: 'load' });
      await settled(p);
      const r = await p.evaluate(() => {
        const bad = [...document.querySelectorAll('h1,h2,h3,p,li,a.btn,button')].filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.right > innerWidth + 1 || x.left < -1); }).map((e) => e.textContent.trim().slice(0, 30));
        const roof = document.querySelector('.dl-hero-alt').getBoundingClientRect().bottom;
        const img = document.querySelector('.dl-photo img').getBoundingClientRect();
        return { over: document.documentElement.scrollWidth - innerWidth, bad, src: document.querySelector('.dl-photo img').currentSrc, btn: document.querySelector('.dl-hero-actions .btn').getBoundingClientRect().bottom, words: roof, imgTop: img.top, imgH: img.height, vh: innerHeight };
      });
      check(`${w}px: nothing runs off the screen`, r.over <= 0 && r.bad.length === 0, JSON.stringify(r.bad));
      check(`${w}px: the right photograph (${photo})`, new RegExp(photo).test(r.src), r.src);
      check(`${w}px: the first button is on the first screen`, r.btn <= r.vh, r.btn);
      // On a wide screen the words stop above the roof, which is 22% down the picture.
      if (w > 768) check(`${w}px: the words stop above the building's roof`, r.words <= r.imgTop + r.imgH * 0.235, r.words + ' / ' + (r.imgTop + r.imgH * 0.235));
      await c.close();
    }

    // ======== the laptop: tiles, and "Policymakers" clear of its words ========
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await c.newPage();
      await p.goto(BASE + '/delhi', { waitUntil: 'load' });
      await settled(p);
      check('laptop: the hero fits the first screen and shows the building', await p.evaluate(() => { const i = document.querySelector('.dl-photo img').getBoundingClientRect(); return i.top + i.height * 0.5 < innerHeight; }));
      const clear = await p.evaluate(() => [...document.querySelectorAll('.dl-rows li')].every((li) => { const r = document.createRange(); r.selectNodeContents(li.querySelector('b')); return r.getBoundingClientRect().right <= li.querySelector('span').getBoundingClientRect().left; }));
      check('laptop: the big words never run into their descriptions', clear);
      await c.close();
    }

    // ======== the menu on one row, on every page with one ========
    const root = path.join(__dirname, '..', '..', 'public');
    const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html') && fs.readFileSync(path.join(root, f), 'utf8').includes('class="nav-menu"')).map((f) => (f === 'index.html' ? '/' : '/' + f.replace(/\.html$/, '')));
    const c = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await c.newPage();
    const tight = [];
    for (const u of pages) {
      await p.goto(BASE + u, { waitUntil: 'domcontentloaded' });
      await p.evaluate(() => document.fonts.ready);
      const r = await p.evaluate(() => {
        const box = document.querySelector('.nav-container');
        const inner = box.getBoundingClientRect().right - parseFloat(getComputedStyle(box).paddingRight);
        const menu = document.getElementById('nav-menu');
        const logo = document.querySelector('.nav-logo').getBoundingClientRect();
        const first = menu.querySelector('.nav-link').getBoundingClientRect();
        const cta = menu.querySelector('.nav-cta').getBoundingClientRect();
        const tops = new Set([...menu.querySelectorAll('.nav-link')].map((a) => Math.round(a.getBoundingClientRect().top)));
        return { over: Math.round(cta.right - inner), spare: Math.round(first.left - logo.right), rows: tops.size };
      });
      if (r.over > 0 || r.rows > 1 || r.spare < 12) tight.push(u + ' ' + JSON.stringify(r));
    }
    check(`the menu fits one row at 1280px with room to spare on all ${pages.length} pages`, pages.length >= 21 && tight.length === 0, tight.join('; '));
    await c.close();

    // ======== the home page ========
    for (const [w, h, m] of [[1440, 900, false], [390, 844, true]]) {
      const hc = await browser.newContext({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m, deviceScaleFactor: m ? 2 : 1 });
      const hp = await hc.newPage();
      const herr = [];
      hp.on('pageerror', (e) => herr.push(e.message));
      await hp.goto(BASE + '/', { waitUntil: 'load' });
      await settled(hp);
      const r = await hp.evaluate(() => {
        const span = (el) => { const x = document.createRange(); x.selectNodeContents(el); return x.getBoundingClientRect(); };
        const t = document.querySelector('.hero-title');
        return { font: [...document.fonts].some((f) => f.family.includes('Bricolage') && f.status === 'loaded'), en: span(t.querySelector('.line-gradient')).width, hi: span(t.querySelector('.hero-title-hi')).width, over: document.documentElement.scrollWidth - innerWidth, repeat: getComputedStyle(document.getElementById('navbar')).backgroundRepeat };
      });
      check(`home ${w}px: the headings are in the brand font`, r.font);
      check(`home ${w}px: the Hindi line sits flush with "Innovation" (within 3%)`, Math.abs(r.en - r.hi) / r.en < 0.03, r.en + ' / ' + r.hi);
      check(`home ${w}px: no sideways scroll, no line under the menu, no errors`, r.over <= 0 && r.repeat === 'no-repeat' && herr.length === 0, JSON.stringify(r) + herr.join(';'));
      await hc.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('crashed: ' + e.message); process.exit(1); });
