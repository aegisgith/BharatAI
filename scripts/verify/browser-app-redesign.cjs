// End to end: /app in the website's design, on a phone and a laptop, in a real browser. The bar and the
// five tabs fit, every button works where it moved to, the hero hides what sign-in hides, the words are
// readable on what is really behind them, nothing widens the page, the menu fits at every width, animations
// off, and without the design and motion files. Needs phone-harness.mjs. 6 Nov 2026.
const pw = require('./playwright.cjs');

// Edge by default. BROWSER=webkit (Safari's engine, so an iPhone) or BROWSER=firefox runs the same checks
// there, when Playwright's own copy of that browser is installed.
const OTHER = process.env.BROWSER;
const PORT = process.env.HARNESS_PORT || 8835;
const BASE = 'http://localhost:' + PORT;
const USER = { id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', company: 'DJ Sanghvi', job_title: 'Student', badge_type: 'Visitor Pass', payment_status: 'paid', industry: 'Education & Academia', interests: 'ml', networking_goals: 'learn', city: 'Mumbai', mobile: '9876543210' };
let failed = 0, passed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <- ' + detail)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Firefox has no isMobile: it gets a phone-sized touch window.
const PHONE = { viewport: { width: 390, height: 844 }, ...(OTHER === 'firefox' ? {} : { isMobile: true }), hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const LAPTOP = { viewport: { width: 1366, height: 800 }, serviceWorkers: 'block' };

async function open(browser, opts, { signedIn = true, block = [], reduced = false } = {}) {
  const ctx = await browser.newContext({ ...opts, ...(reduced ? { reducedMotion: 'reduce' } : {}) });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  for (const pattern of block) await page.route(pattern, (r) => r.abort());
  if (signedIn) await page.addInitScript((u) => { localStorage.setItem('agba_user', JSON.stringify(u)); localStorage.setItem('agba_social_card_offered', '1'); }, USER);
  await page.goto(BASE + '/app', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => { const c = document.getElementById('content'); return c && !c.classList.contains('hidden'); }, null, { timeout: 30000 });
  if (signedIn) await page.waitForFunction(() => { const c = document.getElementById('pass-card-cta'); return c && !c.classList.contains('hidden'); }, null, { timeout: 30000 });
  await sleep(500);
  return { ctx, page, errors, requests };
}

// Contrast of each visible piece of text against what is really behind it, over the worst stop of any
// gradient, inside the given elements. Text with a gradient fill is skipped: it has no colour to read.
const contrastOf = (selectors) => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const behind = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      // A background sized to nothing (the link underline at rest) paints nothing.
      const sized = !/^0(px)?\s/.test(s.backgroundSize);
      const stops = sized ? (s.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse) : [];
      if (stops.length) { layers.push(stops); if (stops.every((x) => x.a === 1)) break; }
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { layers.push([c]); if (c.a === 1) break; }
    }
    let base = [{ r: 248, g: 249, b: 255, a: 1 }];
    for (let i = layers.length - 1; i >= 0; i--) { const out = []; for (const t of layers[i]) for (const u of base) out.push(over(t, u)); base = out.slice(0, 12); }
    return base;
  };
  const low = [];
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const t = w.currentNode.nodeValue.trim();
        if (t.length < 2) continue;
        const el = w.currentNode.parentElement;
        if (el.closest('.sr-only')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const s = getComputedStyle(el);
        if (s.webkitTextFillColor && s.webkitTextFillColor.includes('rgba(0, 0, 0, 0)')) continue;
        let hidden = false;
        for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') { hidden = true; break; } }
        if (hidden) continue;
        const fg = parse(s.color); if (!fg) continue;
        const size = parseFloat(s.fontSize), large = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700);
        let worst = 99;
        for (const bg of behind(el)) worst = Math.min(worst, ratio(fg.a < 1 ? over(fg, bg) : fg, bg));
        if (worst < (large ? 3 : 4.5)) low.push(Math.round(worst * 10) / 10 + ' "' + t.slice(0, 36) + '" ' + s.color);
      }
    });
  }
  return low;
};

const onScreen = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom, shown: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }; };
const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

