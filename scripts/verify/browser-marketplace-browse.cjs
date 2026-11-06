// End to end: the redesigned /marketplace browse page on a phone and a laptop in a real browser, on
// made-up listings through mk-browse-harness.mjs. Searching, every filter and shortcut, the bar that
// stays on screen, the sign-in and listing buttons, a failed load, an empty marketplace, animations
// off, and the page without its motion files. Run by run-all.mjs. The exhibitor's whole journey
// through the listing form stays in mp-test.cjs.
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8812);
const ROOT = path.join(__dirname, '..', '..');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1366, height: 800 } };
const CARD = '.listing-card:not(.listing-card--skeleton)';
const mode = (m) => fetch(BASE + '/api/__mode?m=' + m);
const open = async (ctx, q = '') => {
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/401|404|500/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(BASE + '/marketplace' + q, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1600);
  return p;
};
const cards = (p) => p.locator(CARD).count();
const box = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; }, sel);
// Against the phone's real width: on a phone window.innerWidth grows with whatever overflows.
const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= 391);
const toY = async (p, y) => { await p.evaluate((v) => window.scrollTo(0, v), y); await p.waitForTimeout(350); };
const toEl = async (p, sel, gap = 0) => { await p.evaluate(([s, g]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - g), [sel, gap]); await p.waitForTimeout(800); };

