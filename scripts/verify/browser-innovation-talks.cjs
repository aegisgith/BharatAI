// The Innovation Talks tab (12 Nov 2026) in a real browser (Edge), on the real built
// worker and real SQLite (talks-harness.mjs). First a laptop, as the organisers: the
// talks by day with their hall under both names, what is missing, the filters, the
// edit form (which used to be replaced by the word "undefined"), giving a talk a time,
// the missing-details email previewed and sent, Announce filling the Announcements
// form. Then a phone, as a delegate: the app's Innovation Talks tab by day, both hall
// names, no old made-up session times, nothing wider than the screen, no page errors.
// Needs talks-harness.mjs (HARNESS_PORT, default 8863). Started by run-all.mjs.
const crypto = require('crypto');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8863);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (ok) passes++; else fails++; };
const until = async (fn, ms = 10000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(200); } return false; };
const dbq = async (q) => (await fetch(BASE + '/__db?q=' + encodeURIComponent(q))).json();
const sentMail = async () => (await fetch(BASE + '/__sent')).json();
const appCookie = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const b = id + '.' + exp; return b + '.' + crypto.createHmac('sha256', 'talks-session').update(b).digest('hex'); };

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1/innovation-talks')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const p99 = (await dbq("SELECT id FROM innovation_talks WHERE speaker_name = 'Vineet Upadhayay'"))[0].id;
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ================= the organisers, on a laptop =================
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // try: this also runs in the email preview, a sandboxed frame with no storage.
    await ctx.addInitScript(() => { try { sessionStorage.setItem('tc_admin_token', 'talks-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); } catch (e) {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await until(() => page.locator('[data-section="innovation"]').first().isVisible(), 20000);
    await page.locator('[data-section="innovation"]').first().click();
    const sec = page.locator('#section-innovation');
    const drawn = await until(async () => /Fri 20 Nov · Day 1/.test(await sec.innerText()), 20000);
    check('the tab draws the talks under their day', drawn, (await sec.innerText()).slice(0, 300));
    let text = await sec.innerText();
    check('the counts: 49 talks, 21 with a time, 28 still need a time', /49 talks/.test(text) && /21 with a time/.test(text) && /28 still need a time/.test(text), text.slice(0, 300));
    check('a "No time yet" section lists the rest', /No time yet/.test(text));
    check('no old made-up session times on the page', !/10:00 – 11:30 AM|2:00 – 4:10 PM/.test(text));
    const amrRow = page.locator('tr', { hasText: 'Amritesh Kumar' });
    const amrText = await amrRow.innerText();
    check('a row shows its time and its hall under both names', /1:10 – 1:18 PM/.test(amrText) && /Aryabhata Theatre/.test(amrText) && /Expo Hall/.test(amrText), amrText);
    check('CGI shows Kalam Theatre with Centrum Hall A', /Kalam Theatre[\s\S]*Centrum Hall A/.test(await page.locator('tr', { hasText: 'Dr Rahul Ghodke' }).innerText()));
    check('a row says what is still missing', /Bio/.test(amrText) && /Mobile/.test(amrText), amrText);
    // The day apart from the time, the day in its own colour (the team, 12 Nov 2026).
    const amrCells = await amrRow.locator('td').allInnerTexts();
    check('the day has its own column, coloured, apart from the time', (await amrRow.locator('td').nth(0).locator('span.rounded-lg').getAttribute('class')).includes('amber') && /Day 1/.test(amrCells[0]) && /Fri 20 Nov/.test(amrCells[0]) && /^1:10 – 1:18 PM$/.test(amrCells[1].trim()), amrCells.slice(0, 2));
    const heads = (await sec.locator('table').first().locator('thead th').allInnerTexts()).map(x => x.trim().toUpperCase());
    check('the headings read Day, then Time', heads[0] === 'DAY' && heads[1] === 'TIME', heads);
    // The missing-details email by itself: the switch.
    check('the automatic email is shown, off, with who would get one', await until(() => page.locator('#italk-auto').isVisible()) && /automatically: Off/.test(await page.locator('#italk-auto').innerText()) && /would get one/.test(await page.locator('#italk-auto').innerText()), await page.locator('#italk-auto').innerText().catch(() => ''));
    await page.locator('#italk-auto-btn').click();
    check('turned on (after the question): it says On, and the server has it', await until(async () => /automatically: On/.test(await page.locator('#italk-auto').innerText())) && (await dbq("SELECT value FROM app_settings WHERE key = 'italk_auto_request'"))[0].value === '1');
    await page.locator('#italk-auto-btn').click();
    check('turned off again', await until(async () => /automatically: Off/.test(await page.locator('#italk-auto').innerText())) && (await dbq("SELECT value FROM app_settings WHERE key = 'italk_auto_request'"))[0].value === '0');

    // the filters
    await page.getByRole('button', { name: /^No time yet/ }).click();
    await sleep(300);
    text = await sec.innerText();
    check('"No time yet" shows only talks without a time', !/Amritesh Kumar/.test(text) && /Vineet Upadhayay/.test(text));
    await page.getByRole('button', { name: /^All/ }).click();
    await sleep(300);

    // the edit form: a real form, not the word "undefined"
    await page.locator('#italk-row-' + p99 + ' button[aria-label="Edit"]').click();
    const formUp = await until(() => page.locator('#italk-form').isVisible(), 5000);
    const modalText = await page.locator('#modal-box').innerText();
    check('the edit pencil opens the form (it used to show "undefined")', formUp && !/undefined/.test(modalText), modalText.slice(0, 200));
    check('the form is filled from the talk', (await page.locator('#italk-form [name=speaker_name]').inputValue()) === 'Vineet Upadhayay' && (await page.locator('#italk-form [name=hall]').inputValue()) === 'Aryabhata Theatre');
    await page.locator('#italk-form [name=day]').selectOption('2026-11-21');
    await page.locator('#italk-form [name=start]').fill('12:00');
    await page.locator('#italk-form [name=end]').fill('12:08');
    await page.locator('#italk-form [name=speaker_phone]').fill('+91 98200 44444');
    await page.locator('#italk-form button[type=submit]').click();
    const moved = await until(async () => /Sat 21 Nov · Day 2/.test(await sec.innerText()), 8000);
    const saved = (await dbq('SELECT time_slot, hall, speaker_phone FROM innovation_talks WHERE id = ' + p99))[0];
    check('saving gives it Day 2 at 12:00 – 12:08 PM, and a Day 2 section appears', moved && saved.time_slot === 'Sat 21 Nov · 12:00 – 12:08 PM' && saved.speaker_phone === '+91 98200 44444', saved);

    // the missing-details email
    await page.locator('#italk-row-' + p99 + ' button[aria-label="Ask for details"]').click();
    await until(() => page.locator('#italk-ask-form').isVisible(), 5000);
    check('the email box offers the booth contact, and says so', (await page.locator('#italk-ask-form [name=to]').inputValue()) === 'spoc@p99soft.test' && /booth contact for P99SOFT/.test(await page.locator('#italk-ask-form').innerText()));
    check("a booth contact's box is not ticked as the speaker's own", !(await page.locator('#italk-ask-form [name=own]').isChecked()));
    const ticked = await page.locator('#italk-ask-form input[name=ask]:checked').evaluateAll(xs => xs.map(x => x.value));
    check('"Company name" is one of the things the email can ask for', (await page.locator('#italk-ask-form input[name=ask][value=company]').count()) === 1);
    check('only what is missing is ticked (bio; the mobile was just added)', JSON.stringify(ticked) === '["speaker_bio"]', ticked);
    await page.locator('#italk-ask-form textarea[name=note]').fill('Please send your slides by 18 Nov.');
    await page.getByRole('button', { name: 'Preview' }).click();
    const previewed = await until(async () => /Sat 21 Nov/.test(await page.frameLocator('#italk-ask-frame').locator('body').innerText()), 6000);
    const pv = previewed ? await page.frameLocator('#italk-ask-frame').locator('body').innerText() : '';
    check('Preview shows the email: the time, both hall names, the ask and the note', previewed && /Aryabhata Theatre \(Expo Hall/.test(pv) && /Two or three lines about you/.test(pv) && /slides by 18 Nov/.test(pv), pv.slice(0, 300));
    check('Preview sends nothing', (await sentMail()).length === 0);
    await page.locator('#italk-ask-send').click();
    const went = await until(async () => (await sentMail()).length === 1, 6000);
    const mail = (await sentMail())[0];
    check('Send: one email to the booth contact', went && mail.Recipients.To[0] === 'spoc@p99soft.test', mail && mail.Recipients);
    const asked = await until(async () => /Asked/.test(await page.locator('#italk-row-' + p99).innerText()), 6000);
    check('the row now says when it was asked', asked);

    // Announce
    await page.locator('#italk-row-' + p99 + ' button[aria-label="Announce"]').click();
    await until(() => page.locator('#af-content').isVisible(), 5000);
    const annText = await page.locator('#af-content').inputValue();
    check('Announce opens the Announcements form with the talk, the time and both hall names', /Vineet Upadhayay/.test(annText) && /Sat 21 Nov · 12:00 – 12:08 PM/.test(annText) && /Aryabhata Theatre \(Expo Hall\)/.test(annText), annText);
    await page.locator('#af-form button[type=submit]').click();
    const posted = await until(async () => (await dbq("SELECT COUNT(*) AS n FROM announcements WHERE content LIKE '%Expo Hall%'"))[0].n === 1, 6000);
    check('Create saves it as an announcement', posted);
    check('no script error on the admin page', errors.length === 0, errors);
    await ctx.close();

    // ================= a delegate, on a phone =================
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    await pctx.addCookies([{ name: 'bai_session', value: appCookie(500), url: BASE }]);
    const ph = await pctx.newPage();
    const perr = [];
    ph.on('pageerror', e => perr.push(e.message));
    await ph.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await until(() => ph.evaluate(() => typeof switchTab === 'function'), 20000);
    // The way a delegate gets there: the home screen's Innovation Talks card.
    const card = ph.locator('[onclick="switchTab(\'innovation\')"]').first();
    if (await card.isVisible().catch(() => false)) await card.tap(); else await ph.evaluate(() => switchTab('innovation'));
    const box = ph.locator('#innovation-talks-content');
    const shown = await until(async () => /Friday 20 November/.test(await box.innerText()), 15000);
    const app = shown ? await box.innerText() : '';
    check('phone: the talks are listed under "Friday 20 November" and "Saturday 21 November"', shown && /Saturday 21 November/.test(app), app.slice(0, 300));
    check('phone: each card names both halls (Aryabhata Theatre · Expo Hall)', /Aryabhata Theatre · Expo Hall/.test(app) && /Kalam Theatre · Centrum Hall A/.test(app));
    check('phone: under a day the card shows the time alone', /1:10 – 1:18 PM/.test(app) && !/Fri 20 Nov · 1:10/.test(app));
    check('phone: talks with no time are under "Speakers announced", times to follow', /Speakers announced/.test(app) && /Times to follow/.test(app));
    check('phone: no old made-up session times', !/10:00 – 11:30 AM|2:00 – 4:10 PM|Morning Session|Afternoon Session/.test(app));
    check("phone: no speaker's mobile anywhere", !/98200 44444/.test(app));
    const w = await ph.evaluate(() => document.documentElement.scrollWidth);
    check('phone: nothing wider than the screen', w <= 391, 'scrollWidth ' + w);
    check('phone: no script error', perr.length === 0, perr);
    await ph.screenshot({ path: require('path').join(require('os').tmpdir(), 'innovation-talks-phone.png') });
    await pctx.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
