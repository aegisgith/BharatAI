// End to end: a phone and a laptop in a real browser on /government, through
// delhi-harness.mjs (the real worker and real SQLite behind the form; it is not Delhi
// specific). Animations are off on the phone (style.css disables them for people who
// turned them off, and the page must still show everything). Also: the Govt tab fits the
// bar and opens the page from another page, on a laptop and from the phone menu.
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8788);
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' };
const settled = async (p) => { await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1000); };
const fill = async (page, v) => { for (const [id, val] of Object.entries(v)) await page.fill('#gv-' + id, val); };

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

    // From the phone menu on the home page
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.click('#nav-toggle');
    await page.waitForTimeout(400);
    await page.click('#nav-menu a[href="/government"]');
    await page.waitForURL('**/government');
    await settled(page);
    check('the phone menu opens the page from the home page', page.url().endsWith('/government') && (await page.textContent('h1')).includes('1.4 billion'));

    const hero = await page.evaluate(() => {
      const i = document.querySelector('.gv-figure img');
      const b = document.querySelector('.gv-actions .btn').getBoundingClientRect();
      return { src: i.currentSrc, w: i.naturalWidth, over: document.documentElement.scrollWidth - innerWidth, btn: b.bottom, vh: innerHeight, font: getComputedStyle(document.querySelector('h1')).fontFamily };
    });
    check('the phone gets the small photograph', /governance-panel-820/.test(hero.src) && hero.w > 0, JSON.stringify(hero));
    check('no sideways scroll on a phone', hero.over <= 0, hero.over);
    check('the first button is on the first screen', hero.btn <= hero.vh, hero.btn);
    check('the heading is in the brand font, loaded', hero.font.includes('Bricolage') && await page.evaluate(() => [...document.fonts].some((f) => f.family.includes('Bricolage') && f.status === 'loaded')));

    await page.click('#nav-toggle');
    await page.waitForTimeout(400);
    check('Govt shows as the current tab in the phone menu', await page.locator('#nav-menu a[href="/government"].active').isVisible());
    await page.click('#nav-toggle');
    await page.waitForTimeout(300);

    // Past the hero the bar follows; at the form it steps aside.
    await page.evaluate(() => { const y = document.querySelector('.gv-rows').getBoundingClientRect().top + scrollY - 90; window.scrollTo(0, y); });
    await page.waitForTimeout(500);
    check('past the hero the bar follows the reader', await page.locator('#stickyCta.is-on').count() === 1);
    check('and its button can be reached by keyboard', await page.getAttribute('#stickyCta a', 'tabindex') === '0');
    await page.click('#stickyCta a');
    await page.waitForTimeout(900);
    check('the bar\'s button goes to the form, and it steps aside there', await page.locator('#stickyCta.is-on').count() === 0 && await page.locator('#gv-form').isVisible());

    // Everything appears, every picture loads, no face cut off by the phone's row
    for (const sel of ['.gv-rows', '.gv-stars', '.gv-faces', '.gv-tiles', '.gv-more', '.gv-shows', '.gv-acc', '.gv-chips', '.gv-faq']) {
      await page.locator(sel).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }
    const faces = page.locator('.gv-faces li');
    for (let i = 0; i < await faces.count(); i += 2) { await faces.nth(i).scrollIntoViewIfNeeded(); await page.waitForTimeout(150); }
    await page.locator('.gv-faces li').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20000 }).catch(() => {});
    check('sections show with animations off', await page.evaluate(() => ['.gv-rows', '.gv-stars', '.gv-tiles', '.gv-acc', '.gv-nom-intro'].every((s) => getComputedStyle(document.querySelector(s)).opacity === '1')));
    check('every picture loads', await page.evaluate(() => [...document.images].every((i) => i.naturalWidth > 0)), await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src).join(', ')));
    check('the eight faces swipe on one row, and the page itself does not', await page.evaluate(() => { const f = document.querySelector('.gv-faces'); return f.scrollWidth > f.clientWidth && new Set([...f.children].map((c) => Math.round(c.getBoundingClientRect().top))).size === 1 && document.documentElement.scrollWidth <= innerWidth; }));
    check('every icon draws (an icon missing from the font is blank)', await page.evaluate(() => [...document.querySelectorAll('.gv-more i, .gv-acc .ic')].every((i) => getComputedStyle(i, '::before').content !== 'none')));
    check('tap targets on the form are big enough', await page.evaluate(() => [...document.querySelectorAll('.gv-field input, .gv-field textarea, .gv-submit, .gv-fmt span')].every((e) => e.getBoundingClientRect().height >= 44)));

    // Sectors and questions open
    const opened = async (sel, n) => {
      const d = page.locator(sel + ' details');
      for (let i = 0; i < await d.count(); i++) await d.nth(i).locator('summary').click();
      return page.evaluate(([s, c]) => { const x = [...document.querySelectorAll(s + ' details')]; return x.length === c && x.every((e) => e.open); }, [sel, n]);
    };
    check('all seven sectors open', await opened('.gv-acc', 7));
    check('all six questions open', await opened('.gv-faq', 6));

    // The exhibition links tick their box and land on the form
    await page.click('.gv-show a[data-format="Government Pavilion"]');
    await page.waitForTimeout(900);
    check('"Ask for a place in the pavilion" ticks it and lands on the form', await page.isChecked('input[value="Government Pavilion"]') && await page.evaluate(() => { const r = document.getElementById('nominate').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
    await page.click('.gv-show a[data-format="Incubated Startups Showcase"]');
    await page.waitForTimeout(900);
    check('"Showcase your startups" ticks its box too, and keeps the first', await page.isChecked('input[value="Incubated Startups Showcase"]') && await page.isChecked('input[value="Government Pavilion"]'));
    await page.locator('label.gv-fmt', { hasText: 'Government Pavilion' }).click();
    await page.locator('label.gv-fmt', { hasText: 'Incubated Startups Showcase' }).click();

    // The form, for real
    await page.locator('#gv-submit').scrollIntoViewIfNeeded();
    await page.click('#gv-submit');
    check('empty: asks for the Ministry, under its box, on screen', (await page.textContent('#gv-error')).includes('Ministry') && await page.locator('#gv-error').isVisible() && await page.evaluate(() => document.getElementById('gv-error').parentNode === document.getElementById('gv-org').parentNode && document.activeElement.id === 'gv-org'));
    await fill(page, { org: 'Ministry of Tribal Affairs', initiative: 'Adi Vaani', about: 'Translates tribal languages for citizens.', name: 'Asha Rao', designation: 'Deputy Secretary', email: 'asha@' });
    await page.click('#gv-submit');
    check('bad email: says so, under the email box', (await page.textContent('#gv-error')).includes('email') && await page.evaluate(() => document.getElementById('gv-error').parentNode === document.getElementById('gv-email').parentNode));
    await page.fill('#gv-email', 'asha.rao@example.gov.in');
    await page.click('#gv-submit');
    check('no number: says so', (await page.textContent('#gv-error')).includes('contact number'));
    await page.fill('#gv-phone', '011 2338 1234');
    await page.locator('label.gv-fmt', { hasText: 'Live Demonstration' }).click();
    await page.locator('label.gv-fmt', { hasText: 'Launch' }).click();
    await page.locator('label.gv-fmt', { hasText: 'Launch' }).click();
    await page.locator('label.gv-fmt', { hasText: 'Government Pavilion' }).click();
    check('tapping formats chooses and unchooses them', await page.evaluate(() => [...document.querySelectorAll('input[name="format"]:checked')].map((c) => c.value).sort().join('|')) === 'Government Pavilion|Live Demonstration');
    await page.click('#gv-submit');
    await page.waitForSelector('#gv-done:not([hidden])');
    check('the thank-you names the officer and the email', /Asha Rao.*asha\.rao@example\.gov\.in/.test(await page.textContent('#gv-done-text')));
    check('and the form has gone', !(await page.locator('#gv-form').isVisible()));
    const saved = await (await ctx.request.get(BASE + '/__inquiries')).json();
    check('it really landed in the database', saved.length === 1 && saved[0].inquiry_type === 'government' && saved[0].subject === 'Govt AI · Adi Vaani' && saved[0].organization === 'Ministry of Tribal Affairs' && saved[0].message.includes('Live Demonstration, Government Pavilion'), JSON.stringify(saved));
    const mail = await (await ctx.request.get(BASE + '/__mail')).json();
    check('and the team was emailed once', mail.length === 1 && mail[0].Content.ReplyTo.includes('asha.rao@example.gov.in'), mail.length);

    const lost = missing.filter((u) => !u.includes('/api/'));
    check('no missing files', lost.length === 0, lost.join(', '));
    check('no page errors on the phone', errors.length === 0, errors.join('; '));
    await ctx.close();

    // ======== sizes ========
    for (const [w, h] of [[360, 740], [820, 1180], [1280, 720], [1306, 760], [1440, 900], [1920, 1080]]) {
      const c = await browser.newContext({ viewport: { width: w, height: h } });
      const p = await c.newPage();
      await p.goto(BASE + '/government', { waitUntil: 'load' });
      await settled(p);
      const r = await p.evaluate(() => {
        const bad = [...document.querySelectorAll('h1,h2,h3,p,a.btn,button,.gv-rows li,.gv-tile,.gv-more li,.gv-show')].filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.right > innerWidth + 1 || x.left < -1); }).map((e) => e.textContent.trim().slice(0, 30));
        return { over: document.documentElement.scrollWidth - innerWidth, bad, btn: document.querySelector('.gv-actions .btn').getBoundingClientRect().bottom, vh: innerHeight };
      });
      check(`${w}px: nothing runs off the screen`, r.over <= 0 && r.bad.length === 0, JSON.stringify(r));
      check(`${w}px: the first button is on the first screen`, r.btn <= r.vh, r.btn);
      await c.close();
    }

    // ======== /exhibition's band ========
    for (const [w, h, m] of [[390, 844, true], [1306, 760, false]]) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m, reducedMotion: 'reduce' });
      const p = await c.newPage();
      await p.goto(BASE + '/exhibition', { waitUntil: 'domcontentloaded' });
      await settled(p);
      await p.locator('#government').scrollIntoViewIfNeeded();
      await p.waitForTimeout(300);
      const r = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, n: document.querySelectorAll('#government a.gov-exh').length, op: getComputedStyle(document.querySelector('.gov-exh')).opacity, icon: getComputedStyle(document.querySelector('.gov-exh i'), '::before').content }));
      check(`/exhibition ${w}px: the government band shows both, nothing runs off`, r.over <= 0 && r.n === 2 && r.op === '1' && r.icon !== 'none', JSON.stringify(r));
      await p.click('#government a.green');
      await p.waitForURL('**/government#exhibition');
      await p.waitForTimeout(800);
      check(`/exhibition ${w}px: it leads to the section on /government`, await p.evaluate(() => { const r = document.getElementById('exhibition').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
      await c.close();
    }

    // ======== the laptop ========
    {
      const c = await browser.newContext({ viewport: { width: 1306, height: 760 } });
      const p = await c.newPage();
      await p.goto(BASE + '/delhi', { waitUntil: 'domcontentloaded' });
      await p.click('#nav-menu a[href="/government"]');
      await p.waitForURL('**/government');
      await settled(p);
      check('laptop: the Govt tab opens the page from /delhi, and is the current tab', p.url().endsWith('/government') && await p.locator('#nav-menu a[href="/government"].active').isVisible());
      const r = await p.evaluate(() => {
        const copy = document.querySelector('.gv-hero-copy').getBoundingClientRect();
        const fig = document.querySelector('.gv-figure').getBoundingClientRect();
        const clear = [...document.querySelectorAll('.gv-rows li')].every((li) => { const x = document.createRange(); x.selectNodeContents(li.querySelector('b')); return x.getBoundingClientRect().right <= li.querySelector('span').getBoundingClientRect().left; });
        return { side: copy.right <= fig.left, clear, faces: new Set([...document.querySelectorAll('.gv-faces li')].map((l) => Math.round(l.getBoundingClientRect().top))).size };
      });
      check('laptop: the words stand beside the photograph', r.side);
      check('laptop: the big words never run into their lines', r.clear);
      check('laptop: all eight faces stand on one row', r.faces === 1, r.faces);
      await c.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('crashed: ' + e.message); process.exit(1); });