(async () => {
  // ======== the source: nothing that makes the page work has gone ========
  const pages = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'marketplace-pages.ts'), 'utf8');
  const motionCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'marketplace-motion.css'), 'utf8');
  const browseCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'marketplace-browse.css'), 'utf8');
  check('the motion file carries the MIT notice', motionCss.includes('Permission is hereby granted, free of charge'));
  check('the footer credits both libraries, which the free Skiper UI licence asks for', /Motion effects from Skiper UI and Vengeance UI\./.test(pages));
  check('no gradient text and no coloured side-stripe in the design', !/background-clip:\s*text/.test(browseCss + motionCss) && !/border-left:\s*[2-9]px/.test(browseCss));

  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ======== on a phone ========
  await mode('ok');
  const phone = await browser.newContext(PHONE);
  let p = await open(phone);
  check('phone: 16 products', (await cards(p)) === 16, await cards(p));
  check('phone: no sideways scroll at the top', await fits(p), await p.evaluate(() => document.documentElement.scrollWidth + ' ' + [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > 391 && !e.closest('.mk-logos,.mk-aurora,.mk-needs,.mp-nav,.listing-chips,.mk-sell')).slice(0, 6).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)).join(', ')));
  check('phone: one heading says the page\'s name', (await p.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === "India's Premier AI Solutions Marketplace", await p.locator('h1').innerText());
  const headingFonts = await p.evaluate(() => ['h1 .mk-w > span', '.mk-how .mk-h2 .mk-w > span', '.mk-sell-title .mk-ch'].map((s) => getComputedStyle(document.querySelector(s)).fontFamily));
  check('phone: split headings keep the heading font', headingFonts.every((f) => /Bricolage/.test(f)), headingFonts.join(' | '));
  check('phone: the heading is big', parseFloat(await p.evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize)) >= 40);
  check('phone: the description of the page is kept', /see who each one is built for, and contact the team behind it directly/.test(await p.locator('.mp-hero-sub').innerText()));
  const login = await box(p, '#login-button');
  check('phone: Exhibitor Login is on the screen without scrolling the menu', login.right <= 390 && login.left >= 0, JSON.stringify(login));
  const searchBox = await box(p, '#mk-search');
  check('phone: the search box is on the first screen', searchBox.bottom < 844, JSON.stringify(searchBox));
  const clipped = await p.evaluate(() => { const i = document.getElementById('mk-search'); const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(i).font; const s = getComputedStyle(i); return c.measureText(i.placeholder).width > i.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); });
  check('phone: the search hint is not cut off', !clipped);
  check('phone: the search box will not make an iPhone zoom', parseFloat(await p.evaluate(() => getComputedStyle(document.getElementById('mk-search')).fontSize)) >= 16);

  // Measured every frame for a whole lap of the search bar's light, which is not an element and
  // so shows up in no list of elements: at the bar's right edge it once widened the page.
  const widest = await p.evaluate(() => new Promise((done) => {
    let most = 0; const end = performance.now() + 6500;
    const tick = () => { most = Math.max(most, document.documentElement.scrollWidth); if (performance.now() < end) requestAnimationFrame(tick); else done(most); };
    requestAnimationFrame(tick);
  }));
  check('phone: the page never widens, frame by frame, for a whole lap of the light', widest <= 391, widest);
  const beamShown = await p.evaluate(() => { const b = document.querySelector('.mk-toolbar-row .mk-beam'); return b && getComputedStyle(b).overflow === 'hidden' && getComputedStyle(b, '::after').offsetPath !== 'none'; });
  check('phone: the light is still drawn, inside its own box', beamShown);

  // Cards
  const heights = await p.locator(CARD).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check('phone: a card is much shorter than the old 350px', Math.max(...heights) < 320, Math.max(...heights));
  check('phone: every card is one link', (await p.locator(CARD).evaluateAll((els) => els.every((e) => e.tagName === 'A' && e.getAttribute('href').startsWith('/marketplace/listing/')))));
  check('phone: a card with no logo shows initials', (await p.locator(CARD, { hasText: 'No Logo Product' }).locator('.listing-logo--initials').count()) === 1);
  check('phone: a card with no price says so', /Pricing on request/.test(await p.locator(CARD, { hasText: 'No Logo Product' }).innerText()));
  check('phone: a booth number shows on the card', /Booth B7/.test(await p.locator(CARD, { hasText: 'Booth Product' }).innerText()));

  // The logos in the hero
  const logos = await p.evaluate(() => ({
    read: document.querySelectorAll('.mk-logo:not([aria-hidden])').length,
    copies: document.querySelectorAll('.mk-logo[aria-hidden="true"]').length,
    ministry: [...document.querySelectorAll('.mk-logo')].some((a) => /ministry/i.test(a.href)),
    allLinks: [...document.querySelectorAll('.mk-logo')].every((a) => a.getAttribute('href').startsWith('/marketplace/listing/')),
    copiesOffKeyboard: [...document.querySelectorAll('.mk-logo[aria-hidden="true"]')].every((a) => a.tabIndex === -1),
  }));
  check('phone: the logo row shows each product with a logo once, for a screen reader', logos.read === 14, logos.read);
  check('phone: its extra copies are silent and off the keyboard', logos.copies === 28 && logos.copiesOffKeyboard, JSON.stringify(logos));
  check('phone: a government body\'s logo is not in the moving row', !logos.ministry);
  check('phone: but its product stays in the results', (await p.locator(CARD, { hasText: 'Adi Test' }).count()) === 1);
  check('phone: each logo leads to its product', logos.allLinks);
  const slide1 = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.mk-logo-track')).transform).m41);
  await p.waitForTimeout(600);
  const slide2 = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.mk-logo-track')).transform).m41);
  check('phone: the logo row moves', slide1 !== slide2, slide1 + ' ' + slide2);

  // Search
  await p.fill('#mk-search', 'Booth Product');
  await p.waitForTimeout(250);
  check('phone: search finds the product', (await cards(p)) === 1, await cards(p));
  check('phone: search says how many and what it searched', /1 of 16 products/.test(await p.locator('#mk-status').innerText()) && /Booth Product/.test(await p.locator('#mk-status').innerText()));
  await p.fill('#mk-search', 'nothing has this word');
  await p.waitForTimeout(250);
  check('phone: no match says so, with a way back', /No products match/.test(await p.locator('#listings-container').innerText()));
  await p.tap('#mp-empty-clear');
  await p.waitForTimeout(600);
  check('phone: clearing brings every product back', (await cards(p)) === 16 && (await p.inputValue('#mk-search')) === '');

  // Filters behind one button
  check('phone: the three filters wait behind one button', !(await p.locator('#filter-industry').isVisible()) && await p.locator('#mk-filter-toggle').isVisible());
  await p.tap('#mk-filter-toggle');
  check('phone: the button opens them and says so', (await p.locator('#filter-industry').isVisible()) && (await p.getAttribute('#mk-filter-toggle', 'aria-expanded')) === 'true');
  const options = await p.locator('#filter-industry option').allInnerTexts();
  check('phone: a filter lists only what products use, with a count', options.length === 3 && options.some((o) => /Banking \(\d+\)/.test(o)), options.join(','));
  await p.selectOption('#filter-industry', 'banking');
  await p.waitForTimeout(700);
  check('phone: choosing one filters the products', (await cards(p)) === 8, await cards(p));
  check('phone: and closes the filters so the products show', !(await p.locator('#filter-industry').isVisible()));
  check('phone: the button then shows one filter is on', (await p.locator('#mk-filter-count').innerText()) === '1');
  await p.locator('.mk-active-chip').first().tap();
  await p.waitForTimeout(700);
  check('phone: the chip takes the filter off', (await cards(p)) === 16 && !(await p.locator('#mk-filter-count').isVisible()));

  // Shortcuts
  const needs = await p.locator('.mk-need').allInnerTexts();
  check('phone: one row of shortcuts, not a wall', needs.length >= 2 && needs.length <= 7, needs.join(','));
  check('phone: a shortcut only where at least two products use it', !needs.includes('Fraud Detection'));
  const needRow = await box(p, '.mk-needs');
  check('phone: the shortcuts stay on one line', needRow.h < 60, needRow.h);
  await p.locator('.mk-need[data-need="ai agents"]').tap();
  await p.waitForTimeout(700);
  check('phone: a shortcut filters and lights up', (await cards(p)) < 16 && (await p.getAttribute('.mk-need[data-need="ai agents"]', 'aria-pressed')) === 'true');
  check('phone: and matches the Category filter', (await p.inputValue('#filter-category')) === 'ai agents');
  await p.locator('.mk-need[data-need="ai agents"]').tap();
  await p.waitForTimeout(700);
  check('phone: pressing it again takes it off', (await cards(p)) === 16 && (await p.inputValue('#filter-category')) === '');
  await p.locator('.mk-need[data-booth]').tap();
  await p.waitForTimeout(700);
  check('phone: "Meet them at the event" shows only products with a booth', (await cards(p)) === 2, await cards(p));
  await p.locator('.mk-clear').tap();
  await p.waitForTimeout(700);
  check('phone: Clear all brings every product back', (await cards(p)) === 16 && (await p.getAttribute('.mk-need[data-booth]', 'aria-pressed')) === 'false');

  // A card is reused, so logos do not reload on every filter
  await p.evaluate(() => { window.__c = document.querySelector('.listing-card'); });
  await p.fill('#mk-search', 'Test Product');
  await p.waitForTimeout(150);
  check('phone: filtering keeps the same card, so logos do not reload', await p.evaluate(() => document.querySelector('.listing-card') === window.__c));
  await p.fill('#mk-search', '');
  await p.waitForTimeout(150);

  // The bar stays on screen
  await toY(p, 2000);
  const bar = await box(p, '.mk-toolbar-row');
  check('phone: scrolled down, the search bar is pinned at the top', Math.abs(bar.top - 8) <= 2, bar.top);
  check('phone: the pinned bar is one row', bar.h < 75, bar.h);
  check('phone: with a strip behind it', await p.evaluate(() => document.querySelector('.mk-toolbar').classList.contains('is-stuck')));
  const skip = await p.evaluate(() => { const r = document.querySelector('.mk-toolbar-row').getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest('.mk-toolbar-row') !== null; });
  check('phone: nothing lies over the pinned bar', skip);
  await p.tap('#mk-filter-toggle');
  await p.selectOption('#filter-industry', 'retail');
  await p.waitForTimeout(800);
  const needsAfter = await box(p, '.mk-needs');
  const barAfter = await box(p, '.mk-toolbar-row');
  check('phone: a filter chosen far down goes back to the top of the results', needsAfter.top >= barAfter.bottom - 1 && needsAfter.top < 300, JSON.stringify([needsAfter.top, barAfter.bottom]));
  await p.locator('.mk-clear').tap();
  await p.waitForTimeout(700);
  await toEl(p, '.mk-how', -100);
  const barLate = await box(p, '.mk-toolbar-row');
  check('phone: the bar leaves once the products end', barLate.bottom < 100, barLate.bottom);

  // The lower sections
  await toEl(p, '.mk-how', 60);
  check('phone: the three steps are in order', (await p.locator('.mk-step h3').allInnerTexts()).join('|') === 'Find it|See if it fits|Talk to the team');
  check('phone: the dates are right', /WTC Mumbai on 20 and 21 November/.test(await p.locator('.mk-steps').innerText()));
  await toEl(p, '.mk-sell', 40);
  await p.waitForTimeout(400);
  const sellT = await p.evaluate(() => { const h = document.querySelector('.mk-sell-title'); return { label: h.getAttribute('aria-label'), text: h.textContent.replace(/\s+/g, ' ').trim(), p: h.style.getPropertyValue('--p') }; });
  check('phone: the companies\' heading reads whole, to eye and screen reader', sellT.label === 'Put your AI product in front of buyers' && sellT.text === sellT.label, JSON.stringify(sellT));
  check('phone: its letters have gathered by the time it is read', sellT.p === '1.000', sellT.p);
  check('phone: the spread letters do not widen the page', await fits(p));
  check('phone: the cards stack', await p.locator('.mk-card').first().evaluate((e) => getComputedStyle(e).position === 'sticky'));
  await toEl(p, '.mk-stack', -350);
  await p.waitForTimeout(500);
  check('phone: a stuck card shrinks as the next comes over', /matrix|scale/.test(await p.locator('.mk-card').first().evaluate((e) => e.style.transform)), await p.locator('.mk-card').first().evaluate((e) => e.style.transform));
  await toEl(p, '.mk-faq', 40);
  const first = p.locator('.mk-row').first();
  check('phone: a question starts closed', !(await first.getAttribute('open') !== null));
  await first.locator('summary').tap();
  await p.waitForTimeout(600);
  check('phone: tapping opens the answer', /Any company can create a free marketplace account/.test(await first.innerText()));
  check('phone: the whole FAQ is one tap away', (await p.getAttribute('.mk-faq .mk-link', 'href')) === '/marketplace/faq');
  check('phone: the credit is in the footer', /Motion effects from Skiper UI and Vengeance UI\./.test(await p.locator('.mp-footer').innerText()));
  const small = await p.evaluate(() => [...document.querySelectorAll('.mk-need, .mk-filter-toggle, #mk-search, .mp-nav-btn, .mk-row summary, .mp-footer-links a, .mk-sell .mk-link')].filter((e) => { const r = e.getBoundingClientRect(); return r.height && r.height < 40; }).map((e) => e.textContent.trim().slice(0, 24)));
  check('phone: everything to tap is big enough', small.length === 0, small.join(','));
  check('phone: no sideways scroll at the foot', await fits(p));
  check('phone: no script errors', p.errs.length === 0, p.errs.join(' | '));

  const homeHref = await p.locator('.mp-nav-link', { hasText: 'Home' }).getAttribute('href');
  check('phone: Home goes to the main website', homeHref === '/', homeHref);
  check('phone: Event App goes to the app', (await p.locator('.mp-footer-links a', { hasText: 'Event App' }).getAttribute('href')) === '/app');

  // The buttons for companies, signed out
  await toEl(p, '.mk-sell', 40);
  await p.locator('.mk-sell-btn').tap();
  await p.waitForTimeout(900);
  check('phone: the lower "List your AI product" asks a signed-out company to sign in', await p.locator('#auth-section').isVisible());
  const auth = await box(p, '#auth-section');
  check('phone: and brings the box into view', auth.top >= -2 && auth.top < 300, auth.top);
  check('phone: the listing form stays hidden until signed in', !(await p.locator('#listing-form-section').isVisible()));
  const authGap = await p.evaluate(() => document.querySelector('.mk-toolbar-row').getBoundingClientRect().top - document.querySelector('#link-form').getBoundingClientRect().bottom);
  check('phone: the search bar does not cover the sign-in box', authGap > 0 || (await box(p, '#register-form')).bottom <= (await box(p, '.mk-toolbar-row')).top, authGap);
  await p.close();

  p = await open(phone, '?signin=1');
  check('phone: the dashboard\'s Sign in still opens the box', await p.locator('#auth-section').isVisible());
  await p.close();
  p = await open(phone);
  await p.tap('#login-button');
  await p.waitForTimeout(700);
  check('phone: Exhibitor Login opens the box', await p.locator('#auth-section').isVisible());
  await p.tap('#open-listing-button');
  await p.waitForTimeout(600);
  check('phone: the hero\'s button still asks to sign in', await p.locator('#auth-section').isVisible());
  await p.close();
  await phone.close();

  // ======== on a laptop ========
  const laptop = await browser.newContext(LAPTOP);
  p = await open(laptop);
  check('laptop: 16 products in three columns', (await cards(p)) === 16 && (await p.evaluate(() => new Set([...document.querySelectorAll('.listing-card')].map((c) => c.getBoundingClientRect().left)).size)) === 3);
  check('laptop: the three filters show, the phone button does not', (await p.locator('#filter-industry').isVisible()) && !(await p.locator('#mk-filter-toggle').isVisible()));
  const row = await box(p, '.mk-toolbar-row');
  check('laptop: search and filters sit on one row', row.h < 72, row.h);
  check('laptop: the shortcuts stay on one line', (await box(p, '.mk-needs')).h < 52, (await box(p, '.mk-needs')).h);
  check('laptop: a card starts on the first screen', (await box(p, CARD)).top < 800);
  const auroraA = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.mk-aurora i')).transform).m41);
  await p.waitForTimeout(500);
  const auroraB = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.mk-aurora i')).transform).m41);
  check('laptop: the light in the hero moves', auroraA !== auroraB);
  check('laptop: the title has finished rising', await p.evaluate(() => [...document.querySelectorAll('h1 .mk-w > span')].every((s) => { const t = getComputedStyle(s).transform; return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'; })));
  check('laptop: the moving line rests on the current page', await p.evaluate(() => { const n = document.querySelector('.mp-nav'); const a = n.querySelector('[aria-current]'); return n.classList.contains('mk-spot') && n.style.getPropertyValue('--mk-x') === a.offsetLeft + 'px'; }));
  await p.locator('.mp-nav-link', { hasText: 'FAQ' }).hover();
  await p.waitForTimeout(100);
  check('laptop: and goes to the link under the mouse', await p.evaluate(() => { const n = document.querySelector('.mp-nav'); const a = [...n.querySelectorAll('a')].find((x) => /FAQ/.test(x.textContent)); return n.style.getPropertyValue('--mk-x') === a.offsetLeft + 'px'; }));
  check('laptop: the beam runs round the search bar', (await p.locator('.mk-toolbar-row .mk-beam').count()) === 1);
  await p.fill('#mk-search', 'x'); await p.fill('#mk-search', '');
  check('laptop: and stops once the bar is used', await p.locator('.mk-toolbar-row .mk-beam').evaluate((e) => e.classList.contains('is-done')));
  await toY(p, 1500);
  const pinned = await box(p, '.mk-toolbar-row');
  check('laptop: the header and the search bar both stay', pinned.top >= 69 && pinned.top <= 90 && (await box(p, '.mp-header')).top === 0, pinned.top);
  await p.locator(CARD).nth(4).hover();
  await p.waitForTimeout(450);
  check('laptop: the card edge lights by the mouse', await p.locator(CARD).nth(4).evaluate((c) => getComputedStyle(c, '::before').opacity === '1' && !!c.style.getPropertyValue('--mx')));
  await p.selectOption('#filter-category', 'ai agents');
  await p.waitForTimeout(800);
  check('laptop: a filter works from the pinned bar', (await cards(p)) < 16);
  check('laptop: and shows the results from their top', (await box(p, '.mk-needs')).top >= (await box(p, '.mk-toolbar-row')).bottom - 1);
  await p.locator('.mk-clear').click();
  await p.waitForTimeout(700);
  await p.click('[data-view="list"]');
  await p.waitForTimeout(700);
  check('laptop: the list view still works', await p.locator('#listings-container').evaluate((e) => e.classList.contains('listing-list')));
  check('laptop: one row per product', (await box(p, CARD)).h < 150, (await box(p, CARD)).h);
  await p.click('[data-view="grid"]');
  await p.waitForTimeout(700);
  check('laptop: and back to the grid', await p.locator('#listings-container').evaluate((e) => e.classList.contains('listing-grid')));
  await toY(p, 2500);
  await p.click('#login-button');
  await p.waitForTimeout(900);
  const authL = await box(p, '#auth-section');
  check('laptop: Exhibitor Login from far down brings the box into view', authL.top >= 0 && authL.top < 500, authL.top);
  const gapL = (await box(p, '.mk-toolbar-row')).top - authL.bottom;
  check('laptop: the search bar does not cover it', gapL >= -1, gapL);
  check('laptop: no script errors', p.errs.length === 0, p.errs.join(' | '));
  await p.locator(CARD).first().click();
  await p.waitForLoadState('domcontentloaded');
  check('laptop: a card opens its product page', /\/marketplace\/listing\//.test(p.url()), p.url());
  await p.close();
  await laptop.close();

  // ======== animations off ========
  const calm = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
  p = await open(calm);
  check('animations off: every product shows', (await cards(p)) === 16);
  const still = await p.evaluate(() => ({
    title: getComputedStyle(document.querySelector('h1 .mk-w > span')).animationName,
    aurora: getComputedStyle(document.querySelector('.mk-aurora i')).animationName,
    track: getComputedStyle(document.querySelector('.mk-logo-track')).animationName,
    split: document.querySelectorAll('.mk-split').length,
    letters: document.querySelectorAll('.mk-ch').length,
    beams: document.querySelectorAll('.mk-beam').length,
    copies: [...document.querySelectorAll('.mk-logo--copy')].every((e) => getComputedStyle(e).display === 'none'),
    sticky: getComputedStyle(document.querySelector('.mk-card')).position,
    scrollable: getComputedStyle(document.querySelector('.mk-logos')).overflowX,
  }));
  check('animations off: nothing moves', still.title === 'none' && still.aurora === 'none' && still.track === 'none', JSON.stringify(still));
  check('animations off: the script added nothing', still.split === 0 && still.letters === 0 && still.beams === 0, JSON.stringify(still));
  check('animations off: the logos hold still and scroll by hand', still.copies && still.scrollable === 'auto', JSON.stringify(still));
  check('animations off: the company cards do not stick', still.sticky === 'static', still.sticky);
  await p.tap('#mk-filter-toggle');
  await p.selectOption('#filter-industry', 'banking');
  check('animations off: a filter works at once', (await cards(p)) === 8, await cards(p));
  check('animations off: no sideways scroll', await fits(p));
  check('animations off: no script errors', p.errs.length === 0, p.errs.join(' | '));
  await p.close();
  await calm.close();

  // ======== without the motion files ========
  const bare = await browser.newContext(PHONE);
  await bare.route(/marketplace-motion/, (r) => r.abort());
  p = await open(bare);
  check('without the motion files: every word and product stays', (await cards(p)) === 16 && /Put your AI product in front of buyers/.test(await p.locator('.mk-sell').innerText()) && /India's Premier/.test(await p.locator('h1').innerText()));
  await p.locator('.mk-need').nth(1).tap();
  await p.waitForTimeout(700);
  check('without the motion files: search and filters still work', (await cards(p)) < 16);
  check('without the motion files: no sideways scroll', await fits(p));
  await p.close();
  await bare.close();

  // ======== a failed load, an empty marketplace, very few products ========
  const other = await browser.newContext(PHONE);
  await mode('fail');
  p = await open(other);
  const failed = await p.locator('#listings-container').innerText();
  check('a failed load says so', /The products did not load/.test(failed), failed);
  check('a failed load does not claim the marketplace is empty', !/No listings published/.test(failed));
  check('a failed load shows no shortcuts or logos', (await p.locator('.mk-need').count()) === 0 && (await p.locator('.mk-logo').count()) === 0);
  await mode('ok');
  await p.tap('#mk-retry');
  await p.waitForTimeout(800);
  check('Try again brings the products', (await cards(p)) === 16, await cards(p));
  check('and the logos', (await p.locator('.mk-logo').count()) > 0);
  await p.close();
  await mode('empty');
  p = await open(other);
  check('an empty marketplace says so', /No listings published yet/.test(await p.locator('#listings-container').innerText()));
  await p.tap('#mp-empty-submit');
  await p.waitForTimeout(600);
  check('and its button asks a company to sign in', await p.locator('#auth-section').isVisible());
  check('and the empty logo row takes no room', !(await p.locator('#mk-logos').isVisible()));
  await p.close();
  await mode('few');
  p = await open(other);
  check('with few products no logo row runs', !(await p.locator('#mk-logos').isVisible()) && (await cards(p)) === 3);
  await p.close();
  await mode('ok');
  await other.close();

  const st = await (await fetch(BASE + '/api/__state')).json();
  check('the only request this page sent was asking whether the event app already signed them in', st.refused.filter((r) => !r.startsWith('GET ')).every((r) => r === 'POST /api/mp/auth/from-app'), st.refused.join(', '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nall marketplace browse checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
