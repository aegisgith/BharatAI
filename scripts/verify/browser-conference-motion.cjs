// End to end: /conference on a phone and a laptop in a real browser, through delhi-harness.mjs.
// The effects run, nothing widens the page or hides words, animations off gets the plain page,
// and removing the motion files (the way back) leaves every word in place. Run by run-all.mjs.
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8786);
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1306, height: 760 } };
const settled = async (p) => { await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1300); };
const text = (p) => p.evaluate(() => [...document.querySelectorAll('h1, h2')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
const goTo = async (p, sel) => {
  await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), sel);
  await p.waitForTimeout(1100);
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ======== the way back: what the page says, read from the page with the motion files blocked ========
    const plainCtx = await browser.newContext(LAPTOP);
    const plain = await plainCtx.newPage();
    await plain.route(/conference-motion/, (r) => r.abort());
    await plain.goto(BASE + '/conference', { waitUntil: 'load' });
    await settled(plain);
    const plainText = await text(plain);
    check('without the motion files the headings are all there', /Bharat AI Innovation ?Conference 2026/.test(plainText) && /Event Schedule/.test(plainText) && /Be There\./.test(plainText), plainText);
    check('without the motion files the title is on screen', await plain.evaluate(() => { const r = document.querySelector('h1').getBoundingClientRect(); return r.height > 20 && r.top < innerHeight; }));
    await plainCtx.close();

    const backup = path.join(__dirname, '..', '..', 'docs', 'page-backups', 'conference-before-motion-2026-11-06.html');
    check('the copy of the older page is kept, with no motion in it', fs.existsSync(backup) && !fs.readFileSync(backup, 'utf8').includes('conference-motion'));
    check('the copy is not served as a page', (await (await browser.newContext()).request.get(BASE + '/docs/page-backups/conference-before-motion-2026-11-06.html')).status() !== 200 || !fs.existsSync(path.join(__dirname, '..', '..', 'public', 'docs')));

    for (const [name, opts] of [['phone', PHONE], ['laptop', LAPTOP]]) {
      const ctx = await browser.newContext(opts);
      const p = await ctx.newPage();
      const errors = [];
      const missing = [];
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) missing.push(r.url()); });
      await p.goto(BASE + '/conference', { waitUntil: 'load' });
      await settled(p);

      check(name + ': same headings with the motion on', (await text(p)) === plainText, await text(p));
      const hero = await p.evaluate(() => {
        const band = document.querySelector('.cf-aurora i');
        const h1 = document.querySelector('h1');
        return {
          anim: getComputedStyle(band).animationName,
          words: [...h1.querySelectorAll('.cf-w > span')].map((w) => getComputedStyle(w).transform),
          cut: [...h1.querySelectorAll('.cf-w')].some((w) => w.scrollWidth > w.clientWidth + 1),
          over: document.documentElement.scrollWidth - innerWidth,
        };
      });
      check(name + ': the aurora is moving', hero.anim === 'cf-drift', hero.anim);
      check(name + ': the title has risen into place', hero.words.length === 5 && hero.words.every((t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'), hero.words.join());
      check(name + ': no title word is cut off', !hero.cut);
      check(name + ': no sideways scroll at the top', hero.over <= 0, hero.over);

      // A heading stays down until it is reached, then comes up.
      const before = await p.evaluate(() => getComputedStyle(document.querySelector('#speakers h2 .cf-w > span')).transform);
      check(name + ': a heading further down waits', before !== 'none', before);
      await goTo(p, '#speakers');
      const after = await p.evaluate(() => {
        const h = document.querySelector('#speakers h2');
        return { done: h.classList.contains('cf-in'), t: [...h.querySelectorAll('.cf-w > span')].map((w) => getComputedStyle(w).transform) };
      });
      check(name + ': the heading comes up when reached', after.done && after.t.every((t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'), JSON.stringify(after));

      // The light under the sub-menu follows the page, in the page's own order.
      const light = async () => p.evaluate(() => {
        const a = document.querySelector('.conf-subnav-link.active');
        const l = document.querySelector('.cf-light').getBoundingClientRect();
        const r = a.getBoundingClientRect();
        return { on: a.textContent.trim(), gap: Math.abs(l.left - r.left), w: Math.abs(l.width - r.width) };
      });
      let s = await light();
      check(name + ': in Speakers, the Speakers link is lit and the light is under it', s.on === 'Speakers' && s.gap < 2 && s.w < 2, JSON.stringify(s));
      await goTo(p, '#schedule');
      s = await light();
      check(name + ': in Schedule, the light has moved to Schedule', s.on === 'Schedule' && s.gap < 2 && s.w < 2, JSON.stringify(s));
      await goTo(p, '#speakers');
      check(name + ': the lit link is inside the screen, even at the end of the menu', await p.evaluate(() => { const r = document.querySelector('.conf-subnav-link.active').getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }));

      // The button at the foot of the page, and everything still pressable.
      await goTo(p, '.registration-cta');
      const cta = await p.evaluate(() => {
        const b = document.querySelector('.registration-cta .btn-primary');
        const beam = b.querySelector('.cf-beam');
        const c = b.getBoundingClientRect();
        const top = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
        return { supports: CSS.supports('offset-path', 'rect(0 auto auto 0)') && CSS.supports('mask-composite', 'intersect'), anim: getComputedStyle(beam, '::after').animationName, pressable: b === top || b.contains(top), href: b.getAttribute('href') };
      });
      check(name + ': the light travels round the button', cta.supports && cta.anim === 'cf-beam', JSON.stringify(cta));
      check(name + ': the button still takes a press and goes to the pass', cta.pressable && cta.href === '/register#delegate', JSON.stringify(cta));

      // Off the screen, nothing keeps moving.
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(400);
      check(name + ': the beam stops once off the screen', await p.evaluate(() => document.querySelector('.registration-cta').classList.contains('cf-off') && getComputedStyle(document.querySelector('.cf-beam'), '::after').animationPlayState === 'paused'));
      await goTo(p, '.registration-cta');
      check(name + ': the aurora stops once off the screen', await p.evaluate(() => getComputedStyle(document.querySelector('.cf-aurora i')).animationPlayState === 'paused'));

      // Every heading on the way, then the widest moment of the page.
      const unseen = await p.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.7) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        await new Promise((r) => setTimeout(r, 900));
        return { left: [...document.querySelectorAll('.cf-split:not(.cf-in)')].map((h) => h.textContent.trim()), over: document.documentElement.scrollWidth - innerWidth };
      });
      check(name + ': scrolling down shows every heading', unseen.left.length === 0, unseen.left.join());
      check(name + ': no sideways scroll anywhere', unseen.over <= 0, unseen.over);
      check(name + ': no script errors', errors.length === 0, errors.join());
      check(name + ': no missing files', missing.length === 0, missing.join());
      await ctx.close();
    }

    // ======== animations off: nothing moves and nothing is hidden ========
    const ctx = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(BASE + '/conference', { waitUntil: 'load' });
    await settled(p);
    const still = await p.evaluate(() => ({
      split: document.querySelectorAll('.cf-split').length,
      light: document.querySelectorAll('.cf-light').length,
      beam: document.querySelectorAll('.cf-beam').length,
      band: getComputedStyle(document.querySelector('.cf-aurora i')).animationName,
      words: [...document.querySelectorAll('h1 .cf-w > span')].map((w) => getComputedStyle(w).transform),
      line: getComputedStyle(document.querySelector('.conf-subnav-link.active')).borderBottomColor,
    }));
    check('animations off: the script adds nothing', still.split === 0 && still.light === 0 && still.beam === 0, JSON.stringify(still));
    check('animations off: the aurora is still', still.band === 'none', still.band);
    check('animations off: the title stands in place', still.words.length === 5 && still.words.every((t) => t === 'none'), still.words.join());
    check('animations off: the plain underline marks the section', still.line !== 'rgba(0, 0, 0, 0)', still.line);
    check('animations off: same headings', (await text(p)) === plainText);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
