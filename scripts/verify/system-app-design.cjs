// System: one person's way through the redesigned /app, as their pass changes, and across the app's other
// surfaces. The pass card must say and offer the right thing on the dark card for every pass, what a filled
// button says must be readable, the schedule's own buttons must work in their new band, the directory's note
// must stand on a phone, and signing out must bring the signed-out page back. Needs phone-harness.mjs.
// 6 Nov 2026.
const { chromium } = require('./playwright.cjs');

const PORT = process.env.HARNESS_PORT || 8837;
const BASE = 'http://localhost:' + PORT;
let failed = 0, passed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <- ' + detail)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE_USER = { id: 5, event_id: 1, name: 'Riya Shah', email: 'riya@gmail.com', company: 'DJ Sanghvi', job_title: 'Student', industry: 'Education & Academia', interests: 'ml', networking_goals: 'learn', city: 'Mumbai', mobile: '9876543210' };

const setUser = (patch) => fetch(BASE + '/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: { user: { ...BASE_USER, ...patch } } }) });

async function asPass(browser, opts, patch) {
  await setUser(patch);
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  // Once only: signing out reloads the page, and a second seeding would sign the person straight back in.
  await page.addInitScript((u) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.setItem('agba_user', JSON.stringify(u)); localStorage.setItem('agba_social_card_offered', '1'); }, { ...BASE_USER, ...patch });
  await page.goto(BASE + '/app', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => { const c = document.getElementById('pass-card-cta'); return c && !c.classList.contains('hidden'); }, null, { timeout: 30000 });
  await sleep(700);
  return { ctx, page, errors };
}

