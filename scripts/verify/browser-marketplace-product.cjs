// End to end: the redesigned marketplace product page on a phone and a laptop in a real browser, on
// made-up listings through mk-browse-harness.mjs. The inquiry first and in the bar, folded sections,
// Read more, more like this, hostile text, not found, animations off. Run by run-all.mjs.
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8814);
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1366, height: 800 } };
const RICH = '/marketplace/listing/rich-co/rich-product';
const open = async (ctx, path) => {
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/401|404|500/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(BASE + path, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1300);
  return p;
};
const box = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; }, sel);
const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= 391);
const toEl = async (p, sel, gap = 40) => { await p.evaluate(([s, g]) => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - g); }, [sel, gap]); await p.waitForTimeout(600); };
const barUp = (p) => p.locator('#pd-bar').evaluate((b) => b.classList.contains('is-up') && getComputedStyle(b).visibility === 'visible');

(async () => {
  await fetch(BASE + '/api/__mode?m=ok');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ======== on a phone ========
  const phone = await browser.newContext(PHONE);
  let p = await open(phone, RICH);
  check('phone: the title reads whole', (await p.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === 'Rich Product', await p.locator('h1').innerText());
  check('phone: the title is big and in the heading font', await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.pd-title .mk-w > span')); return parseFloat(s.fontSize) >= 36 && /Bricolage/.test(s.fontFamily); }));
  check('phone: no sideways scroll', await fits(p));
  const heroBtns = await p.locator('.pd-actions .pd-btn').allInnerTexts();
  check('phone: Send inquiry comes first', /Send inquiry/.test(heroBtns[0]) && /Visit website/.test(heroBtns[1]), heroBtns.join('|'));
  check('phone: Send inquiry is the coloured one', await p.locator('.pd-actions .pd-btn').first().evaluate((e) => e.classList.contains('pd-btn--primary')));

  // White on a button at this size needs 4.5:1. #D95600 was 3.98:1.
  const ratio = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05); };
  const productBtn = ratio(await p.locator('.pd-actions .pd-btn--primary').evaluate((e) => getComputedStyle(e).backgroundColor));
  check('phone: white on the main button is readable, 4.5:1 or better', productBtn >= 4.5, productBtn.toFixed(2));
  check('phone: the website still opens in a new tab', (await p.locator('.pd-actions .pd-btn').nth(1).getAttribute('target')) === '_blank');
  check('phone: both buttons are on the first screen', (await box(p, '.pd-actions')).bottom < 844);
  check('phone: price and booth show at the top', /From INR 99 a month/.test(await p.locator('.pd-badges').innerText()) && /Booth B7/.test(await p.locator('.pd-badges').innerText()));
  check('phone: List your product is in reach', (await box(p, '.mk-auth a')).right <= 390);
  check('phone: Home goes to the main website', (await p.locator('.mp-nav-link', { hasText: 'Home' }).getAttribute('href')) === '/');

  // Bar
  check('phone: no bar while the hero\'s buttons show', !(await barUp(p)));
  await toEl(p, '#about', 0);
  check('phone: the bar comes up once they scroll away', await barUp(p));
  const bar = await p.locator('#pd-bar .pd-btn').allInnerTexts();
  check('phone: the bar has both buttons', /Send inquiry/.test(bar[0]) && /Visit website/.test(bar[1]), bar.join('|'));
  const barBox = await box(p, '#pd-bar');
  check('phone: it sits at the foot of the screen', Math.abs(barBox.bottom - 844) <= 2, barBox.bottom);
  check('phone: its buttons are big enough', (await p.locator('#pd-bar .pd-btn').first().evaluate((e) => e.getBoundingClientRect().height)) >= 44);
  await p.locator('#pd-bar .pd-btn--primary').tap();
  await p.waitForTimeout(1500);
  const form = await box(p, '#inquire');
  check('phone: it goes to the form', form.top < 844 && form.bottom > 0, JSON.stringify(form));
  check('phone: and leaves, so it never covers the form', !(await barUp(p)));

  // Sections
  await toEl(p, '#about', 0);
  const clampH = (await box(p, '.pd-clamp')).h;
  check('phone: a long description stops short', clampH < 300, clampH);
  check('phone: with Read more', await p.locator('.pd-more-text').isVisible());
  await p.locator('.pd-more-text').tap();
  await p.waitForTimeout(200);
  check('phone: Read more shows all of it', (await box(p, '.pd-clamp')).h > clampH + 100 && (await p.locator('.pd-more-text').innerText()) === 'Show less');
  check('phone: every paragraph is there', /Paragraph 9 of the description/.test(await p.locator('.pd-clamp').innerText()));
  check('phone: use cases read as a list', (await p.locator('#use-cases li').count()) === 3, await p.locator('#use-cases li').count());
  check('phone: technical details start folded', !(await p.locator('#technical').evaluate((d) => d.open)));
  check('phone: and service and support', !(await p.locator('#support').evaluate((d) => d.open)));
  await p.locator('#technical summary').tap();
  await p.waitForTimeout(500);
  check('phone: a tap opens them', /An API key/.test(await p.locator('#technical').innerText()));
  check('phone: a review opens its section with a count', (await p.locator('#reviews').evaluate((d) => d.open)) && /Reviews \(1\)/.test(await p.locator('#reviews summary').innerText()));
  check('phone: the image holds a sensible height', (await box(p, '.pd-product-image')).h <= 430, (await box(p, '.pd-product-image')).h);
  check('phone: screenshots go sideways without widening the page', await fits(p));

  // Facts and links
  check('phone: the laptop\'s panel is not shown', !(await p.locator('.pd-cta').isVisible()));
  const link = p.locator('.pd-access a');
  check('phone: a web address in a field becomes a link', (await link.count()) === 1 && (await link.getAttribute('href')) === 'https://rich.example/start/');
  check('phone: anything else in it stays words', /javascript:alert\(1\)/.test(await p.locator('.pd-access').innerText()));

  // The form
  await toEl(p, '#inquire', 20);
  check('phone: the form asks about the product', /Ask Rich Product a question/.test(await p.locator('#inquire').innerText()));
  check('phone: the boxes will not make an iPhone zoom', (await p.locator('#inq-name').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 16);
  check('phone: labels are readable on the dark part', await p.locator('#inquire label').first().evaluate((e) => getComputedStyle(e).color === 'rgb(255, 255, 255)'));
  await p.fill('#inq-name', 'Test Buyer');
  await p.fill('#inq-email', 'buyer@example.org');
  await p.fill('#inq-message', 'A question');
  await p.locator('[data-detail-form] button[type="submit"]').tap();
  await p.waitForSelector('.pd-sent', { timeout: 8000 }).catch(() => {});
  check('phone: an inquiry goes, and says so', /Inquiry sent/.test(await p.locator('[data-detail-sent]').innerText()));
  const st = await (await fetch(BASE + '/api/__state')).json();
  check('phone: it carries what was typed, for this product', st.inquiries.length === 1 && st.inquiries[0].inquirer_email === 'buyer@example.org' && st.inquiries[0].listing_id === 1, JSON.stringify(st.inquiries));

  // More like this
  await toEl(p, '#pd-related', 20);
  const related = await p.locator('#pd-related-grid .listing-card').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  check('phone: up to three more products', related.length >= 1 && related.length <= 3, related.join(','));
  check('phone: never this product again', !related.some((h) => h.endsWith('/test-product-1')) && !related.some((h) => h.endsWith('/rich-product')));
  check('phone: they lead to their pages', related.every((h) => h.startsWith('/marketplace/listing/')));
  await p.waitForTimeout(500);
  check('phone: their logos are fitted', await p.locator('#pd-related-grid img').evaluateAll((els) => els.every((e) => e.classList.contains('is-ready'))));
  check('phone: the bar does not hide the footer', await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, document.documentElement.scrollHeight); return new Promise((r) => setTimeout(() => { const f = [...document.querySelectorAll('.mp-footer-copy')].pop().getBoundingClientRect(); const b = document.getElementById('pd-bar').getBoundingClientRect(); r(f.bottom <= b.top + 1 || !document.getElementById('pd-bar').classList.contains('is-up')); }, 500)); }));
  check('phone: the credit is in the footer', /Motion effects from Skiper UI and Vengeance UI\./.test(await p.locator('.mp-footer').innerText()));
  check('phone: Event App goes to the app', (await p.locator('.mp-footer-links a', { hasText: 'Event App' }).getAttribute('href')) === '/app');
  const small = await p.evaluate(() => [...document.querySelectorAll('.pd-btn, .pd-fold summary, .mp-nav-btn, .mp-footer-links a')].filter((e) => { const r = e.getBoundingClientRect(); return r.height && r.height < 40; }).map((e) => e.textContent.trim().slice(0, 24)));
  check('phone: everything to tap is big enough', small.length === 0, small.join(','));
  check('phone: no sideways scroll at the foot', await fits(p));
  check('phone: no script errors', p.errs.length === 0, p.errs.join(' | '));
  await p.close();

  // A long name
  p = await open(phone, '/marketplace/listing/long-co/long-name');
  const longT = await box(p, 'h1');
  check('long name: a smaller title', longT.h < 260, longT.h);
  check('long name: the name is not repeated in the next heading', (await p.locator('#about h2').innerText()) === 'About this product');
  check('long name: no sideways scroll', await fits(p));
  check('long name: nothing shares its category, so no row', !(await p.locator('#pd-related').isVisible()));
  await p.close();

  // The same word in both price boxes
  p = await open(phone, '/marketplace/listing/same-co/same-price');
  check('price: the same word typed twice shows once', (await p.locator('.pd-badge--price').innerText()).trim() === 'Freemium', await p.locator('.pd-badge--price').innerText());
  await p.close();

  // An empty listing
  p = await open(phone, '/marketplace/listing/bare-co/bare');
  check('bare listing: says no description yet, once', (await p.locator('.pd-note', { hasText: 'has not added a description' }).count()) === 1);
  check('bare listing: Send inquiry alone', (await p.locator('.pd-actions .pd-btn').count()) === 1);
  check('bare listing: no price shows as "on request"', /Pricing on request/.test(await p.locator('.pd-badges').innerText()));
  check('bare listing: no Read more, nothing to read', !(await p.locator('.pd-more-text').count()));
  check('bare listing: no empty sections', (await p.locator('#technical, #support, #use-cases, #screenshots').count()) === 0);
  check('bare listing: no script errors', p.errs.length === 0, p.errs.join(' | '));
  await p.close();

  // Hostile text
  p = await open(phone, '/marketplace/listing/hostile-co/hostile');
  check('hostile text: none of it runs', (await p.evaluate(() => window.__hit)) === undefined);
  check('hostile text: it shows as words', /<img src=x/.test(await p.locator('h1').innerText()));
  check('hostile text: no image was made from it', (await p.locator('h1 img, .pd-access img').count()) === 0);
  check('hostile text: a javascript: website gives no button', (await p.locator('a[href^="javascript"]').count()) === 0);
  await p.close();

  // Not found, and not reached
  p = await open(phone, '/marketplace/listing/no-co/no-product');
  check('not found: says so, with a way back', /We couldn.t find this listing/.test(await p.locator('main').innerText()) && (await p.locator('.pd-missing a').getAttribute('href')) === '/marketplace');
  check('not found: no bar and no row', !(await barUp(p)) && !(await p.locator('#pd-related').isVisible()));
  await p.close();
  const off = await browser.newContext(PHONE);
  await off.route('**/api/mp/listings/by-slug/**', (r) => r.abort());
  p = await open(off, RICH);
  check('not reached: speaks plainly, not "Failed to fetch"', /Check your connection/.test(await p.locator('main').innerText()) && !/Failed to fetch/.test(await p.locator('main').innerText()));
  await p.close();
  await off.close();
  await phone.close();

  // ======== on a laptop ========
  const laptop = await browser.newContext(LAPTOP);
  p = await open(laptop, RICH);
  check('laptop: technical details are open', await p.locator('#technical').evaluate((d) => d.open));
  check('laptop: no Read more, the whole description shows', !(await p.locator('.pd-more-text').isVisible()) && /Paragraph 9/.test(await p.locator('#about').innerText()));
  check('laptop: words and facts sit side by side', (await box(p, '.pd-aside')).left > (await box(p, '.pd-main')).right - 1);
  check('laptop: no bar', !(await p.locator('#pd-bar').isVisible()));
  await toEl(p, '#case-studies', 100);
  await p.evaluate(() => window.scrollBy(0, 300));
  await p.waitForTimeout(500);
  const cta = await box(p, '.pd-cta');
  check('laptop: the panel with Send inquiry stays with the reader', cta.top >= 60 && cta.top <= 120, cta.top);
  check('laptop: it opens the form', (await p.locator('.pd-cta .pd-btn--primary').getAttribute('href')) === '#inquire');
  await toEl(p, '#inquire', 100);
  await p.waitForTimeout(300);
  check('laptop: it steps aside beside the form, so the button is not there twice', !(await p.locator('.pd-cta').isVisible()));
  check('laptop: three more products in a row', (await p.locator('#pd-related-grid .listing-card').count()) === 3);
  check('laptop: no script errors', p.errs.length === 0, p.errs.join(' | '));
  await p.locator('#pd-related-grid .listing-card').first().click();
  await p.waitForLoadState('domcontentloaded');
  check('laptop: a card opens its product page', /\/marketplace\/listing\//.test(p.url()), p.url());
  await p.close();
  await laptop.close();

  // ======== animations off ========
  const calm = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
  p = await open(calm, RICH);
  const still = await p.evaluate(() => ({
    title: getComputedStyle(document.querySelector('.pd-title .mk-w > span')).animationName,
    aurora: getComputedStyle(document.querySelector('.mk-aurora i')).animationName,
    split: document.querySelectorAll('.mk-split').length,
    smooth: getComputedStyle(document.documentElement).scrollBehavior,
  }));
  check('animations off: nothing moves', still.title === 'none' && still.aurora === 'none' && still.split === 0 && still.smooth === 'auto', JSON.stringify(still));
  await toEl(p, '#about', 0);
  check('animations off: the bar still works', await barUp(p));
  check('animations off: Read more still works', await p.locator('.pd-more-text').isVisible());
  await p.close();
  await calm.close();

  // ======== without the motion files ========
  const bare = await browser.newContext(PHONE);
  await bare.route(/marketplace-motion/, (r) => r.abort());
  p = await open(bare, RICH);
  check('without the motion files: every word stays', /Rich Product/.test(await p.locator('h1').innerText()) && (await p.locator('#inquire').isVisible()));
  check('without the motion files: no sideways scroll', await fits(p));
  await p.close();
  await bare.close();

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nall product page checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
