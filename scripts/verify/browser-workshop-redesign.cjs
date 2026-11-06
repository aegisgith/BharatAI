// End to end: the redesigned /training-workshop on a phone and a laptop in a real browser, through
// delhi-harness.mjs. No wording was lost from the older page by accident, every effect runs, nothing
// widens the page or hides words, animations off gets the plain page, and with the motion files
// removed every word stays. Run by run-all.mjs.
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8807);
const ROOT = path.join(__dirname, '..', '..');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1306, height: 760 } };
const URL_ = BASE + '/training-workshop';
const settled = async (p) => { await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1300); };
const goTo = async (p, sel, gap = 90) => {
  await p.evaluate(([s, g]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - g), [sel, gap]);
  await p.waitForTimeout(800);
};
const isPlaced = (t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';

// The words of a page, from its source, with script and style taken out.
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;/g, '’').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&copy;/g, '©').replace(/&#8377;/g, '₹');
const bodyOf = (html) => html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const chunks = (html) => bodyOf(html).split(/<[^>]+>/).map((t) => decode(t).replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1);
const flat = (html) => decode(bodyOf(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

(async () => {
  // ======== nothing lost from the older page, except what was meant to go ========
  const backupPath = path.join(ROOT, 'docs', 'page-backups', 'training-workshop-before-redesign-2026-11-06.html');
  const old = fs.readFileSync(backupPath, 'utf8');
  const now = fs.readFileSync(path.join(ROOT, 'public', 'training-workshop.html'), 'utf8');
  const nowText = flat(now);
  // Each of these is a deliberate change, and the organiser is told about them.
  const meant = new Set([
    '🏢 FAANG Engineers', '🎓 PhD Researchers', '🚀 Startup Founders', '📚 Published Authors', '💼 Industry Veterans',
    'Workshop Facilitator', 'Popular', 'New', 'Trending', 'Essential', 'Hands-On', 'Practical', 'Coming soon',
    'Adjunct Faculty, IIT Bombay · Director, Aegis School of Data Science & AI',
    'Master cutting-edge AI technologies through expert-led, hands-on workshops',
    'Expert-Led AI', 'Workshops',
    'Go beyond theory — build real AI applications with guidance from industry practitioners',
    'Code alongside experts using real datasets, live APIs, and production-grade tools — not toy examples',
    'Instructors who build AI at scale — not academics teaching from textbooks',
    'A workshop seat comes with two passes: the', 'Premium Delegate Pass', 'VIP Pass',
    '₹24,999 + GST), one workshop each. Prices went up on 6 Nov and may go up again. Seats are limited and go first come, first served: after you pay, you choose your seat in the app, in a few seconds. The Delegate Pass (',
    ') covers the conference and the networking lunch, without a workshop.', 'Learn from Industry Experts', 'Get Premium Delegate',
    '4 Hours', '90 minutes', '3 Hours', '5 Hours', 'Intermediate', 'Advanced', 'Beginner', 'Topics Covered',
  ]);
  const lost = [...new Set(chunks(old))].filter((c) => !nowText.includes(c) && !meant.has(c));
  check('every sentence of the older page is still on the page, or was meant to go', lost.length === 0, lost.join(' || '));
  for (const s of ['Prices went up on 6 Nov and may go up again.', 'choose your seat in the app, in a few seconds', 'covers the conference and the networking lunch, without a workshop', 'Code alongside experts using real datasets, live APIs, and production-grade tools', 'Instructors who build AI at scale', 'Learn from Industry', 'Topics Covered', 'About the facilitator']) {
    check('the page still says: ' + s, nowText.includes(s));
  }
  check('the page makes no claim of FAANG engineers any more', !/FAANG/.test(now));
  check('the copy of the older page is kept, with no motion in it', !old.includes('workshop-motion'));
  check('and it is not published as a page', !fs.existsSync(path.join(ROOT, 'public', 'docs')));
  const ids = ['cxo-guide', 'fde-workshop', 'asr-workshop', 'llm-fine-tuning', 'cxo-roundtable'];
  const src = fs.readFileSync(path.join(ROOT, 'src', 'index.tsx'), 'utf8');
  for (const id of ids) check('the app\'s link to #' + id + ' still lands on it', src.includes('training-workshop#' + id) && now.includes('id="' + id + '"'));
  check('the footer credits both libraries, which the free Skiper UI licence asks for', /tw-credit[\s\S]{0,120}skiper-ui\.com[\s\S]{0,160}VengeanceUI/.test(now));
  check('the motion files carry the MIT notice', fs.readFileSync(path.join(ROOT, 'public', 'css', 'workshop-motion.css'), 'utf8').includes('Permission is hereby granted, free of charge'));

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ======== the way back: with the motion files blocked, all the words are there ========
    const plainCtx = await browser.newContext(LAPTOP);
    const plain = await plainCtx.newPage();
    await plain.route(/workshop-motion/, (r) => r.abort());
    await plain.goto(URL_, { waitUntil: 'load' });
    await settled(plain);
    const words = (p) => p.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').trim());
    const plainWords = await words(plain);
    check('without the motion files the title is on screen', await plain.evaluate(() => { const r = document.querySelector('h1').getBoundingClientRect(); return r.height > 40 && r.top < innerHeight && getComputedStyle(document.querySelector('h1')).opacity === '1'; }));
    check('without the motion files every workshop can still be opened', await plain.evaluate(() => { const d = document.querySelector('#llm-fine-tuning details'); d.querySelector('summary').click(); return d.open && d.querySelector('.tw-row-body').getBoundingClientRect().height > 40; }));
    await plainCtx.close();

    for (const [name, opts] of [['phone', PHONE], ['laptop', LAPTOP]]) {
      const ctx = await browser.newContext(opts);
      const p = await ctx.newPage();
      const errors = [];
      const missing = [];
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) missing.push(r.url()); });
      await p.goto(URL_, { waitUntil: 'load' });
      await settled(p);

      // ---- the hero ----
      const hero = await p.evaluate(() => {
        const h1 = document.querySelector('h1');
        const link = document.querySelector('.wp-herolink').getBoundingClientRect();
        const buy = document.querySelector('.tw-hero-actions .btn').getBoundingClientRect();
        return {
          size: parseFloat(getComputedStyle(h1).fontSize), font: getComputedStyle(h1).fontFamily,
          loaded: [...document.fonts].some((f) => f.family.includes('Bricolage') && f.status === 'loaded'),
          band: getComputedStyle(document.querySelector('.tw-aurora i')).animationName,
          words: [...h1.querySelectorAll('.tw-w > span')].map((w) => getComputedStyle(w).transform),
          cut: [...h1.querySelectorAll('.tw-w')].some((w) => w.scrollWidth > w.clientWidth + 1),
          link: link.bottom <= innerHeight && link.height >= (matchMedia('(hover: hover)').matches ? 20 : 44),
          buy: buy.bottom <= innerHeight && buy.height >= 44,
          over: document.documentElement.scrollWidth - innerWidth,
        };
      });
      check(name + ': the title is big, whatever style.css does to h1 on a phone', hero.size >= 48, hero.size);
      check(name + ': the title is in the brand font, loaded', hero.font.includes('Bricolage') && hero.loaded, hero.font);
      check(name + ': the aurora is moving', hero.band === 'tw-drift', hero.band);
      check(name + ': the title has risen into place, no word cut off', hero.words.length === 2 && hero.words.every(isPlaced) && !hero.cut, hero.words.join());
      check(name + ': the buy button and the call for partners are on the first screen', hero.buy && hero.link, JSON.stringify(hero));
      check(name + ': no sideways scroll at the top', hero.over <= 0, hero.over);

      // ---- who teaches: one face in colour at a time, passing on by itself ----
      await goTo(p, '.tw-tiles');
      const faces = () => p.evaluate(() => [...document.querySelectorAll('.tw-tile')].map((t) => getComputedStyle(t.querySelector('img')).filter !== 'none' ? 0 : 1));
      const first = await faces();
      check(name + ': one face is in colour, the others are not', first.reduce((a, b) => a + b, 0) === 1, first.join());
      await p.waitForTimeout(3100);
      const second = await faces();
      check(name + ': the colour passes on by itself', second.join() !== first.join() && second.reduce((a, b) => a + b, 0) === 1, second.join());
      check(name + ': each face links to its workshop', await p.evaluate(() => [...document.querySelectorAll('.tw-tile')].every((a) => document.querySelector(a.getAttribute('href')))));
      if (name === 'phone') await p.tap('.tw-tile[href="#asr-workshop"]');
      else await p.click('.tw-tile[href="#asr-workshop"]');
      await p.waitForTimeout(1200);
      check(name + ': choosing a face lands on the workshop, under the menu', await p.evaluate(() => { const r = document.getElementById('asr-workshop').getBoundingClientRect(); const bar = document.getElementById('confSubnav').getBoundingClientRect(); return r.top >= bar.bottom - 2 && r.top < innerHeight / 2; }), await p.evaluate(() => document.getElementById('asr-workshop').getBoundingClientRect().top));

      // ---- the stacked cards ----
      const stack = await p.evaluate(async () => {
        const list = document.querySelector('.format-list');
        const cards = [...list.querySelectorAll('.format-row')];
        const top = list.getBoundingClientRect().top + scrollY;
        window.scrollTo(0, top + cards[1].offsetTop - innerHeight * 0.25);
        await new Promise((r) => setTimeout(r, 500));
        return {
          sticky: getComputedStyle(cards[0]).position, scaled: getComputedStyle(cards[0]).transform,
          fit: cards.every((c) => c.offsetHeight < innerHeight - 40), tall: cards.map((c) => c.offsetHeight),
          over: document.documentElement.scrollWidth - innerWidth,
        };
      });
      check(name + ': the cards stick and stack', stack.sticky === 'sticky', stack.sticky);
      check(name + ': the card underneath shrinks as the next one comes', stack.scaled !== 'none', stack.scaled);
      check(name + ': every card fits on the screen, so none hides its words', stack.fit, stack.tall.join());
      check(name + ': no sideways scroll in the cards', stack.over <= 0, stack.over);

      // ---- a workshop: the detail opens on a tap ----
      await goTo(p, '#llm-fine-tuning');
      const row = p.locator('#llm-fine-tuning .tw-row summary').first();
      check(name + ': the rows start closed', await p.evaluate(() => [...document.querySelectorAll('#sessions details')].every((d) => !d.open)));
      const tall = await row.boundingBox();
      check(name + ': a row is big enough to tap', tall.height >= 44, tall.height);
      if (name === 'phone') await row.tap(); else await row.click();
      await p.waitForTimeout(600);
      const opened = await p.evaluate(() => { const d = document.querySelector('#llm-fine-tuning details'); const li = d.querySelector('li').getBoundingClientRect(); return { open: d.open, h: li.height, w: li.width }; });
      check(name + ': a tap opens it and the words show', opened.open && opened.h > 10 && opened.w > 100, JSON.stringify(opened));
      if (name === 'phone') await row.tap(); else await row.click();
      await p.waitForTimeout(600);
      check(name + ': a second tap closes it', await p.evaluate(() => !document.querySelector('#llm-fine-tuning details').open));

      // ---- the menu's light follows the page, in the page's own order ----
      const light = () => p.evaluate(() => {
        const a = document.querySelector('.conf-subnav-link.active');
        const l = document.querySelector('.tw-light').getBoundingClientRect();
        const r = a.getBoundingClientRect();
        return { on: a.textContent.trim(), gap: Math.abs(l.left - r.left), w: Math.abs(l.width - r.width), inside: r.left >= -1 && r.right <= innerWidth + 1 };
      });
      for (const [sel, label] of [['#cxo-guide', 'CXO Guide'], ['#fde-workshop', 'Prototype to Production'], ['#llm-fine-tuning', 'LLM Fine-Tuning'], ['#cxo-roundtable', 'CXO Roundtable'], ['#passes', 'Passes'], ['#workshop-partners', 'Lead a Workshop']]) {
        await goTo(p, sel);
        const s = await light();
        check(name + ': at ' + label + ', its link is lit, the light under it, in view', s.on === label && s.gap < 2 && s.w < 2 && s.inside, JSON.stringify(s));
      }

      // ---- the people who should attend ----
      await goTo(p, '.tw-audience', 200);
      const roleNow = () => p.evaluate(() => document.querySelector('.track-tag.is-on').textContent);
      const roleA = await roleNow();
      await p.waitForTimeout(2100);
      check(name + ': the highlight passes along the roles', (await roleNow()) !== roleA);
      check(name + ': the highlighted role is readable and the highlight is behind it', await p.evaluate(() => { const t = document.querySelector('.track-tag.is-on'); const g = document.querySelector('.tw-glide').getBoundingClientRect(); const r = t.getBoundingClientRect(); return getComputedStyle(t).color === 'rgb(255, 255, 255)' && Math.abs(g.left - r.left) < 3 && Math.abs(g.top - r.top) < 3; }));

      // ---- the passes ----
      await goTo(p, '#passes');
      const pass = await p.evaluate(() => {
        const cards = [...document.querySelectorAll('.tw-pass')];
        const b = cards[0].querySelector('.btn').getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, Math.min(b.top + b.height / 2, innerHeight - 2));
        return {
          text: cards.map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
          links: cards.map((c) => c.querySelector('.btn').getAttribute('href')),
          glow: getComputedStyle(cards[0], '::before').animationName,
          pressable: cards[0].querySelector('.btn').contains(top) || b.top + b.height / 2 > innerHeight,
        };
      });
      check(name + ': Premium is struck through to today\'s price', pass.text[0].includes('₹9,999 ₹14,999 + GST'), pass.text[0]);
      check(name + ': VIP is struck through to today\'s price', pass.text[1].includes('₹19,999 ₹24,999 + GST'), pass.text[1]);
      check(name + ': each button goes to its pass', pass.links[0] === '/register#premium' && pass.links[1] === '/register#vip', pass.links.join());
      check(name + ': the edge of the Premium card is turning, and its button still takes a press', pass.glow === 'tw-turn' && pass.pressable, JSON.stringify(pass));
      check(name + ': the old prices are really struck through', await p.evaluate(() => [...document.querySelectorAll('.tw-price s')].every((s) => getComputedStyle(s).textDecorationLine === 'line-through')));

      // ---- the last heading ----
      const gatherAt = await p.evaluate(() => { const h = document.querySelector('.cta-section h2'); return { label: h.getAttribute('aria-label'), text: h.textContent.replace(/\s+/g, ' ').trim() }; });
      check(name + ': the last heading reads whole to a screen reader', gatherAt.label === 'Ready to Master AI Technologies?' && gatherAt.text === gatherAt.label, JSON.stringify(gatherAt));
      await p.evaluate(() => window.scrollTo(0, document.querySelector('.cta-section h2').getBoundingClientRect().top + scrollY - innerHeight + 10));
      await p.waitForTimeout(400);
      const scattered = await p.evaluate(() => [...document.querySelectorAll('.tw-ch')].filter((c) => !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(c).transform)).length);
      check(name + ': its letters are scattered as it comes up from the bottom', scattered > 5, scattered);
      await goTo(p, '.cta-section', 80);
      const placed = await p.evaluate(() => {
        const letters = [...document.querySelectorAll('.tw-ch')];
        const b = document.querySelector('.cta-section .btn-primary');
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          still: letters.filter((c) => !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(c).transform)).length,
          dim: letters.filter((c) => parseFloat(getComputedStyle(c).opacity) < 0.99).length,
          beam: CSS.supports('offset-path', 'rect(0 auto auto 0)') ? getComputedStyle(b.querySelector('.tw-beam'), '::after').animationName : 'tw-beam',
          pressable: b === hit || b.contains(hit), href: b.getAttribute('href'),
        };
      });
      check(name + ': the letters are all in place where it is read', placed.still === 0 && placed.dim === 0, JSON.stringify(placed));
      check(name + ': the light travels round the last button, and it still takes a press', placed.beam === 'tw-beam' && placed.pressable && placed.href === '/register#premium', JSON.stringify(placed));

      // ---- off the screen, nothing keeps moving ----
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(500);
      check(name + ': the beam and the card\'s edge stop off the screen', await p.evaluate(() => document.querySelector('.cta-section').classList.contains('tw-off') && document.querySelector('.tw-pass--lead').classList.contains('tw-off')));

      // ---- from top to bottom ----
      const walk = await p.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.6) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); }
        await new Promise((r) => setTimeout(r, 900));
        const bad = [...document.querySelectorAll('main *, section *')].filter((e) => {
          if (e.closest('.wp-hp') || e.closest('[hidden]') || e.closest('.tw-aurora') || e.closest('.conf-subnav-links') || e.classList.contains('page-header-orb')) return false;
          if (e.closest('details') && !e.closest('details').open && !e.closest('summary')) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
        }).map((e) => e.tagName + '.' + e.className);
        return {
          unseen: [...document.querySelectorAll('.tw-split:not(.tw-in)')].map((h) => h.textContent.trim()),
          over: document.documentElement.scrollWidth - innerWidth,
          bad: bad.slice(0, 8),
          broken: [...document.images].filter((i) => i.complete && !i.naturalWidth).map((i) => i.src),
        };
      });
      check(name + ': scrolling down shows every heading', walk.unseen.length === 0, walk.unseen.join());
      check(name + ': no sideways scroll anywhere', walk.over <= 0, walk.over);
      check(name + ': nothing runs off the screen', walk.bad.length === 0, walk.bad.join(', '));
      check(name + ': no broken photo', walk.broken.length === 0, walk.broken.join());
      check(name + ': the same words with the motion on as without', (await words(p)) === plainWords, 'differs');
      check(name + ': no script errors', errors.length === 0, errors.join());
      check(name + ': no missing files', missing.length === 0, missing.join());
      await ctx.close();
    }

    // ======== a short screen: the cards do not stick, so nothing can hide ========
    const shortCtx = await browser.newContext({ ...PHONE, viewport: { width: 360, height: 640 } });
    const short = await shortCtx.newPage();
    await short.goto(URL_, { waitUntil: 'load' });
    await settled(short);
    check('a short phone: the cards simply follow one another', await short.evaluate(() => getComputedStyle(document.querySelector('.format-row')).position === 'static'));
    check('a short phone: no sideways scroll', await short.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shortCtx.close();

    // ======== animations off: nothing moves and nothing is hidden ========
    const ctx = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(URL_, { waitUntil: 'load' });
    await settled(p);
    const still = await p.evaluate(() => ({
      added: document.querySelectorAll('.tw-split, .tw-light, .tw-beam, .tw-glide, .tw-ch, .tw-live').length,
      band: getComputedStyle(document.querySelector('.tw-aurora i')).animationName,
      words: [...document.querySelectorAll('h1 .tw-w > span')].map((w) => getComputedStyle(w).transform),
      card: getComputedStyle(document.querySelector('.format-row')).position,
      faces: [...document.querySelectorAll('.tw-tile img')].map((i) => getComputedStyle(i).filter),
      line: getComputedStyle(document.querySelector('.conf-subnav-link.active')).borderBottomColor,
    }));
    check('animations off: the script adds nothing', still.added === 0, still.added);
    check('animations off: the aurora is still', still.band === 'none', still.band);
    check('animations off: the title stands in place', still.words.every((t) => t === 'none'), still.words.join());
    check('animations off: the cards do not stick', still.card === 'static', still.card);
    check('animations off: every face is in colour', still.faces.every((f) => f === 'none'), still.faces.join());
    check('animations off: the plain underline marks the workshop', still.line !== 'rgba(0, 0, 0, 0)', still.line);
    check('animations off: the same words', (await words(p)) === plainWords);
    await p.locator('#fde-workshop .tw-row summary').first().tap();
    await p.waitForTimeout(200);
    check('animations off: a row still opens on a tap', await p.evaluate(() => document.querySelector('#fde-workshop details').open && document.querySelector('#fde-workshop details li').getBoundingClientRect().height > 10));
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