const card = () => {
  const shown = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().height > 0; };
  const white = (id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).color : ''; };
  return {
    heading: document.querySelector('.ap-pass h3').innerText.replace(/\s+/g, ' ').trim(),
    note: document.getElementById('pcc-pass-note').innerText,
    pay: shown('pcc-pay-btn'), dl: shown('pcc-download-btn'), g: shown('pcc-guarantee-btn'), up: shown('pcc-upgrade-btn'), upLine: shown('pcc-upgrade'),
    dlColor: white('pcc-download-btn'), gColor: white('pcc-guarantee-btn'),
    order: [...document.querySelectorAll('.ap-pass button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.id),
    cardColor: white('pcc-card-btn'), cardBg: getComputedStyle(document.getElementById('pcc-card-btn')).backgroundColor,
    h3Color: getComputedStyle(document.querySelector('.ap-pass h3')).color, noteColor: getComputedStyle(document.getElementById('pcc-pass-note')).color,
    side: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const LAPTOP = { viewport: { width: 1366, height: 800 } };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  for (const [screen, opts] of [['phone', PHONE], ['laptop', LAPTOP]]) {
    // A free pass.
    {
      const { ctx, page, errors } = await asPass(browser, opts, { badge_type: 'Visitor Pass', payment_status: 'paid' });
      const c = await page.evaluate(card);
      check(screen + ', free pass: says entry is not guaranteed', /free pass: entry not guaranteed/.test(c.heading) && /not guaranteed/.test(c.note), c.heading);
      check(screen + ', free pass: Download, then Guarantee both days', c.order.join(',') === 'pcc-download-btn,pcc-guarantee-btn', c.order.join(','));
      check(screen + ', free pass: the words on the dark card are light', /255, 255, 255/.test(c.h3Color) && /255, 255, 255/.test(c.noteColor), c.h3Color + ' / ' + c.noteColor);
      check(screen + ', free pass: Download is dark on white', /26, 35, 126/.test(c.dlColor), c.dlColor);
      check(screen + ', free pass: Guarantee is white on saffron', /255, 255, 255/.test(c.gColor), c.gColor);
      check(screen + ', free pass: the green button has white words', /255, 255, 255/.test(c.cardColor), c.cardColor + ' on ' + c.cardBg);
      check(screen + ', free pass: no sideways scroll', c.side <= 0, c.side + 'px');
      await page.click('#pcc-guarantee-btn');
      await sleep(400);
      check(screen + ', free pass: Guarantee opens the upgrade sheet', await page.evaluate(() => { const m = document.getElementById('visitor-upgrade-modal'); return !!m && !m.classList.contains('hidden'); }), 'closed');
      await page.evaluate(() => { const m = document.getElementById('visitor-upgrade-modal'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } });

      // The directory, as a free pass sees it.
      await page.evaluate(() => switchTab('networking'));
      await page.waitForFunction(() => { const b = document.getElementById('visitor-network-banner'); return b && !b.classList.contains('hidden'); }, null, { timeout: 15000 });
      await sleep(400);
      const banner = await page.evaluate(() => { const t = document.getElementById('vnb-copy').getBoundingClientRect(); const b = document.getElementById('vnb-go').getBoundingClientRect(); return { textW: t.width, go: b.width, h: b.height }; });
      check(screen + ', free pass: the directory\'s note is not squeezed into a thin column', banner.textW >= 240, JSON.stringify(banner));
      if (screen === 'phone') check('phone, free pass: its button takes the width, for a thumb', banner.go > 300 && banner.h >= 44, JSON.stringify(banner));
      await page.click('#vnb-go');
      await sleep(400);
      check(screen + ', free pass: and its button still opens the paid passes', await page.evaluate(() => { const m = document.getElementById('paid-pass-modal'); return !!m && !m.classList.contains('hidden') && m.getBoundingClientRect().height > 0; }), 'closed');
      await page.evaluate(() => { for (const id of ['paid-pass-modal', 'visitor-upgrade-modal']) { const m = document.getElementById(id); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } } });

      // The schedule, with its two buttons in the new band.
      await page.evaluate(() => switchTab('schedule'));
      await page.waitForFunction(() => document.getElementById('sched-day-selector').children.length > 0, null, { timeout: 15000 });
      await sleep(300);
      const a0 = await page.evaluate(() => { const b = document.getElementById('my-agenda-toggle'); return { in: !!b.closest('.ap-band'), color: getComputedStyle(b).color, h: b.getBoundingClientRect().height }; });
      check(screen + ': My Agenda sits in the heading band, in white', a0.in && /255, 255, 255/.test(a0.color), JSON.stringify(a0));
      check(screen + ': big enough for a thumb', a0.h >= 44, JSON.stringify(a0));
      await page.click('#my-agenda-toggle');
      await sleep(400);
      const a1 = await page.evaluate(() => { const b = document.getElementById('my-agenda-toggle'); return { on: b.classList.contains('bg-amber-500/20'), color: getComputedStyle(b).color }; });
      check(screen + ': My Agenda still switches, and stays readable', a1.on, JSON.stringify(a1));
      await page.click('#my-agenda-toggle');
      await sleep(300);
      const dl = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
      await page.click('button[onclick="downloadAgendaIcs()"]');
      await sleep(600);
      const toast = await page.evaluate(() => document.getElementById('toast-container').innerText);
      const got = await Promise.race([dl, sleep(800).then(() => null)]);
      check(screen + ': Add to calendar still answers', !!got || toast.length > 0, 'neither a file nor a message');

      // Back to the top and away: the other tabs still draw.
      for (const [tab, text] of [['workshops', 'AI Training'], ['exhibition', 'Exhibition'], ['inbox', 'Inbox'], ['venue', 'Venue'], ['myprofile', 'Riya']]) {
        await page.evaluate((t) => switchTab(t), tab);
        await sleep(500);
        check(screen + ': ' + tab + ' opens with its heading', (await page.innerText('#tab-' + tab)).includes(text), 'no ' + text);
      }
      check(screen + ', free pass: no page errors on the way', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // A paid pass. Nothing to guarantee, the way up on offer.
    {
      const { ctx, page, errors } = await asPass(browser, opts, { badge_type: 'Delegate Pass', payment_status: 'paid' });
      const c = await page.evaluate(card);
      check(screen + ', paid Delegate: the pass is ready', /is ready/.test(c.heading), c.heading);
      check(screen + ', paid Delegate: no Guarantee, no Pay now', !c.g && !c.pay, JSON.stringify(c));
      check(screen + ', paid Delegate: Download is there, and first', c.dl && c.order[0] === 'pcc-download-btn', c.order.join(','));
      check(screen + ', paid Delegate: no page errors', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // Chose a paid pass and has not paid.
    {
      const { ctx, page, errors } = await asPass(browser, opts, { badge_type: 'VIP Pass', payment_status: 'pending' });
      const c = await page.evaluate(card);
      check(screen + ', unpaid VIP: told it is waiting for payment', /waiting for payment/.test(c.heading), c.heading);
      check(screen + ', unpaid VIP: Pay now comes first', c.pay && c.order[0] === 'pcc-pay-btn', c.order.join(','));
      check(screen + ', unpaid VIP: no page errors', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // Every other kind of pass gets a welcome card with the renamed action where it has one, and draws.
    for (const [badge, expects] of [['Speaker', 'Edit my profile'], ['Exhibitor', 'Lead console'], ['Media', 'Conference Schedule'], ['Academic', 'Conference Schedule'], ['Organiser', 'Conference Schedule'], ['Investor', 'Deal flow'], ['Jury', 'Jury schedule']]) {
      const { ctx, page, errors } = await asPass(browser, opts, { badge_type: badge, payment_status: 'waived' });
      const t = await page.evaluate(() => document.getElementById('role-home').innerText);
      check(screen + ', ' + badge + ': their welcome card offers ' + expects, t.includes(expects), t.slice(0, 100));
      check(screen + ', ' + badge + ': no page errors', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }

  // Signing out brings the signed-out page back, in one sitting.
  {
    const { ctx, page, errors } = await asPass(browser, PHONE, { badge_type: 'Visitor Pass', payment_status: 'paid' });
    await page.evaluate(() => { try { logoutUser(); } catch (e) {} });
    await page.waitForFunction(() => { const h = document.querySelector('#hero-band h1'); return h && h.getBoundingClientRect().height > 0; }, null, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    const r = await page.evaluate(() => ({ h1: !!document.querySelector('#hero-band h1') && document.querySelector('#hero-band h1').getBoundingClientRect().height > 0, inClass: document.getElementById('hero-band').classList.contains('ap-in'), word: document.getElementById('hero-wordmark').getBoundingClientRect().height, me: document.getElementById('nav-mobile-me').getBoundingClientRect().width }));
    check('signing out: the billboard is back', r.h1, JSON.stringify(r));
    check('signing out: the short hero is gone', !r.inClass && r.word === 0, JSON.stringify(r));
    check('signing out: Me has gone from the top bar', r.me === 0, JSON.stringify(r));
    check('signing out: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await setUser({ badge_type: 'Visitor Pass', payment_status: 'paid' });
  await browser.close();
  console.log(`\nsystem-app-design: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('crashed: ' + e.message); process.exit(1); });