(async () => {
  const browser = OTHER ? await pw[OTHER].launch({ headless: true }) : await pw.chromium.launch({ channel: 'msedge', headless: true });

  // ---------- a signed-in phone ----------
  {
    const { ctx, page, errors, requests } = await open(browser, PHONE);
    const bottom = await page.evaluate(() => [...document.querySelectorAll('.ap-nav-phone > *')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => { const r = b.getBoundingClientRect(); return { t: b.innerText.replace(/\s+/g, ' ').trim(), l: r.left, r: r.right, h: r.height }; }));
    check('phone: five tabs along the bottom', bottom.length === 5, bottom.map((b) => b.t).join(','));
    check('phone: they are Dashboard, Conference Schedule, Network, Workshops, AI Market', bottom.map((b) => b.t).join('|') === 'Dashboard|Conference Schedule|Network|Workshops|AI Market', bottom.map((b) => b.t).join('|'));
    check('phone: every one is fully on the screen (before, Me was off the edge)', bottom.every((b) => b.l >= 0 && b.r <= 390), JSON.stringify(bottom));
    check('phone: every one is big enough for a thumb', bottom.every((b) => b.h >= 44), JSON.stringify(bottom.map((b) => b.h)));
    for (const [name, sel] of [['Inbox', '#app-topbar [data-tab="inbox"]'], ['Alerts', '#nav-notif-btn-mobile'], ['Me', '#nav-mobile-me'], ['Main Site', '#app-topbar .ap-top-link']]) {
      const b = await page.evaluate(onScreen, sel);
      check('phone: ' + name + ' is in the top bar, on the screen', b && b.shown && b.l >= 0 && b.r <= 390 && b.t >= 0 && b.b <= 60, JSON.stringify(b));
      check('phone: ' + name + ' is big enough for a thumb', b && b.h >= 44 && (name === 'Main Site' || b.w >= 44), JSON.stringify(b));
    }
    const bars = await page.evaluate(() => ({ nav: getComputedStyle(document.getElementById('main-nav')).backgroundColor, top: getComputedStyle(document.getElementById('app-topbar')).backgroundColor, meta: document.querySelector('meta[name=theme-color]').content }));
    check('phone: both bars are the website\'s dark colour', /13, 15, 30/.test(bars.nav) && /13, 15, 30/.test(bars.top), JSON.stringify(bars));
    check('phone: the browser\'s own top colours to match', bars.meta === '#0D0F1E', bars.meta);

    const hero = await page.evaluate(() => {
      const shown = (s) => { const e = document.querySelector(s); return !!e && e.getBoundingClientRect().height > 0; };
      return { register: [...document.querySelectorAll('.signed-out-only')].filter((e) => e.getBoundingClientRect().height > 0).length, word: shown('#hero-wordmark'), when: document.querySelector('.ap-when').innerText, gold: getComputedStyle(document.querySelector('.ap-when')).color, cls: document.getElementById('hero-band').className };
    });
    check('phone: nothing meant for someone signed out is showing', hero.register === 0, 'showing ' + hero.register);
    check('phone: the short wordmark is', hero.word, 'no wordmark');
    check('phone: the date line is the website\'s gold and its words', /255, 213, 79/.test(hero.gold) && hero.when.includes('20–21 November 2026, World Trade Center Mumbai'), JSON.stringify(hero));
    check('phone: the date line fits on one line', (await page.evaluate(() => { const e = document.querySelector('.ap-when'); return e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight || 20); })) < 1.6, 'wrapped');

    const pass = await page.evaluate(() => {
      const h = document.querySelector('.ap-pass h3'), dl = document.getElementById('pcc-download-btn').getBoundingClientRect();
      const nav = document.getElementById('main-nav').getBoundingClientRect();
      return { z: getComputedStyle(h).zIndex, pos: getComputedStyle(h).position, dlBottom: dl.bottom, navTop: nav.top, dlW: dl.width, cardW: document.querySelector('.ap-pass').getBoundingClientRect().width, h: h.innerText };
    });
    check('phone: the pass card\'s words sit above its glow', pass.z === '2' && pass.pos === 'relative', JSON.stringify(pass));
    check('phone: says what the pass is', /Visitor Pass is a free pass: entry not guaranteed/.test(pass.h), pass.h);
    check('phone: Download my pass is on the first screen, clear of the bar', pass.dlBottom > 0 && pass.dlBottom <= pass.navTop, JSON.stringify(pass));
    check('phone: the button takes the card\'s width', pass.dlW > pass.cardW * 0.8, JSON.stringify(pass));
    // The colour /passes, /partner and /marketplace settled on, and the ratio worked out from the button as drawn.
    const main = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('pcc-guarantee-btn'));
      return { bg: s.backgroundColor, img: s.backgroundImage, color: s.color };
    });
    check('phone: the main button is the website\'s #C84F00, flat', main.bg === 'rgb(200, 79, 0)' && main.img === 'none', JSON.stringify(main));
    const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (1 + 0.05) / (lum(200, 79, 0) + 0.05);
    check('phone: white on it is at least 4.5:1 (' + ratio.toFixed(2) + ')', main.color === 'rgb(255, 255, 255)' && ratio >= 4.5, JSON.stringify(main));
    const lowPass = await page.evaluate(contrastOf, ['.ap-pass button', '#pcc-card-btn']);
    check('phone: every button on the two cards is readable as drawn', lowPass.length === 0, lowPass.slice(0, 4).join(' ; '));

    // Every tab: no sideways scroll, the bands readable.
    for (const tab of ['dashboard', 'schedule', 'networking', 'workshops', 'exhibition', 'inbox', 'myprofile', 'venue']) {
      await page.evaluate((t) => switchTab(t), tab);
      await sleep(500);
      const over = await page.evaluate(sideways);
      check('phone ' + tab + ': no sideways scroll', over <= 0, over + 'px');
      const low = await page.evaluate(contrastOf, ['#app-topbar', '.ap-nav-phone', '#tab-' + tab + ' .ap-band', '#tab-' + tab + ' #hero-band', '#tab-' + tab + ' .ap-pass']);
      check('phone ' + tab + ': bars and heading readable', low.length === 0, low.slice(0, 4).join(' ; '));
    }

    // The moving parts must not widen the page at any moment of their travel.
    await page.evaluate(() => switchTab('dashboard'));
    let widest = 0;
    for (let i = 0; i < 14; i++) { widest = Math.max(widest, await page.evaluate(sideways)); await sleep(150); }
    check('phone: nothing moving widens the page over two seconds', widest <= 0, widest + 'px');

    // Off the screen, it stops.
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(500);
    const off = await page.evaluate(() => ({ aurora: document.querySelector('#hero-band .ap-aurora').classList.contains('ap-off'), pass: document.querySelector('.ap-pass').classList.contains('ap-off') }));
    check('phone: scrolled away, the hero and the pass stop moving', off.aurora && off.pass, JSON.stringify(off));

    // The foot of the page clears the bar.
    const foot = await page.evaluate(() => { const c = document.querySelector('.ap-credit').getBoundingClientRect(); const l = document.querySelector('.ap-foot-legal').getBoundingClientRect(); return { bottom: Math.max(c.bottom, l.bottom), nav: document.getElementById('main-nav').getBoundingClientRect().top }; });
    check('phone: scrolled to the end, the footer is clear of the bar', foot.bottom <= foot.nav, JSON.stringify(foot));
    const footLow = await page.evaluate(contrastOf, ['.ap-foot']);
    check('phone: the footer is readable', footLow.length === 0, footLow.slice(0, 4).join(' ; '));
    await page.evaluate(() => window.scrollTo(0, 0));

    // Each button where it moved to.
    await page.tap('#app-topbar [data-tab="inbox"]');
    await sleep(500);
    check('phone: tapping the top bar\'s Inbox opens the Inbox', await page.isVisible('#tab-inbox'), 'not open');
    check('phone: and marks it as where you are', await page.evaluate(() => document.querySelector('#app-topbar [data-tab="inbox"]').classList.contains('tab-active')), 'not marked');
    await page.tap('#nav-notif-btn-mobile');
    await sleep(350);
    check('phone: tapping Alerts opens the notifications', await page.evaluate(() => !document.getElementById('notif-sheet').classList.contains('hidden')), 'closed');
    await page.evaluate(() => closeMobileNotifs());
    await page.tap('#nav-mobile-me');
    await sleep(350);
    check('phone: tapping Me opens the account sheet', await page.isVisible('#account-menu-panel'), 'closed');
    check('phone: the sheet offers the things it did', /Edit my profile/.test(await page.innerText('#account-menu-panel')) && /My pass/.test(await page.innerText('#account-menu-panel')) && /Log out/.test(await page.innerText('#account-menu-panel')), 'missing');
    await page.evaluate(() => closeAccountMenu());
    await page.tap('.ap-nav-phone [data-tab="schedule"]');
    await sleep(600);
    check('phone: Conference Schedule opens', await page.isVisible('#tab-schedule'), 'closed');
    const sched = await page.evaluate(() => ({ h: document.querySelector('#tab-schedule .ap-title').innerText.replace(/\s+/g, ' ').trim(), font: getComputedStyle(document.querySelector('#tab-schedule .ap-hl')).fontFamily, hall: document.getElementById('sched-hall-tabs').innerText.replace(/\s+/g, ' ') }));
    check('phone: headed Conference Schedule', sched.h === 'Conference Schedule', sched.h);
    check('phone: the coloured word keeps the heading font', /Bricolage/.test(sched.font), sched.font);
    check('phone: the first hall button says All halls', sched.hall.startsWith('🗓️ All halls') || sched.hall.includes('All halls'), sched.hall);
    await page.evaluate(() => switchTab('dashboard'));
    await sleep(300);

    check('phone: the hero picture was not downloaded', !requests.some((u) => u.includes('7C2A3159')), 'downloaded');
    check('phone: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- a signed-in laptop ----------
  {
    const { ctx, page, errors, requests } = await open(browser, LAPTOP);
    const n = await page.evaluate(() => { const nav = document.getElementById('main-nav').getBoundingClientRect(); const hero = document.getElementById('hero-band').getBoundingClientRect(); return { h: nav.height, bottom: nav.bottom, heroTop: hero.top, bg: getComputedStyle(document.getElementById('main-nav')).backgroundColor }; });
    check('laptop: the bar is the website\'s dark colour', /13, 15, 30/.test(n.bg), n.bg);
    check('laptop: and its height', Math.round(n.h) === 66, String(n.h));
    check('laptop: no white stripe between the bar and the hero', Math.abs(n.bottom - n.heroTop) < 1, JSON.stringify(n));
    check('laptop: the top bar and the phone tabs are not shown', !(await page.isVisible('#app-topbar')) && !(await page.isVisible('.ap-nav-phone')), 'shown');
    await sleep(800);
    check('laptop: the hero picture was downloaded', requests.some((u) => u.includes('7C2A3159')), 'not requested');

    for (const tab of ['schedule', 'networking', 'workshops', 'dashboard']) {
      await page.evaluate((t) => switchTab(t), tab);
      await sleep(650);
      const m = await page.evaluate((t) => {
        const on = document.querySelector('.ap-nav-links [data-tab="' + t + '"]'), mark = document.querySelector('.ap-light');
        const a = on.getBoundingClientRect(), b = mark.getBoundingClientRect();
        return { active: on.classList.contains('tab-active'), others: document.querySelectorAll('.ap-nav-links .tab-active').length, gap: Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)), op: getComputedStyle(mark).opacity, bg: getComputedStyle(on).backgroundColor, color: getComputedStyle(on).color };
      }, tab);
      check('laptop ' + tab + ': the menu marks where you are, and only there', m.active && m.others === 1, JSON.stringify(m));
      check('laptop ' + tab + ': the moving mark is under it', m.gap < 3 && m.op === '1', JSON.stringify(m));
      check('laptop ' + tab + ': the marked link is white on the bar', /255, 255, 255/.test(m.color), m.color);
      const low = await page.evaluate(contrastOf, ['.ap-nav-links', '.ap-nav-right > button', '#tab-' + tab + ' .ap-band', '#tab-' + tab + ' #hero-band', '#tab-' + tab + ' .ap-pass']);
      check('laptop ' + tab + ': bar and heading readable', low.length === 0, low.slice(0, 4).join(' ; '));
    }

    await page.evaluate(() => switchTab('schedule'));
    await sleep(600);
    const hall = await page.evaluate(() => { const b = document.getElementById('sched-hall-tabs').children[0]; return { t: b.innerText.replace(/\s+/g, ' ').trim(), w: b.getBoundingClientRect().width }; });
    check('laptop: the first hall button has its words (it showed only an icon)', hall.t.includes('All halls') && hall.w > 90, JSON.stringify(hall));
    await page.evaluate(() => switchTab('dashboard'));

    // The notifications panel lives inside the dark bar's group and must stay dark on white.
    await page.click('#nav-notif-btn');
    await sleep(350);
    const panel = await page.evaluate(() => { const d = document.getElementById('notif-dropdown'); const t = d.querySelector('.text-sm'); return { open: !d.classList.contains('hidden'), color: getComputedStyle(t).color, bg: getComputedStyle(d).backgroundColor }; });
    check('laptop: the notifications panel opens', panel.open, JSON.stringify(panel));
    check('laptop: with dark words on white', !/255, 255, 255/.test(panel.color) && /255, 255, 255/.test(panel.bg), JSON.stringify(panel));
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.getElementById('notif-dropdown').classList.add('hidden'));

    await page.click('#nav-avatar-btn');
    await sleep(300);
    check('laptop: the avatar opens the account panel', await page.isVisible('#account-menu-panel'), 'closed');
    await page.evaluate(() => closeAccountMenu());

    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(300);
    const credit = await page.evaluate(() => document.querySelector('.ap-credit').innerText);
    check('laptop: the footer credits Skiper UI and Vengeance UI', /Skiper UI/.test(credit) && /Vengeance UI/.test(credit), credit);
    check('laptop: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- the menu at every width, signed in and out: nothing overlaps, nothing wraps out of the bar ----------
  for (const signedIn of [true, false]) {
    const { ctx, page, errors } = await open(browser, LAPTOP, { signedIn });
    for (const w of [768, 820, 900, 1024, 1100, 1180, 1280, 1366, 1440, 1920]) {
      await page.setViewportSize({ width: w, height: 800 });
      await sleep(250);
      const r = await page.evaluate(() => {
        const row = document.querySelector('.ap-nav-desk');
        const bar = row.getBoundingClientRect();
        const items = [...row.querySelectorAll('.ap-nav-links > a, .ap-nav-links > button, .ap-nav-right > button, .ap-nav-right > .js-avatar-btn > button')].concat(row.firstElementChild).filter((e) => e.getBoundingClientRect().width > 0);
        const rects = items.map((e) => ({ t: (e.innerText || e.tagName).trim().slice(0, 20), ...JSON.parse(JSON.stringify(e.getBoundingClientRect())) }));
        const hits = [];
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(a.t + ' x ' + b.t); }
        return { hits, out: rects.filter((x) => x.top < bar.top - 1 || x.bottom > bar.bottom + 1 || x.right > innerWidth).map((x) => x.t), sched: rects.some((x) => x.t.replace(/\s+/g, ' ').includes('Conference Schedule')), side: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      const who = (signedIn ? 'signed in' : 'signed out') + ' at ' + w + 'px';
      check('menu ' + who + ': nothing overlaps', r.hits.length === 0, r.hits.join(' ; '));
      check('menu ' + who + ': everything stays in the bar', r.out.length === 0, r.out.join(','));
      check('menu ' + who + ': Conference Schedule is there', r.sched, 'missing');
      check('menu ' + who + ': no sideways scroll', r.side <= 0, r.side + 'px');
    }
    check('menu ' + (signedIn ? 'signed in' : 'signed out') + ': no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- phones of other sizes ----------
  for (const [w, h] of [[320, 568], [360, 740], [414, 896], [600, 900]]) {
    const { ctx, page } = await open(browser, { ...PHONE, viewport: { width: w, height: h } });
    const r = await page.evaluate(() => ({ side: document.documentElement.scrollWidth - document.documentElement.clientWidth, tabs: [...document.querySelectorAll('.ap-nav-phone > *')].filter((b) => b.getBoundingClientRect().width > 0).every((b) => b.getBoundingClientRect().right <= innerWidth), top: [...document.querySelectorAll('#app-topbar .nav-btn')].filter((b) => b.getBoundingClientRect().width > 0).every((b) => b.getBoundingClientRect().right <= innerWidth) }));
    check('a ' + w + 'px phone: no sideways scroll', r.side <= 0, r.side + 'px');
    check('a ' + w + 'px phone: every tab and top button is on the screen', r.tabs && r.top, JSON.stringify(r));
    await ctx.close();
  }

  // ---------- signed out ----------
  for (const [name, opts] of [['phone', PHONE], ['laptop', LAPTOP]]) {
    const { ctx, page, errors } = await open(browser, opts, { signedIn: false });
    const s = await page.evaluate(() => {
      const h1 = document.querySelector('#hero-band h1');
      return { h1: h1.innerText.replace(/\s+/g, ' ').trim(), font: getComputedStyle(h1.querySelector('.ap-grad')).fontFamily, word: document.getElementById('hero-wordmark').getBoundingClientRect().height, learn: getComputedStyle(document.querySelector('.ap-btn-ghost')).color };
    });
    check(name + ' signed out: the billboard', s.h1 === 'Bharat AI Innovation', s.h1);
    check(name + ' signed out: in the heading font', /Bricolage/.test(s.font), s.font);
    check(name + ' signed out: the signed-in wordmark is hidden', s.word === 0, String(s.word));
    check(name + ' signed out: Learn More is white, not the old near-invisible grey', /255, 255, 255/.test(s.learn), s.learn);
    const low = await page.evaluate(contrastOf, ['#hero-band']);
    check(name + ' signed out: the hero is readable', low.length === 0, low.slice(0, 4).join(' ; '));
    await page.click('.ap-btn-primary');
    await sleep(350);
    check(name + ' signed out: Register Free opens the form', await page.isVisible('#registration-modal'), 'closed');
    await page.evaluate(() => document.getElementById('registration-modal').classList.add('hidden'));
    if (name === 'phone') {
      check('phone signed out: Log In / Register at the top', await page.isVisible('#app-topbar .js-signin-btn'), 'hidden');
      await page.tap('#app-topbar .js-signin-btn');
      await sleep(350);
      check('phone signed out: it opens the form', await page.isVisible('#registration-modal'), 'closed');
      await page.evaluate(() => document.getElementById('registration-modal').classList.add('hidden'));
      check('phone signed out: and Sign In stays on the bottom bar', await page.isVisible('#nav-signin-btn'), 'hidden');
      check('phone signed out: Inbox and Me are not offered', !(await page.isVisible('#app-topbar [data-tab="inbox"]')) && !(await page.isVisible('#nav-mobile-me')), 'shown');
    }
    check(name + ' signed out: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- animations off ----------
  for (const [name, opts] of [['phone', PHONE], ['laptop', LAPTOP]]) {
    const { ctx, page, errors } = await open(browser, opts, { reduced: true });
    const r = await page.evaluate(() => ({
      moving: document.getAnimations().filter((a) => { const k = a.animationName || ''; return /^ap-/.test(k) && a.playState === 'running'; }).map((a) => a.animationName),
      word: document.querySelector('#hero-wordmark').innerText.replace(/\s+/g, ' ').trim(),
      spans: [...document.querySelectorAll('.ap-w > span')].every((s) => getComputedStyle(s).transform === 'none'),
      light: !!document.querySelector('.ap-light'),
    }));
    check(name + ' animations off: nothing moves', r.moving.length === 0, r.moving.join(','));
    check(name + ' animations off: the words are all in place', /Bharat AI Innovation/.test(r.word) && r.spans, JSON.stringify(r));
    check(name + ' animations off: no gliding mark, each link keeps its own', !r.light, 'mark added');
    if (name === 'laptop') {
      const own = await page.evaluate(() => getComputedStyle(document.querySelector('.ap-nav-links > .tab-active'), '::after').content);
      check('laptop animations off: the active link has its own mark', own !== 'none' && own !== 'normal', own);
    }
    check(name + ' animations off: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- coming back: the signed-in page from the first paint, not the signed-out one coming and going ----------
  {
    const returning = async (answer) => {
      const ctx = await browser.newContext({ ...PHONE });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // Seeded once only: signing out reloads the page, and a second seeding would sign the person back in.
      await page.addInitScript((u) => {
        if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('agba_user', JSON.stringify(u)); localStorage.setItem('agba_social_card_offered', '1'); }
        window.__cls = 0; window.__seen = { out: 0, samples: 0 };
        // Firefox and Safari have no layout-shift entries, so the jump is only measured where it can be.
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
        const watch = () => {
          const app = document.getElementById('content');
          if (app && !app.classList.contains('hidden')) {
            window.__seen.samples++;
            window.__seen.out = Math.max(window.__seen.out, [...document.querySelectorAll('.signed-out-only')].filter((e) => e.getBoundingClientRect().height > 0).length);
          }
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }, USER);
      await page.route('**/api/events/1/attendees/register', answer);
      await page.goto(BASE + '/app', { waitUntil: 'load', timeout: 60000 });
      return { ctx, page, errors };
    };

    // The server takes its time, as it does on slow 4G.
    {
      let answered = false;
      const { ctx, page, errors } = await returning(async (route) => {
        await sleep(5000);
        answered = true;
        await route.fulfill({ json: USER });
      });
      await page.waitForFunction(() => { const s = document.getElementById('hero-band'); return s && s.classList.contains('ap-in'); }, null, { timeout: 30000 });
      const during = await page.evaluate(() => ({ passShown: !document.getElementById('pass-card-cta').classList.contains('hidden'), name: document.getElementById('pcc-pass-name').textContent, avatar: !document.getElementById('nav-mobile-me').classList.contains('hidden'), signin: [...document.querySelectorAll('.js-signin-btn')].filter((b) => b.getBoundingClientRect().width > 0).length }));
      check('coming back: this is measured before the server has answered', !answered, 'already answered');
      check('coming back: the pass card is there while the answer is on its way', during.passShown && /Visitor Pass/.test(during.name), JSON.stringify(during));
      check('coming back: Me is there, and no Log In / Register', during.avatar && during.signin === 0, JSON.stringify(during));
      await sleep(7000);
      const after = await page.evaluate(() => ({ seen: window.__seen, cls: window.__cls, role: document.getElementById('role-home').innerText, hero: document.getElementById('hero-band').classList.contains('ap-in') }));
      check('coming back: nothing meant for someone signed out ever showed', after.seen.samples > 5 && after.seen.out === 0, JSON.stringify(after.seen));
      check('coming back: the page barely moved while loading (' + after.cls.toFixed(3) + ')', after.cls < 0.1, String(after.cls));
      check('coming back: once answered, the full page is drawn', /Welcome back, Riya/.test(after.role) && after.hero, after.role.slice(0, 60));
      check('coming back: no page errors', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // The sign-in ran out: the saved person must not stay on the screen.
    {
      const { ctx, page, errors } = await returning((route) => route.fulfill({ status: 401, json: { error: 'Please sign in again' } }));
      await page.waitForFunction(() => !localStorage.getItem('agba_user'), null, { timeout: 30000 });
      await sleep(1000);
      const r = await page.evaluate(() => ({ pass: document.getElementById('pass-card-cta').classList.contains('hidden'), h1: document.querySelector('#hero-band h1').getBoundingClientRect().height, hero: document.getElementById('hero-band').classList.contains('ap-in'), me: document.getElementById('nav-mobile-me').getBoundingClientRect().width, box: !document.getElementById('registration-modal').classList.contains('hidden') }));
      check('sign-in ran out: their pass card goes', r.pass, JSON.stringify(r));
      check('sign-in ran out: the signed-out page comes back', r.h1 > 0 && !r.hero, JSON.stringify(r));
      check('sign-in ran out: Me goes', r.me === 0, JSON.stringify(r));
      check('sign-in ran out: and the sign-in box opens', r.box, JSON.stringify(r));
      check('sign-in ran out: no page errors', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // Venue Wi-Fi: no answer at all keeps the person signed in, as it has since 2 Nov 2026.
    {
      const { ctx, page, errors } = await returning((route) => route.abort());
      await page.waitForFunction(() => { const r = document.getElementById('role-home'); return r && /Welcome back/.test(r.innerText); }, null, { timeout: 30000 });
      const r = await page.evaluate(() => ({ saved: !!localStorage.getItem('agba_user'), hero: document.getElementById('hero-band').classList.contains('ap-in'), pass: !document.getElementById('pass-card-cta').classList.contains('hidden'), out: [...document.querySelectorAll('.signed-out-only')].filter((e) => e.getBoundingClientRect().height > 0).length }));
      check('no answer: still signed in, with the pass card', r.saved && r.hero && r.pass && r.out === 0, JSON.stringify(r));
      check('no answer: no page errors', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // Nobody saved on this device: the signed-out page, straight away.
    {
      const ctx = await browser.newContext({ ...PHONE });
      const page = await ctx.newPage();
      await page.goto(BASE + '/app', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => { const c = document.getElementById('content'); return c && !c.classList.contains('hidden'); }, null, { timeout: 30000 });
      await sleep(400);
      const r = await page.evaluate(() => ({ h1: document.querySelector('#hero-band h1').getBoundingClientRect().height, choose: document.getElementById('pass-comparison-section').getBoundingClientRect().height, pass: document.getElementById('pass-card-cta').classList.contains('hidden') }));
      check('a first visit: the billboard and Choose Your Pass, and no pass card', r.h1 > 0 && r.choose > 0 && r.pass, JSON.stringify(r));
      await ctx.close();
    }
  }

  // ---------- how much keeps moving while someone reads: a small, bounded number ----------
  {
    const { ctx, page } = await open(browser, PHONE);
    await sleep(1200);
    // Cards settling in are driven by the scroll position, so they cost nothing while the page is still.
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.timeline instanceof DocumentTimeline && /^ap-/.test(a.animationName || '')).map((a) => a.animationName));
    check('phone: only the hero\'s light and the pass\'s edge run while reading', running.length <= 2 && running.every((n) => n === 'ap-drift' || n === 'ap-turn'), running.join(','));
    await ctx.close();
  }

  // ---------- without the files: every word stays, and the app works ----------
  for (const [what, block] of [['motion files', ['**/app-motion.*']], ['design and motion files', ['**/app-motion.*', '**/app-design.css*']]]) {
    for (const [name, opts] of [['phone', PHONE], ['laptop', LAPTOP]]) {
      const { ctx, page, errors } = await open(browser, opts, { block });
      const r = await page.evaluate(() => ({ pass: document.getElementById('pcc-pass-name').innerText, dl: document.getElementById('pcc-download-btn').getBoundingClientRect().height > 0 }));
      check(name + ' without the ' + what + ': the pass card works', /Visitor Pass/.test(r.pass) && r.dl, JSON.stringify(r));
      await page.evaluate(() => switchTab('schedule'));
      await sleep(500);
      check(name + ' without the ' + what + ': Conference Schedule opens', /Conference\s+Schedule/.test(await page.innerText('#tab-schedule')), 'closed');
      const low = await page.evaluate(contrastOf, ['#tab-schedule .ap-band']);
      check(name + ' without the ' + what + ': the heading is readable', low.length === 0, low.slice(0, 3).join(' ; '));
      await page.evaluate(() => switchTab('dashboard'));
      await sleep(250);
      const passLow = await page.evaluate(contrastOf, ['#pass-card-cta h3', '#pass-card-cta #pcc-pass-note']);
      check(name + ' without the ' + what + ': the pass card is readable', passLow.length === 0, passLow.slice(0, 3).join(' ; '));
      check(name + ' without the ' + what + ': no page errors', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }

  await browser.close();
  console.log(`\nbrowser-app-redesign: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('crashed: ' + e.message); process.exit(1); });
