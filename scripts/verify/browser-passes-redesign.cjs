// End to end: the redesigned /passes on a phone, a small phone and a laptop in a real browser, on the
// built worker (login-harness.mjs) with the real clock, which is past the price rise. No wording was
// lost from the older page by accident, every price is right and the old one struck through, every
// buy button reaches the paid form on the right pass (nothing is submitted), nothing widens the page
// frame by frame, animations off gets the plain page, and with the motion files gone every word
// stays. Run by run-all.mjs. browser-price-rise.cjs and smoke-payments.mjs also check this page.
const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8821);
const ROOT = path.join(__dirname, '..', '..');
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SMALL = { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1366, height: 800 } };
const PRICES = { delegate: ['₹4,999', '₹8,999'], premium: ['₹9,999', '₹14,999'], vip: ['₹19,999', '₹24,999'], academic: ['₹999', '₹3,999'] };
const NAMES = { delegate: 'Delegate Pass', premium: 'Premium Delegate Pass', vip: 'VIP Pass', academic: 'Academic Pass' };

// The words of a page, from its source, with script, style and head taken out.
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;/g, '’').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&#8377;/g, '₹').replace(/&#10003;/g, '✓').replace(/&copy;/g, '©');
const bodyOf = (html) => html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const chunks = (html) => bodyOf(html).split(/<[^>]+>/).map((t) => decode(t).replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1);
const flat = (html) => decode(bodyOf(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

const open = async (ctx, url = '/passes') => {
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/401|404/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(BASE + url, { waitUntil: 'load', timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1100);
  return p;
};
const newCtx = async (browser, opts) => {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
  return ctx;
};
const box = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; }, sel);
const toEl = async (p, sel, gap = 40) => { await p.evaluate(([s, g]) => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - g); }, [sel, gap]); await p.waitForTimeout(500); };
// Every frame for a whole lap of the moving light, which is in no list of elements. Against the
// screen's real width: on a phone window.innerWidth grows with whatever overflows.
const widestFor = (p, ms = 5400) => p.evaluate((end) => new Promise((done) => { let most = 0; const stop = performance.now() + end; const tick = () => { most = Math.max(most, document.documentElement.scrollWidth); if (performance.now() < stop) requestAnimationFrame(tick); else done(most); }; requestAnimationFrame(tick); }), ms);
const lum = (rgb) => { const a = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const cfg = await (await fetch(BASE + '/api/payments/config')).json();
  if (!cfg.late) { console.log('FAIL this suite needs the clock past 5 Nov 2026'); process.exit(1); }

  // ======== nothing lost from the older page, except what was meant to go ========
  const old = fs.readFileSync(path.join(ROOT, 'docs', 'page-backups', 'passes-before-redesign-2026-11-06.html'), 'utf8');
  const now = await (await fetch(BASE + '/passes')).text();
  const nowText = flat(now);
  // Each of these is a deliberate change, and the organiser is told about them.
  const meant = new Set([
    // The app's bar and its Register button: the page now has the site's own menu.
    'Schedule', 'Register', 'Book Booth', 'AI Market', 'Main Site',
    // Stale counts, and counts the organiser does not want printed.
    'Speakers from Google, PwC, Capgemini, Accenture and UIDAI · 48 exhibitors on the floor plan · 12 tracks · 23 Innovation Talks · two hands-on workshops',
    // The struck price now sits in a sentence without the dash.
    'Get a Delegate Pass —',
    // The bare Free Visitor Pass link text is now also the row's heading: covered below.
  ]);
  const lost = [...new Set(chunks(old))].filter((c) => !nowText.includes(c) && !meant.has(c));
  check('every sentence of the older page is still on the page, or was meant to go', lost.length === 0, lost.join(' || '));
  check('the copy of the older page is kept', old.includes('PRICES WENT UP ON 6 NOV') && !old.includes('passes-motion'));
  for (const s of ['48 exhibitors', '12 tracks', '23 Innovation Talks', 'two hands-on workshops']) check('the stale count has gone: ' + s, !nowText.includes(s));
  check('no em dash in what the page says, outside the shared chart', !flat(now.replace(/<div class="pcmp">[\s\S]*?<\/table>\s*<\/div>/, '').replace(/<footer[\s\S]*?<\/footer>/, '')).includes('—'), 'em dash');
  check('the page still has the chart that /register and the app share', now.includes('class="pcmp"'));
  check('the motion file carries the MIT notice', fs.readFileSync(path.join(ROOT, 'public', 'css', 'passes-motion.css'), 'utf8').includes('Permission is hereby granted, free of charge'));
  check('the footer credits both libraries, which the free Skiper UI licence asks for', nowText.includes('Motion effects from Skiper UI and Vengeance UI.'));
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'passes-design.css'), 'utf8') + fs.readFileSync(path.join(ROOT, 'public', 'css', 'passes-motion.css'), 'utf8');
  check('no gradient text and no coloured side-stripe', !/background-clip:\s*text/.test(css) && !/border-left:\s*[2-9]px/.test(css));
  check('no seat, ticket or registration count on the page', !/\b\d[\d,]* (seats left|seats taken|registered|attendees|delegates)\b/i.test(nowText));
  check('the plain word for students: never RSVP', !/rsvp/i.test(nowText));

  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // ======== a phone ========
  const phone = await newCtx(browser, PHONE);
  let p = await open(phone);
  check('phone: the title reads whole', (await p.getAttribute('h1', 'aria-label')) === 'Passes for Bharat AI Innovation 2026' && (await p.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === 'Passes for Bharat AI Innovation 2026', await p.locator('h1').innerText());
  check('phone: only one h1', (await p.locator('h1').count()) === 1);
  check('phone: the title is big and in the heading font', await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.ps-w--big > span')); return parseFloat(s.fontSize) >= 60 && /Bricolage/.test(s.fontFamily); }));
  check('phone: says prices went up and may go up again', /PRICES WENT UP ON 6 NOV/.test(await p.locator('.ps-tag').innerText()) && /Prices went up on 6 Nov and may go up again\./.test(await p.locator('.ps-sub').innerText()));
  const first = await box(p, '#delegate .ps-price');
  check('phone: the Delegate price is on the first screen', first.bottom < 844, first.bottom);
  check('phone: Log In is on the screen', (await box(p, '.ps-login')).right <= 390);
  check('phone: the menu has the site\'s links, Home going to the main website', (await p.locator('.ps-nav a').first().getAttribute('href')) === '/' && (await p.locator('.ps-nav a').count()) === 14);
  check('phone: the menu marks Passes as the current page', (await p.locator('.ps-nav a[aria-current="page"]').innerText()) === 'Passes');
  check('phone: there is no button to the free form above the passes', (await p.evaluate(() => { const top = document.querySelector('#delegate').getBoundingClientRect().top; return [...document.querySelectorAll('a[href^="/register"]')].filter((a) => a.getBoundingClientRect().top < top).length; })) === 0);

  // Prices
  for (const [id, [was, is]] of Object.entries(PRICES)) {
    const r = await p.evaluate((i) => { const el = document.querySelector('#' + i + ' .ps-price'); const s = el.querySelector('s'); return { was: s.textContent.trim(), line: getComputedStyle(s).textDecorationLine, next: s.nextSibling.textContent.trim(), gst: el.querySelector('small').textContent.trim(), w: s.getBoundingClientRect().width }; }, id);
    check('phone: ' + id + ' shows ' + was + ' struck through and ' + is + ' + GST', r.was === was && r.line.includes('line-through') && r.next.startsWith(is) && r.gst === '+ GST' && r.w > 0, JSON.stringify(r));
  }
  const chartPrices = await p.locator('.pcmp thead th').allInnerTexts();
  check('phone: the chart has the five passes and today\'s prices', /Visitor\s*Free/.test(chartPrices[1]) && /₹3,999/.test(chartPrices[2]) && /₹8,999/.test(chartPrices[3]) && /₹14,999/.test(chartPrices[4]) && /₹24,999/.test(chartPrices[5]), chartPrices.join(' | '));
  check('phone: today\'s prices are the ones that charge', cfg.passes['Delegate Pass'].base === 8999 && cfg.passes['Premium Delegate Pass'].base === 14999 && cfg.passes['VIP Pass'].base === 24999 && cfg.passes['Academic Pass'].base === 3999, JSON.stringify(cfg.passes));

  // What each pass says
  const list = (id) => p.locator('#' + id + ' .ps-list').innerText();
  check('phone: only Premium and VIP say workshop', /hands-on workshop/.test(await list('premium')) && /Everything in Premium/.test(await list('vip')) && !/workshop/i.test((await list('delegate'))) && /No lunch, no workshop/.test(await list('academic')));
  check('phone: VIP has the Leaders\' Evening, Day 1', /Bharat AI Leaders’ Evening, Day 1/.test(await list('vip')));
  check('phone: the free pass says entry is not guaranteed', /Entry is not guaranteed/.test(await p.locator('#visitor').innerText()));
  check('phone: teams are five for the price of four, on request', /five passes for the price of four \(Delegate or Premium Delegate\), on request/.test(await p.locator('.ps-team').innerText()));
  check('phone: the team button goes to the group form', (await p.locator('.ps-team .ps-buy').getAttribute('href')) === '/contact#group_registration');
  check('phone: move-up link goes into the app', (await p.locator('#passes-move-up a').getAttribute('href')) === '/app?action=pay&pass=premium');

  // Colours that have to read
  const reads = await p.evaluate(() => [...document.querySelectorAll('.ps-buy, .ps-band, .ps-go-list .is-lead a')].map((e) => { const s = getComputedStyle(e); return { t: e.textContent.trim().slice(0, 28), c: s.color, b: s.backgroundColor }; }));
  const badReads = reads.filter((r) => contrast(r.c, r.b) < 4.5).map((r) => r.t + ' ' + contrast(r.c, r.b).toFixed(2));
  check('phone: every coloured button and badge band passes 4.5:1', reads.length >= 8 && badReads.length === 0, badReads.join(', '));

  // The picker
  await p.locator('.ps-pick-list a[href="#vip"]').tap();
  await p.waitForTimeout(900);
  const lit = await p.evaluate(() => { const e = document.querySelector('#vip'); return { target: e.matches(':target'), shadow: getComputedStyle(e).boxShadow, top: e.getBoundingClientRect().top }; });
  check('phone: a picker link goes to that pass and lights it', lit.target && lit.shadow !== 'none' && lit.top < 500 && lit.top > -20, JSON.stringify(lit));
  await p.locator('.ps-pick-list a[href="#visitor"]').evaluate((a) => a.click());
  await p.waitForTimeout(900);
  check('phone: "Just the exhibition floor" goes to the free pass', await p.evaluate(() => document.querySelector('#visitor').matches(':target')));
  await p.close();

  // Sticky bar and sticky chart head
  p = await open(phone);
  const barOn = async () => { const r = await box(p, '.ps-bar'); return !!r && r.bottom <= 845 && r.top < 844 && r.top > 700; };
  check('phone: no bar while the passes are on the screen', !(await barOn()));
  await toEl(p, '#compare', 10);
  check('phone: the bar comes up after the passes', await barOn());
  await toEl(p, '.ps-faq', 300);
  check('phone: it stays through the questions', await barOn());
  check('phone: the bar says today\'s price', /₹8,999 \+ GST/.test(await p.locator('.ps-bar').innerText()));
  check('phone: the bar goes to the Delegate form', (await p.locator('.ps-bar a').getAttribute('href')) === '/register?source=passes-bar#delegate');
  await toEl(p, '.ps-end', 300);
  check('phone: it leaves before the last button', (await box(p, '.ps-bar')).bottom <= (await box(p, '.ps-end')).top + 1);
  await toEl(p, '.pcmp', -300);
  const head = await p.evaluate(() => document.querySelector('.pcmp thead th:nth-child(2)').getBoundingClientRect().top);
  check('phone: the pass names stay at the top of the chart as it scrolls', Math.abs(head) <= 2, head);
  check('phone: every chart row can be read: a label above its marks', await p.locator('.pcmp-label').first().isVisible());
  check('phone: the chart head does not wrap prices across columns', await p.evaluate(() => [...document.querySelectorAll('.pcmp thead th')].filter((t) => t.offsetParent).every((t) => t.scrollWidth <= t.clientWidth + 1)));

  // The questions
  await toEl(p, '.ps-faq', 40);
  check('phone: nine questions, closed', (await p.locator('.ps-row').count()) === 9 && (await p.locator('.ps-row[open]').count()) === 0);
  await p.locator('.ps-row summary').nth(5).tap();
  await p.waitForTimeout(500);
  check('phone: a tap opens the answer, in a size that reads', /until 13 Nov 2026/.test(await p.locator('.ps-row').nth(5).innerText()) && (await p.locator('.ps-row p').nth(5).evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 15);
  check('phone: the refund link is kept', (await p.locator('.ps-row a[href="/refund"]').count()) === 1);
  const days = await p.locator('.ps-moments a').evaluateAll((els) => els.map((a) => a.getAttribute('href')));
  check('phone: the photos lead to what they show', days.join() === '/conference,/exhibition,/training-workshop', days.join());
  check('phone: the photos are captioned as the predecessor event', /Moments from Data Science Congress, the predecessor to Bharat AI Innovation\./.test(await p.locator('.ps-days').innerText()));
  const broken = await p.evaluate(async () => { const imgs = [...document.querySelectorAll('img')]; imgs.forEach((i) => { i.loading = 'eager'; }); await new Promise((r) => setTimeout(r, 900)); return imgs.filter((i) => i.getAttribute('src') && (!i.complete || !i.naturalWidth)).map((i) => i.src); });
  check('phone: no broken pictures', broken.length === 0, broken.join(', '));
  const small = await p.evaluate(() => [...document.querySelectorAll('.ps-nav a, .ps-login, .ps-pick-list a, .ps-buy, .ps-ghost, .ps-go-list a, .ps-row summary')].filter((e) => { const r = e.getBoundingClientRect(); return r.height && r.height < 40; }).map((e) => e.textContent.trim().slice(0, 24)));
  check('phone: everything to tap is big enough', small.length === 0, small.join(','));
  check('phone: no script errors', p.errs.length === 0, p.errs.join(' | '));

  // Letters, beam and the width of the page, frame by frame, at the top and at the foot
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(300);
  const widestTop = await widestFor(p, 1500);
  check('phone: the page never widens at the top', widestTop <= 391, widestTop);
  await toEl(p, '.ps-end', 120);
  await p.waitForTimeout(400);
  const ends = await p.evaluate(() => { const h = document.querySelector('.ps-end-title'); return { label: h.getAttribute('aria-label'), text: h.textContent.replace(/\s+/g, ' ').trim(), p: h.style.getPropertyValue('--p') }; });
  check('phone: the last heading reads whole and its letters have gathered', ends.label === 'See you at WTC Mumbai' && ends.text === ends.label && ends.p === '1.000', JSON.stringify(ends));
  const beam = await p.evaluate(() => { const b = document.querySelector('.ps-end .ps-beam'); return !!b && getComputedStyle(b).overflow === 'hidden' && getComputedStyle(b, '::after').offsetPath !== 'none'; });
  check('phone: the light runs round the last button, clipped to its own box', beam);
  const widestEnd = await widestFor(p);
  check('phone: the page never widens, frame by frame, for a whole lap of the light', widestEnd <= 391, widestEnd);
  await p.close();

  // Every buy button reaches the paid form on the right pass. Nothing is submitted.
  for (const id of Object.keys(PRICES)) {
    p = await open(phone);
    await toEl(p, '#' + id, 60);
    await p.locator('#' + id + ' .ps-buy').tap();
    await p.waitForURL('**/register**', { timeout: 15000 });
    await p.waitForTimeout(700);
    const form = await p.evaluate(() => ({ shown: !document.getElementById('reg-paid-pass-modal').classList.contains('hidden'), pass: document.getElementById('rpp-pass-type').value, picked: (document.querySelector('input[name="rpp-pass"]:checked') || {}).value, source: sessionStorage.getItem('bhai_reg_source'), url: location.pathname + location.search + location.hash }));
    check('phone: Get the ' + NAMES[id] + ' opens the paid form on that pass', form.shown && form.pass === NAMES[id] && form.picked === NAMES[id], JSON.stringify(form));
    check('phone: and Admin can see it came from this page', form.source === 'passes-card', form.source);
    await p.close();
  }
  p = await open(phone);
  const links = await p.evaluate(() => [...document.querySelectorAll('.ps-go-list a, .ps-end a, .ps-visitor a')].map((a) => a.getAttribute('href')));
  check('phone: the chart\'s buttons name each pass', ['/register?source=passes-compare-visitor', '/register?source=passes-compare#academic', '/register?source=passes-compare#delegate', '/register?source=passes-compare#premium', '/register?source=passes-compare#vip'].every((l) => links.includes(l)), links.join(' '));
  check('phone: the last button goes to the Delegate form', links.includes('/register?source=passes-foot#delegate'));
  check('phone: the app link is kept', links.includes('/app'));
  const visitorHref = '/register?source=passes-visitor';
  await p.locator(`.ps-visitor a[href="${visitorHref}"]`).tap();
  await p.waitForURL('**/register**', { timeout: 15000 });
  await p.waitForTimeout(500);
  check('phone: the free pass goes to the free form, with no paid form open', await p.evaluate(() => document.getElementById('reg-paid-pass-modal').classList.contains('hidden') && !!document.getElementById('reg-form')));
  await p.close();
  await phone.close();

  // ======== a small phone ========
  const small320 = await newCtx(browser, SMALL);
  p = await open(small320);
  const w320 = await p.evaluate(() => document.documentElement.scrollWidth);
  check('320px phone: no sideways scroll', w320 <= 321, w320);
  check('320px phone: the title fits', (await box(p, '.ps-w--big')).right <= 320);
  check('320px phone: the chart fits', (await box(p, '.pcmp')).right <= 320);
  await toEl(p, '#compare', 10);
  const barW = await box(p, '.ps-bar');
  check('320px phone: the bar fits', barW.right <= 320 && (await p.evaluate(() => { const a = document.querySelector('.ps-bar .ps-buy').getBoundingClientRect(); return a.right <= 320 && a.left >= 0; })), JSON.stringify(barW));
  await p.close();
  await small320.close();

  // ======== a laptop ========
  const laptop = await newCtx(browser, LAPTOP);
  p = await open(laptop);
  check('laptop: three passes side by side', (await p.evaluate(() => new Set([...document.querySelectorAll('.ps-grid > .ps-pass')].map((c) => Math.round(c.getBoundingClientRect().top))).size)) === 1 && (await p.locator('.ps-grid > .ps-pass').count()) === 3);
  check('laptop: their buttons line up', (await p.evaluate(() => new Set([...document.querySelectorAll('.ps-grid .ps-buy')].map((c) => Math.round(c.getBoundingClientRect().bottom))).size)) === 1);
  check('laptop: the bar is not shown', !(await p.locator('.ps-bar').isVisible()));
  check('laptop: the picker names the pass', /Premium Delegate/.test(await p.locator('.ps-pick-list').innerText()));
  check('laptop: the first prices are on the first screen', (await box(p, '#delegate .ps-price')).bottom < 800, (await box(p, '#delegate .ps-price')).bottom);
  const widestL = await widestFor(p, 800);
  check('laptop: no sideways scroll', widestL <= 1366, widestL);
  check('laptop: the menu stays on one row', (await box(p, '.ps-head')).h < 80, (await box(p, '.ps-head')).h);
  check('laptop: the moving line rests on Passes', await p.evaluate(() => { const n = document.querySelector('.ps-nav'); return n.style.getPropertyValue('--ps-lx') === n.querySelector('[aria-current]').offsetLeft + 'px'; }));
  const auroraA = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.ps-aurora i')).transform).m41);
  await p.waitForTimeout(500);
  const auroraB = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.ps-aurora i')).transform).m41);
  check('laptop: the light in the hero moves', auroraA !== auroraB);
  const glowA = await p.evaluate(() => getComputedStyle(document.querySelector('.ps-pass--lead'), '::before').getPropertyValue('--ps-angle'));
  await p.waitForTimeout(300);
  const glowB = await p.evaluate(() => getComputedStyle(document.querySelector('.ps-pass--lead'), '::before').getPropertyValue('--ps-angle'));
  check('laptop: the edge of the Delegate badge turns', glowA !== glowB, glowA + ' ' + glowB);
  await toEl(p, '.pcmp', -300);
  const lHead = await p.evaluate(() => document.querySelector('.pcmp thead th:nth-child(2)').getBoundingClientRect().top);
  const navH = (await box(p, '.ps-head')).bottom;
  check('laptop: the pass names stick just under the menu', Math.abs(lHead - navH) <= 4, lHead + ' ' + navH);
  await p.locator('.pcmp-row td').nth(3).hover();
  await p.waitForTimeout(150);
  check('laptop: a mouse lights the whole column', (await p.locator('.pcmp .ps-col').count()) >= 10, await p.locator('.pcmp .ps-col').count());
  await toEl(p, '#compare', 90);
  const split = await p.evaluate(() => { const h = document.querySelector('#compare .ps-h2'); return { cls: h.classList.contains('ps-split'), text: h.textContent.replace(/\s+/g, ' ').trim() }; });
  check('laptop: a section heading rises word by word and reads whole', split.cls && split.text === 'Compare every pass', JSON.stringify(split));
  check('laptop: no script errors', p.errs.length === 0, p.errs.join(' | '));
  await toEl(p, '#academic', 90);
  await p.locator('#academic .ps-buy').click();
  await p.waitForURL('**/register**', { timeout: 15000 });
  await p.waitForTimeout(700);
  check('laptop: the Academic button opens the paid form on that pass', await p.evaluate(() => !document.getElementById('reg-paid-pass-modal').classList.contains('hidden') && document.getElementById('rpp-pass-type').value === 'Academic Pass'));
  await p.close();
  await laptop.close();

  // ======== animations off ========
  const calm = await newCtx(browser, { ...PHONE, reducedMotion: 'reduce' });
  p = await open(calm);
  const still = await p.evaluate(() => ({
    title: getComputedStyle(document.querySelector('.ps-title .ps-w > span')).animationName,
    aurora: getComputedStyle(document.querySelector('.ps-aurora i')).animationName,
    glow: getComputedStyle(document.querySelector('.ps-pass--lead'), '::before').animationName,
    card: getComputedStyle(document.querySelector('.ps-grid .ps-pass')).animationName,
    split: document.querySelectorAll('.ps-split').length,
    letters: document.querySelectorAll('.ps-ch').length,
    beams: document.querySelectorAll('.ps-beam').length,
    smooth: getComputedStyle(document.documentElement).scrollBehavior,
  }));
  check('animations off: nothing moves', still.title === 'none' && still.aurora === 'none' && still.glow === 'none' && still.card === 'none' && still.smooth === 'auto', JSON.stringify(still));
  check('animations off: the script added nothing', still.split === 0 && still.letters === 0 && still.beams === 0, JSON.stringify(still));
  check('animations off: every price and heading shows', /₹8,999/.test(await p.locator('#delegate').innerText()) && /See you at WTC Mumbai/.test(await p.locator('.ps-end').innerText()));
  const wCalm = await p.evaluate(() => document.documentElement.scrollWidth);
  check('animations off: no sideways scroll', wCalm <= 391, wCalm);
  check('animations off: the bar still comes up, it needs no script', await (async () => { await toEl(p, '#compare', 10); const r = await box(p, '.ps-bar'); return r.bottom <= 845 && r.top > 700; })());
  await p.close();
  await calm.close();

  // ======== without the motion files ========
  const bare = await newCtx(browser, PHONE);
  await bare.route(/passes-motion/, (r) => r.abort());
  p = await open(bare);
  check('without the motion files: every word stays', /₹24,999/.test(await p.locator('#vip').innerText()) && /Before you pay/.test(await p.locator('.ps-faq').innerText()) && /Passes/.test(await p.locator('h1').innerText()));
  const wBare = await p.evaluate(() => document.documentElement.scrollWidth);
  check('without the motion files: no sideways scroll', wBare <= 391, wBare);
  await p.locator('.ps-row summary').first().tap();
  check('without the motion files: a question still opens', await p.locator('.ps-row').first().evaluate((d) => d.open));
  await p.close();
  await bare.close();

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nall passes page checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
