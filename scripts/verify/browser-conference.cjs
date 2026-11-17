// Admin -> Conference (12 Nov 2026) in a real browser (Edge), on the real built worker
// and real SQLite (conference-harness.mjs, 0054 applied). On a laptop, as the
// organisers: the board with both hall names; a session added by clicking a hall, its
// speaker picked by typing; a clash shown while typing, refused, then saved anyway and
// fixed; a draft kept from attendees; a speaker added with a photo and given a slot
// from their card (a photo chosen for a listed speaker is saved at once; a file that
// is not a picture is refused with a reason); a speaker announced; their slot emailed; hide and show; a hall
// changed; the list, the CSV and the run sheet; Escape. On a phone: Admin fits the
// screen; in the app, a speaker's "When and where" and the Conference Schedule show
// both hall names, and nothing typed in Admin runs on the page. No page errors.
// Needs conference-harness.mjs (HARNESS_PORT, default 8857). Started by run-all.mjs.
const crypto = require('crypto');
const path = require('path');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8857);
const PHOTO = path.join(__dirname, '..', '..', 'public', 'images', 'talks', 'aditi-saini.webp');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(150); } return false; };
const dbq = async (q) => (await fetch(BASE + '/__db?q=' + encodeURIComponent(q))).json();
const appCookie = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const b = id + '.' + exp; return b + '.' + crypto.createHmac('sha256', 'h').update(b).digest('hex'); };
// Not in frames: the email preview is a sandboxed frame with no storage of its own.
const adminInit = () => { if (window.top !== window) return; sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); };

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1/sessions')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ================= the organisers, on a laptop =================
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await ctx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await ctx.addInitScript(adminInit);
    const page = await ctx.newPage();
    const errors = [];
    // Playwright's own service-worker blocking reads navigator.serviceWorker in every
    // frame, which a sandboxed frame refuses: that is the harness, not the page.
    page.on('pageerror', e => { if (!/sandboxed/.test(String(e))) errors.push(String(e)); });
    page.on('dialog', d => (d.type() === 'prompt' ? d.accept('DELETE') : d.accept()));
    await page.goto(BASE + '/admin#sessions', { waitUntil: 'domcontentloaded' });
    check('Admin opens on Conference with its numbers', await until(() => page.locator('.cm-stats').isVisible(), 20000));
    check('the sidebar says Conference', (await page.locator('[data-section="sessions"] .sidebar-label').textContent()).trim() === 'Conference');
    // On a busy machine the board can land a moment after the numbers.
    await until(async () => (await page.locator('.cm-head').count()) >= 4, 15000);
    const heads = await page.locator('.cm-head').allTextContents();
    check('the board has a column per hall, each with the venue’s name', heads.join('|').includes('Peacock Hall') && heads.join('|').includes('Expo Hall') && heads.join('|').includes('Centrum Hall B'), heads);
    check('no "one step left" note: 0054 has run', !(await page.locator('.cm-banner.is-warn').count()));
    check('the day’s sessions are on the board', (await page.locator('.cm-block').count()) === 3);

    // ---- a session added by clicking an empty space in a hall ----
    await page.evaluate(() => {
      const lane = [...document.querySelectorAll('.cm-lane')].find(l => l.getAttribute('data-hall') === 'Kalam Theatre');
      const r = lane.getBoundingClientRect();
      const y = r.top + (16 * 60 - Number(lane.getAttribute('data-start'))) * 2.2 + 3;
      lane.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 20, clientY: y }));
    });
    check('clicking a hall at 4 pm opens "Add a session" there, at that time', await until(async () => (await page.locator('#cm-drawer.is-open').count()) === 1) &&
      (await page.locator('#cm-s-room').inputValue()) === 'Kalam Theatre' && (await page.locator('#cm-s-start').inputValue()) === '16:00');
    await page.fill('#cm-s-title', 'Agentic AI in Lending');
    await page.click('.cm-dur[data-k="30"]');
    check('a length button sets the end', (await page.locator('#cm-s-end').inputValue()) === '16:30');
    await page.locator('#cm-s-pick').pressSequentially('dhuri');
    check('typing a name offers the speaker', await until(() => page.locator('.cm-pick-item[data-cm="pick"]').first().isVisible()));
    await page.locator('.cm-pick-item[data-cm="pick"]').first().click();
    check('...and picking them lists them with their part', (await page.locator('.cm-person').count()) === 1 && (await page.locator('.cm-person').textContent()).includes('Shailesh Dhuri'));
    await page.click('#cm-s-save');
    check('saved: the drawer closes and the session is on the board', await until(async () => (await page.locator('#cm-drawer.is-open').count()) === 0 && (await page.locator('.cm-block', { hasText: 'Agentic AI in Lending' }).count()) === 1));
    const newId = (await dbq("SELECT id FROM sessions WHERE title = 'Agentic AI in Lending'"))[0]?.id;
    check('the speaker is saved as a link', (await dbq('SELECT speaker_id FROM session_speakers WHERE session_id = ' + Number(newId))).some(r => r.speaker_id === 3));

    // ---- a clash, shown while typing, refused, saved anyway, fixed ----
    await page.click('[data-cm="new-session"]');
    await until(() => page.locator('#cm-drawer.is-open').count());
    await page.fill('#cm-s-title', 'Clash test');
    await page.selectOption('#cm-s-room', 'Homi J. Bhabha Hall');
    await page.fill('#cm-s-start', '14:30');
    await page.fill('#cm-s-end', '14:40');
    await page.dispatchEvent('#cm-s-end', 'change');
    check('the clash shows while typing, naming the session already there', await until(async () => ((await page.locator('#cm-s-clash').textContent()) || '').includes('AI Democratizing')));
    await page.click('#cm-s-save');
    check('saving is refused with "Save anyway" offered', await until(() => page.locator('[data-cm="save-session-force"]').isVisible()));
    await page.click('[data-cm="save-session-force"]');
    check('"Save anyway" saves it, and the board marks the clash in red', await until(async () => (await page.locator('.cm-block.is-clash').count()) >= 2));
    check('the clash is counted at the top, as something that cannot run', (await page.locator('[data-cm="stat-attention"]').getAttribute('data-bad')) === '1' && /1 cannot run as written/.test(await page.locator('[data-cm="stat-attention"]').innerText()));
    await page.locator('.cm-block', { hasText: 'Clash test' }).click();
    await until(() => page.locator('#cm-drawer.is-open').count());
    await page.click('[data-cm="del-session"]');
    check('deleting it clears the clash', await until(async () => (await page.locator('.cm-block.is-clash').count()) === 0 && (await page.locator('[data-cm="stat-attention"]').getAttribute('data-bad')) === '0'));

    // ---- a draft ----
    await page.locator('.cm-block', { hasText: 'Agentic AI in Lending' }).click();
    await until(() => page.locator('#cm-drawer.is-open').count());
    await page.check('#cm-s-draft');
    await page.fill('#cm-s-note', 'Waiting for the deck');
    await page.click('#cm-s-save');
    check('a draft is drawn dashed on the board', await until(async () => (await page.locator('.cm-block.is-draft', { hasText: 'Agentic AI in Lending' }).count()) === 1));
    const pub = await (await fetch(BASE + '/api/events/1/sessions')).json();
    check('attendees do not get the draft', !pub.some(s => s.title === 'Agentic AI in Lending') && pub.length === 4, pub.map(s => s.title));

    // ---- a speaker added with a photo, then given a slot from their card ----
    await page.click('[data-cm="tab"][data-k="speakers"]');
    await page.click('[data-cm="new-speaker"]');
    await until(() => page.locator('#cm-drawer.is-open').count());
    await page.fill('#cm-p-name', 'Dr. Meera Iyer');
    await page.fill('#cm-p-role', 'Head of AI');
    await page.fill('#cm-p-org', 'Example Bank');
    await page.fill('#cm-p-email', 'meera@example.test');
    await page.setInputFiles('#cm-p-file', PHOTO);
    check('a photo shows at once, cropped square', await until(async () => ((await page.locator('#cm-p-ava img').getAttribute('src')) || '').startsWith('data:image/jpeg')));
    await page.click('#cm-p-save');
    const card = page.locator('.cm-card', { hasText: 'Dr. Meera Iyer' });
    check('saved: their card is there with their photo', await until(async () => ((await card.locator('img.cm-ava').getAttribute('src').catch(() => '')) || '').startsWith('/api/uploads/speakers/'), 10000));
    check('the photo loads', await page.evaluate(async () => { const i = [...document.querySelectorAll('.cm-card img.cm-ava')].find(x => x.src.includes('/api/uploads/speakers/')); return !!i && (await fetch(i.src)).ok; }));
    // ---- a photo chosen for a speaker already on the list is saved at once (16 Nov) ----
    await card.locator('[data-cm="edit-speaker"]').first().click();
    await until(async () => (await page.locator('#cm-drawer.is-open').count()) && (await page.locator('#cm-p-name').inputValue()) === 'Dr. Meera Iyer');
    const prevUrl = await page.locator('#cm-p-ava img').getAttribute('src');
    check('the sheet says the photo is saved the moment it is chosen', (await page.locator('#cm-p-note').textContent()).includes('saved the moment you choose it'));
    await page.setInputFiles('#cm-p-file', PHOTO);
    check('choosing a photo saves it without pressing Save', await until(async () => (await page.locator('#cm-p-note').textContent()).startsWith('Photo saved'), 10000), await page.locator('#cm-p-err').textContent());
    check('their card shows the new photo straight away', await until(async () => { const s = (await card.locator('img.cm-ava').getAttribute('src').catch(() => '')) || ''; return s.startsWith('/api/uploads/speakers/') && s !== prevUrl; }, 5000));
    check('the circle itself opens the picker', await page.evaluate(() => { let opened = false; const f = document.getElementById('cm-p-file'); f.addEventListener('click', e => { opened = true; e.preventDefault(); }, { once: true }); document.getElementById('cm-p-ava').click(); return opened; }));
    await page.setInputFiles('#cm-p-file', path.join(__dirname, 'browser-conference.cjs'));
    check('a file that is not a picture is refused with a reason, not quietly', await until(async () => /not a picture|could not be opened/.test(await page.locator('#cm-p-err').textContent())), await page.locator('#cm-p-err').textContent());
    check('the photo they had stays on the sheet after a refused file', ((await page.locator('#cm-p-ava img').getAttribute('src')) || '').startsWith('/api/uploads/speakers/'));
    await page.locator('#cm-drawer .cm-x').click();
    await until(async () => !(await page.locator('#cm-drawer.is-open').count()));
    await page.click('[data-cm="spk-filter"][data-k="noslot"]');
    check('"No session yet" lists them', (await page.locator('.cm-card').count()) === 1 && (await page.locator('.cm-card').textContent()).includes('Meera'));
    await page.click('.cm-card [data-cm="slot-for"]');
    await until(() => page.locator('#cm-drawer.is-open').count());
    check('"Give them one" opens a session with them already on it', (await page.locator('.cm-person').textContent()).includes('Dr. Meera Iyer'));
    await page.fill('#cm-s-title', 'AI Risk in Retail Banking');
    await page.selectOption('#cm-s-room', 'Raman Theatre');
    await page.selectOption('#cm-s-day', '2026-11-21');
    await page.fill('#cm-s-start', '10:00');
    await page.click('.cm-dur[data-k="45"]');
    await page.click('#cm-s-save');
    check('saved on Day 2, 10:00 to 10:45 in Raman', await until(async () => (await dbq("SELECT start_time, end_time, room FROM sessions WHERE title = 'AI Risk in Retail Banking'"))[0]?.end_time === '2026-11-21 10:45'));

    // ---- announcing a speaker ----
    await page.click('[data-cm="tab"][data-k="speakers"]');
    await page.click('[data-cm="spk-filter"][data-k="all"]');
    const sh = page.locator('.cm-card', { hasText: 'Shailesh Dhuri' });
    await sh.locator('[data-cm="announce"]').click();
    check('Announce opens with the words written: name, day, time and the hall (event name only)', await until(async () => { const v = (await page.locator('#cm-a-content').inputValue().catch(() => '')) || ''; return v.includes('Homi J. Bhabha Hall') && !v.includes('Peacock Hall'); }));
    check('...and the headline names them', (await page.locator('#cm-a-title').inputValue()).includes('Shailesh Dhuri'));
    await page.check('#cm-a-pin');
    await page.click('#cm-a-post');
    check('posted: their card says Announced', await until(async () => (await sh.textContent()).includes('Announced')));
    const ann = await dbq("SELECT title, pinned FROM announcements ORDER BY id DESC LIMIT 1");
    check('...and it is in the app’s announcements, pinned', ann[0] && ann[0].title.includes('Shailesh Dhuri') && ann[0].pinned === 1, ann);

    // ---- their slot by email ----
    await sh.locator('[data-cm="slot-email"]').click();
    check('the email preview is the email: both hall names, the session', await until(async () => {
      const doc = await page.locator('#cm-m-preview').getAttribute('srcdoc');
      return doc && doc.includes('Homi J. Bhabha Hall · Peacock Hall') && doc.includes('AI Democratizing');
    }));
    await page.click('#cm-m-send');
    check('sent once, to the speaker', await until(async () => { const s = await (await fetch(BASE + '/__sent')).json(); return s.length === 1 && JSON.stringify(s[0]).includes('shailesh@example.test'); }));

    // ---- hide and show ----
    const tarun = page.locator('.cm-card', { hasText: 'Tarun Chugh' });
    await tarun.locator('[data-cm="toggle-pub"]').click();
    check('Hide keeps the card, marked Hidden', await until(async () => (await tarun.textContent()).includes('Hidden')));
    await tarun.locator('[data-cm="toggle-pub"]').click();
    check('Show brings them back', await until(async () => !(await tarun.textContent()).includes('Hidden')));

    // ---- halls ----
    await page.click('[data-cm="tab"][data-k="halls"]');
    const hallRows = await page.locator('.cm-table tbody tr').allTextContents();
    check('the halls table lists the four halls with the venue’s names', hallRows.length === 4 && hallRows.join('|').includes('Expo Hall') && hallRows.join('|').includes('Centrum Hall A'), hallRows);
    await page.locator('.cm-table tbody tr', { hasText: 'Kalam Theatre' }).click();
    await until(() => page.locator('#cm-drawer.is-open').count());
    await page.fill('#cm-h-loc', 'Hall 1, next to the food court');
    await page.click('[data-cm="save-hall"]');
    check('a hall’s directions are changed', await until(async () => (await page.locator('.cm-table tbody tr', { hasText: 'Kalam Theatre' }).textContent()).includes('next to the food court')));

    // ---- list, CSV, run sheet, Escape ----
    await page.click('[data-cm="tab"][data-k="programme"]');
    await page.click('[data-cm="view"][data-k="list"]');
    check('saving a Day 2 session left the programme on Day 2', (await page.locator('.cm-pill.is-on').textContent()).includes('Day 2'));
    await page.click('[data-cm="day-all"]');
    check('"Both days" lists every session', await until(async () => (await page.locator('.cm-table tbody tr').count()) === 6), await page.locator('.cm-table tbody tr').count());
    await page.locator('[data-cm-input="q"]').pressSequentially('Inclusion');
    check('the list finds a session by a word in its title, keeping the search box', await until(async () => (await page.locator('.cm-table tbody tr').count()) === 1) && (await page.locator('[data-cm-input="q"]').inputValue()) === 'Inclusion', await page.locator('.cm-table tbody tr').count());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-cm="csv-programme"]')]);
    const csv = require('fs').readFileSync(await dl.path(), 'utf8');
    check('the programme CSV has every session, with no venue room column', /^﻿?Day,Starts,Ends,Hall,Session/.test(csv) && !csv.includes('Peacock Hall') && csv.split('\r\n').length === 7, csv.slice(0, 200));
    await page.click('[data-cm="view"][data-k="board"]');
    await page.click('[data-cm="day"][data-k="2026-11-20"]');
    const [sheet] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-cm="runsheet"]')]);
    await sheet.waitForLoadState('domcontentloaded');
    const sheetText = await sheet.locator('body').textContent();
    check('the run sheet has each hall of the day with the venue’s name and who is on stage', sheetText.includes('Run sheet') && sheetText.includes('Peacock Hall') && sheetText.includes('Shailesh Dhuri'), sheetText.slice(0, 300));
    await sheet.close();
    await page.locator('.cm-block').first().click();
    await until(() => page.locator('#cm-drawer.is-open').count());
    await page.keyboard.press('Escape');
    check('Escape closes the drawer', await until(async () => (await page.locator('#cm-drawer.is-open').count()) === 0));

    // ---- people given a Speaker pass in Attendees who are not on the speakers list (16 Nov) ----
    const made = await page.evaluate(async () => {
      const a = await api.post('/api/admin/attendees', { event_id: 1, name: 'Arindam Ghosh', email: 'arindam@example.test', company: 'Star Union Dai-ichi Life Insurance', job_title: 'Chief Distribution Officer', badge_type: 'Speaker', payment_status: 'waived' });
      const b = await api.post('/api/admin/attendees', { event_id: 1, name: 'Rohini Ramnathan', email: 'rohini@example.test', company: 'Fever FM', job_title: 'CCO', badge_type: 'Speaker', payment_status: 'waived' });
      return [a, b];
    });
    check('two people are given a Speaker pass in Attendees', made.every(x => x && !x.error), made);
    await page.evaluate(() => ConfDesk.load());
    await until(() => page.locator('.cm-stats').isVisible(), 10000);
    await page.click('[data-cm="tab"][data-k="speakers"]');
    check('the Speakers tab says they hold a Speaker pass but are not on the list', await until(async () => (await page.locator('.cm-banner.is-warn', { hasText: '2 people hold a Speaker pass' }).count()) === 1, 10000));
    await page.fill('[data-cm-input="spkq"]', 'Arind');
    check('searching the name finds them, with a button to add them', await until(async () => (await page.locator('.cm-card.is-holder', { hasText: 'Arindam Ghosh' }).count()) === 1));
    await page.locator('.cm-card.is-holder [data-cm="from-attendee"]').click();
    check('one click puts them on the speakers list with their title and their pass', await until(async () => { const c = page.locator('.cm-card:not(.is-holder)', { hasText: 'Arindam Ghosh' }); if ((await c.count()) !== 1) return false; const t = await c.textContent(); return t.includes('Chief Distribution Officer') && t.includes('Speaker'); }, 10000));
    await page.fill('[data-cm-input="spkq"]', '');
    check('the note now counts one', await until(async () => (await page.locator('.cm-banner.is-warn', { hasText: '1 person holds a Speaker pass' }).count()) === 1));
    await page.click('[data-cm="new-session"]');
    await until(() => page.locator('#cm-drawer.is-open').count());
    await page.fill('#cm-s-pick', 'Rohini');
    check('typing a pass holder’s name in a session offers to add them', await until(async () => (await page.locator('.cm-pick-item.is-holder', { hasText: 'Rohini Ramnathan' }).count()) === 1));
    await page.locator('.cm-pick-item.is-holder').click();
    check('they are on the speakers list and in the session', await until(async () => (await page.locator('.cm-person', { hasText: 'Rohini Ramnathan' }).count()) === 1, 10000));
    await page.keyboard.press('Escape');
    await until(async () => (await page.locator('#cm-drawer.is-open').count()) === 0);

    // ---- the same person under another spelling (17 Nov) ----
    await page.evaluate(() => api.post('/api/admin/attendees', { event_id: 1, name: 'Kushan Shah', email: 'kushan@example.test', company: 'Fynd', job_title: 'CTPO', badge_type: 'Speaker', payment_status: 'waived' }));
    await page.evaluate(() => ConfDesk.load());
    await until(() => page.locator('.cm-stats').isVisible(), 10000);
    await page.click('[data-cm="new-session"]');
    await until(() => page.locator('#cm-drawer.is-open').count());
    await page.fill('#cm-s-pick', 'Khushan Shah');
    check('a misspelt name offers "Did you mean" the pass holder', await until(async () => (await page.locator('.cm-pick-item.is-holder', { hasText: 'Kushan Shah' }).count()) === 1), await page.locator('#cm-s-pick-list').textContent());
    await page.click('[data-cm="pick-new"]');
    await until(() => page.locator('#cm-n-name').count());
    await page.fill('#cm-n-org', 'Fynd');
    await page.click('#cm-n-save');
    check('typing them as a new speaker is stopped, with their record offered', await until(async () => (await page.locator('#cm-n-err [data-cm="use-holder"]').count()) === 1), await page.locator('#cm-n-err').textContent());
    await page.locator('#cm-n-err [data-cm="use-holder"]').click();
    check('one click uses their record: on the list and in the session, spelt as registered', await until(async () => (await page.locator('.cm-person', { hasText: 'Kushan Shah' }).count()) === 1, 10000));
    await page.keyboard.press('Escape');
    await until(async () => (await page.locator('#cm-drawer.is-open').count()) === 0);
    check('laptop: no page errors', errors.length === 0, errors);
    await ctx.close();

    // ================= Admin on a phone =================
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await pctx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await pctx.addInitScript(adminInit);
    const pp = await pctx.newPage();
    const perr = []; pp.on('pageerror', e => perr.push(String(e)));
    await pp.goto(BASE + '/admin#sessions', { waitUntil: 'domcontentloaded' });
    check('phone: Admin -> Conference opens', await until(() => pp.locator('.cm-stats').isVisible(), 20000));
    await sleep(400);
    const w = await pp.evaluate(() => document.documentElement.scrollWidth);
    check('phone: the board scrolls inside its box; the page is no wider than the screen', w <= 391, 'scrollWidth ' + w);
    await pp.locator('.cm-block').first().click();
    await until(() => pp.locator('#cm-drawer.is-open').count());
    const dw = await pp.locator('#cm-drawer').evaluate(e => e.getBoundingClientRect().width);
    check('phone: the editor fills the screen', dw >= 388 && dw <= 391, dw);
    check('phone: no page errors', perr.length === 0, perr);
    await pctx.close();

    // ================= the app, on a phone =================
    const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await actx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await actx.addCookies([{ name: 'bai_session', value: appCookie(1), url: BASE }]);
    await actx.addInitScript(() => { try { localStorage.setItem('agba_user', JSON.stringify({ id: 1, event_id: 1, name: 'Shailesh Dhuri', email: 'shailesh@example.test', badge_type: 'Speaker', payment_status: 'waived' })); } catch (e) {} });
    const ap = await actx.newPage();
    const aerr = []; ap.on('pageerror', e => aerr.push(String(e)));
    await ap.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    check('app: its page code loads', await until(() => ap.evaluate(() => typeof speakerSlotsHtml === 'function' && typeof hallLabel === 'function'), 20000));
    check('app: a hall reads by its event name only', await ap.evaluate(() => hallLabel('Raman Theatre') === 'Raman Theatre' && hallLabel('Aryabhata Theatre', 'Expo Hall') === 'Aryabhata Theatre' && hallLabel('Kalam Theatre') === 'Kalam Theatre'));
    const slot = await ap.evaluate(() => {
      window.__ran = 0;
      const d = document.createElement('div');
      d.innerHTML = speakerSlotsHtml({ sessions: [{ id: 77, title: '<img src=x onerror="window.__ran=1">Lending', room: 'Aryabhata Theatre', venue_room: 'Expo Hall', location: 'On the exhibition floor', start_time: '2026-11-20 16:00', end_time: '2026-11-20 16:30', role: 'moderator' }] });
      document.body.appendChild(d);
      return { text: d.textContent, imgs: d.querySelectorAll('img').length };
    });
    await sleep(200);
    check('app: a speaker’s profile says their part, the day, the time and the hall', slot.text.includes('Moderator') && slot.text.includes('Fri 20 Nov, 4:00 pm to 4:30 pm') && slot.text.includes('Aryabhata Theatre') && !slot.text.includes('Expo Hall') && slot.text.includes('On the exhibition floor'), slot.text);
    check('app: a title typed in Admin is shown as text, never run', slot.imgs === 0 && slot.text.includes('<img') && (await ap.evaluate(() => window.__ran)) === 0);
    const cardHtml = await ap.evaluate(() => {
      const d = document.createElement('div');
      d.innerHTML = renderScheduleSessionCard({ id: 78, title: '<img src=x onerror="window.__ran=2">Panel', session_type: 'panel', speaker_name: '<b>Asha</b> (Org), Ravi (Moderator), Third (X)', room: 'Raman Theatre', venue_room: 'Centrum Hall B', start_time: '2026-11-20 10:00', end_time: '2026-11-20 10:30', description: '<script>window.__ran=3</script>' });
      document.body.appendChild(d);
      return { imgs: d.querySelectorAll('img[src="x"]').length, bold: d.querySelectorAll('b').length, text: d.textContent };
    });
    await sleep(200);
    check('app: a schedule card shows Admin’s words as text, never as page code', cardHtml.imgs === 0 && cardHtml.bold === 0 && (await ap.evaluate(() => window.__ran)) === 0 && cardHtml.text.includes('<b>Asha</b>'), cardHtml);
    await ap.evaluate(() => switchTab('schedule'));
    check('app: the Conference Schedule’s hall tabs carry the event names only', await until(async () => { const t = (await ap.locator('#sched-hall-tabs').textContent()) || ''; return t.includes('Homi J. Bhabha Hall') && !t.includes('Peacock Hall') && !t.includes('Expo Hall'); }, 10000));
    check('app: the published sessions are listed, the draft is not', await until(async () => { const t = (await ap.locator('#sched-sessions-list').textContent()) || ''; return t.includes('AI Democratizing') && !t.includes('Agentic AI in Lending'); }, 10000));
    await ap.evaluate(() => { selectedHall = ''; loadSchedule(); });
    check('app: with All halls, each card names its hall by event name only', await until(async () => { const t = (await ap.locator('#sched-sessions-list').textContent()) || ''; return t.includes('Homi J. Bhabha Hall') && !t.includes('Peacock Hall'); }, 10000));
    const aw = await ap.evaluate(() => document.documentElement.scrollWidth);
    check('app: the schedule is no wider than the phone', aw <= 391, 'scrollWidth ' + aw);
    check('app: no page errors', aerr.length === 0, aerr);
    await actx.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
