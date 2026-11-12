// End to end: the people on the /conference schedule, on a phone, a small phone and a
// laptop in a real browser, through delhi-harness.mjs (12 Nov 2026). Each keynote,
// talk and panel shows a small round photo, the name, the designation, the department
// or organisation and its logo. Nothing widens the page in any hall on either day,
// every picture loads, the tabs still switch, and a phone reads it without zooming.
// Run by run-all.mjs.
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8786);
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SMALL = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1306, height: 760 } };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [name, opts] of [['phone', PHONE], ['small phone', SMALL], ['laptop', LAPTOP]]) {
      const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
      const p = await ctx.newPage();
      const errors = [], missing = [];
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) missing.push(r.url()); });
      await p.goto(BASE + '/conference', { waitUntil: 'load' });
      await p.evaluate(() => document.fonts.ready);
      await p.evaluate(() => document.querySelector('#schedule').scrollIntoView({ block: 'start' }));
      await p.waitForTimeout(900);

      // Every hall, both days: the page keeps its width and every picture arrives.
      const halls = await p.evaluate(async () => {
        const de = document.documentElement;
        const out = { wide: [], broken: [], people: 0, tabs: document.querySelectorAll('.hall-tab').length };
        for (let hall = 0; hall < 5; hall++) for (const day of [0, 1]) {
          switchHall(hall); switchDay('hall-' + hall, day);
          const panel = document.querySelector('#hall-' + hall + ' .schedule-panel.active');
          const imgs = [...panel.querySelectorAll('img')];
          await Promise.all(imgs.map((i) => { i.loading = 'eager'; return i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }); }));
          for (const i of imgs) if (!i.naturalWidth) out.broken.push(i.getAttribute('src'));
          if (de.scrollWidth > de.clientWidth) out.wide.push('hall ' + hall + ' day ' + (day + 1) + ': ' + de.scrollWidth + ' > ' + de.clientWidth);
          for (const el of panel.querySelectorAll('.schedule-item, .sch-person, .sch-logo, .sch-who')) {
            const r = el.getBoundingClientRect();
            if (r.width && (r.right > de.clientWidth + 0.5 || r.left < -0.5)) { out.wide.push('hall ' + hall + ' day ' + (day + 1) + ': ' + el.className + ' ends at ' + Math.round(r.right)); break; }
          }
          out.people += panel.querySelectorAll('.sch-person').length;
        }
        switchHall(0); switchDay('hall-0', 0);
        return out;
      });
      check(name + ': four halls and the Full Schedule', halls.tabs === 5, String(halls.tabs));
      check(name + ': no hall on either day widens the page or runs past its edge', halls.wide.length === 0, halls.wide.slice(0, 3).join(' | '));
      check(name + ': every photo and logo loads', halls.broken.length === 0, halls.broken.slice(0, 4).join(', '));
      check(name + ': people are shown in every tab', halls.people >= 150, String(halls.people));

      // The Governance panel, as a visitor sees it.
      const gov = await p.evaluate(() => {
        const item = [...document.querySelectorAll('#hall-0 .schedule-panel.active .schedule-item')].find((i) => /AI for Viksit Bharat/.test(i.textContent));
        item.scrollIntoView({ block: 'start' });
        const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const cards = [...item.querySelectorAll('.sch-person')];
        const px = (el, k) => parseFloat(getComputedStyle(el)[k]);
        const first = cards[0];
        const photo = first.querySelector('.sch-photo');
        const logos = [...item.querySelectorAll('.sch-logo')].map(box);
        return {
          n: cards.length,
          cols: new Set(cards.map((c) => Math.round(box(c).l))).size,
          photo: { ...box(photo), radius: getComputedStyle(photo).borderRadius },
          name: px(first.querySelector('.sch-name'), 'fontSize'), role: px(first.querySelector('.sch-role'), 'fontSize'), org: px(first.querySelector('.sch-org'), 'fontSize'),
          logoMaxH: Math.max(...logos.map((l) => l.h)), logoMaxW: Math.max(...logos.map((l) => l.w)), logoMinH: Math.min(...logos.map((l) => l.h)), logos: logos.length,
          logoInside: [...item.querySelectorAll('.sch-logo')].every((l) => { const a = box(l), c = box(l.closest('.sch-person')); return a.l >= c.l - 0.5 && a.r <= c.r + 0.5; }),
          overlap: cards.some((c) => { const ph = box(c.querySelector('.sch-photo')), nm = box(c.querySelector('.sch-name')); return nm.l < ph.r; }),
          tag: (() => { const t = item.querySelector('.sch-tag'); return t ? { text: t.textContent, h: box(t).h } : null; })(),
          time: box(item.querySelector('.schedule-time')), badge: box(item.querySelector('.schedule-badge')), info: box(item.querySelector('.schedule-info')), itemBox: box(item),
          text: first.textContent,
        };
      });
      const phone = name !== 'laptop';
      check(name + ': the panel lists eleven people', gov.n === 11, String(gov.n));
      check(name + ': ' + (phone ? 'one person to a line' : 'two people to a line'), gov.cols === (phone ? 1 : 2), String(gov.cols));
      check(name + ': the photo is small and round', Math.abs(gov.photo.w - 48) < 1 && Math.abs(gov.photo.h - 48) < 1 && gov.photo.radius === '50%', JSON.stringify(gov.photo));
      check(name + ': the name never runs under the photo', !gov.overlap);
      check(name + ': name, designation and department are readable sizes', gov.name >= 15 && gov.role >= 13.4 && gov.org >= 13.1 && (!phone || (gov.role >= 14 && gov.org >= 13.6)), JSON.stringify([gov.name, gov.role, gov.org]));
      check(name + ': the first person is named with designation and department', /Shri Prakash Kumar/.test(gov.text) && /Additional Director/.test(gov.text) && /IndiaAI Mission, MeitY, Government of India/.test(gov.text), gov.text);
      check(name + ': logos are drawn, inside their person, and no bigger than a small seal', gov.logos >= 8 && gov.logoInside && gov.logoMaxH <= 40.5 && gov.logoMaxW <= 92.5 && gov.logoMinH >= 12, JSON.stringify([gov.logos, gov.logoMaxW, gov.logoMaxH, gov.logoMinH]));
      check(name + ': the moderator is marked', gov.tag && gov.tag.text === 'Moderator' && gov.tag.h > 10, JSON.stringify(gov.tag));
      if (phone) {
        check(name + ': the time and the kind of session share the top line, the people have the full width under them', Math.abs((gov.time.t + gov.time.h / 2) - (gov.badge.t + gov.badge.h / 2)) < 8 && gov.info.t >= gov.time.b - 1 && gov.info.w > gov.itemBox.w - 48, JSON.stringify([gov.time, gov.badge, gov.info.w, gov.itemBox.w]));
      } else {
        check(name + ': the time, the session and its kind sit side by side, level with the title', gov.time.r < gov.info.l && gov.info.r < gov.badge.l && Math.abs(gov.time.t - gov.info.t) < 12, JSON.stringify([gov.time, gov.info, gov.badge]));
      }

      // A keynote with no title: the speaker is the heading.
      const lead = await p.evaluate(() => {
        const item = [...document.querySelectorAll('#hall-0 .schedule-panel.active .schedule-item.has-lead')].find((i) => /Chandrakant Dada Patil/.test(i.textContent));
        item.scrollIntoView({ block: 'center' });
        const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const h = item.querySelector('h4'), ph = item.querySelector('.sch-photo'), logo = item.querySelector('.sch-logo'), who = item.querySelector('.sch-who');
        return { h4: h.textContent, photo: box(ph), logo: box(logo), who: box(who), heading: box(h), text: item.textContent.replace(/\s+/g, ' '), logoLoaded: logo.naturalWidth > 0 };
      });
      check(name + ': a keynote names the speaker as its heading, with designation and government', lead.h4 === 'Hon’ble Shri Chandrakant Dada Patil' && /Minister of Higher and Technical Education/.test(lead.text) && /Government of Maharashtra/.test(lead.text), lead.text);
      check(name + ': the keynote photo is a little larger, and the seal is beside the words, not over them', lead.photo.w >= 55 && lead.photo.w <= 61 && lead.logoLoaded && lead.logo.l >= lead.heading.l && lead.logo.r <= lead.who.r + 0.5 && lead.photo.r <= lead.heading.l, JSON.stringify([lead.photo.w, lead.logo, lead.who]));

      // The tabs still work, and the other tabs show their people.
      const tabs = await p.evaluate(() => {
        switchHall(1); switchDay('hall-1', 0);
        const expo = document.querySelector('#hall-1 .schedule-panel.active');
        const t = { expoShown: getComputedStyle(document.querySelector('#hall-1')).display !== 'none', expoPeople: expo.querySelectorAll('.sch-person').length, expoText: expo.querySelector('.schedule-item.has-people').textContent.replace(/\s+/g, ' ') };
        switchHall(4); switchDay('hall-4', 0);
        const full = document.querySelector('#hall-4 .schedule-panel.active');
        t.fullPeople = full.querySelectorAll('.sch-person').length; t.fullHallTags = full.querySelectorAll('.hall-label').length;
        switchDay('hall-4', 1);
        t.day2People = document.querySelector('#hall-4 .schedule-panel.active').querySelectorAll('.sch-person').length;
        switchHall(0); switchDay('hall-0', 0);
        return t;
      });
      check(name + ': the Expo Hall tab shows each talk with its speaker and company', tabs.expoShown && tabs.expoPeople >= 15 && /Innovation Talk:/.test(tabs.expoText), JSON.stringify(tabs));
      check(name + ': the Full Schedule shows people on both days, each row with its hall', tabs.fullPeople >= 40 && tabs.fullHallTags >= 20 && tabs.day2People >= 15, JSON.stringify(tabs));

      // Tracks: press a session, and the schedule opens on its hall and day with it in view.
      await p.evaluate(() => document.querySelector('#tracks').scrollIntoView({ block: 'start' }));
      await p.waitForTimeout(400);
      const trackRows = await p.locator('#tracks .conf-track-row.trk').count();
      const wideTracks = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(name + ': Tracks shows the keynotes and every track, without widening the page', trackRows >= 12 && wideTracks <= 0, JSON.stringify([trackRows, wideTracks]));
      await p.locator('#tracks a.trk-title', { hasText: 'Transforming Indian Agriculture' }).click();
      await p.waitForTimeout(1500);
      const opened = await p.evaluate(() => {
        const el = document.querySelector('.schedule-item.sch-flash');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { id: el.id, hall: document.querySelector('.hall-tab.active').textContent.trim(), day: el.closest('.hall-panel').querySelector('.schedule-tab.active').textContent.trim(), inView: r.top >= 0 && r.bottom <= innerHeight, hash: location.hash };
      });
      check(name + ': a session pressed in Tracks opens on its hall and day, in view, and the address names it', opened && opened.id === 'sch-aryabhata-2-1100' && opened.hall === 'Kalam Theatre' && /Day 2/.test(opened.day) && opened.inView && opened.hash === '#sch-aryabhata-2-1100', JSON.stringify(opened));
      await p.locator('#tracks .trk-all summary').click();
      await p.waitForTimeout(300);
      const talks = await p.locator('#tracks .trk-all[open] .trk-s').count();
      check(name + ': "All talks and their topics" opens the full list of Innovation Talks', talks >= 20, String(talks));

      check(name + ': no script error and no missing file', errors.length === 0 && missing.length === 0, errors.concat(missing).slice(0, 4).join(' | '));
      await ctx.close();
    }
    // A link from anywhere straight to a session: /conference#sch-...
    const ctx = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    await p.goto(BASE + '/conference#sch-raman-2-1400', { waitUntil: 'load' });
    await p.waitForTimeout(1800);
    const deep = await p.evaluate(() => { const el = document.getElementById('sch-raman-2-1400'); const r = el.getBoundingClientRect(); return { shown: r.height > 0, inView: r.top >= 0 && r.bottom <= innerHeight, title: el.querySelector('h4').textContent }; });
    check('phone: a link to /conference#sch-... opens that session in the schedule', deep.shown && deep.inView && /Speech Recognition/.test(deep.title), JSON.stringify(deep));
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
