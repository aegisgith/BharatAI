// The scheduler in Admin -> Conference (12 Nov 2026) in a real browser (Edge), on the
// real built worker and real SQLite (conference-harness.mjs, 0054 applied). On a
// laptop, as the organisers: the numbers at the top; "Needs attention" and a free slot
// shown on the board; a free slot clicked into a filled-in form; "Find a free slot"; a
// new speaker with email and mobile added from inside a session, their Speaker pass
// issued; names typed in the one box turned into speakers; a session dragged to a new
// time and put back with Undo; the zoom; the list with the day apart from the time; a
// pass issued from a speaker's card; Delhi started and its programme copied from
// Mumbai as drafts, then back to Mumbai. On a phone: the attention list fits. No page
// errors. Needs conference-harness.mjs (HARNESS_PORT, default 8871). Run by run-all.mjs.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pw = require('./playwright.cjs');
// The spreadsheet library the admin page ships, to read the downloaded workbook back.
const xbox = vm.createContext({ console, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, DataView, TextDecoder, TextEncoder, Buffer });
xbox.window = xbox; xbox.self = xbox; xbox.globalThis = xbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'vendor', 'xlsx.full.min.js'), 'utf8'), xbox);
const XLSX = xbox.XLSX;
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8871);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (ok) passes++; else fails++; };
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(150); } return false; };
const dbq = async (q) => (await fetch(BASE + '/__db?q=' + encodeURIComponent(q))).json();
const adminInit = () => { if (window.top !== window) return; sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); };
const BH = 'Homi J. Bhabha Hall';

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1/sessions')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await ctx.addInitScript(adminInit);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => { if (!/sandboxed/.test(String(e))) errors.push(String(e)); });
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/admin#sessions', { waitUntil: 'domcontentloaded' });
    check('Conference opens with its numbers', await until(() => page.locator('[data-cm="stat-attention"]').isVisible(), 20000));
    const tiles = await page.locator('.cm-stats').innerText();
    check('the top says what needs a look, the free time and who is still to place', /need a look/.test(tiles) && /free in the halls/.test(tiles) && /everyone has a session/.test(tiles), tiles);

    // ---- Needs attention ----
    await page.locator('[data-cm="tab"][data-k="attention"]').click();
    check('"Needs attention" lists the notes, worst first', await until(async () => (await page.locator('.cm-att tbody tr').count()) > 3));
    const kinds = await page.locator('.cm-att tbody tr').evaluateAll(rs => rs.map(r => r.getAttribute('data-kind')));
    check('it has the speakers missing a photo, the keynote with no topic and the free time', kinds.includes('speaker-missing') && kinds.includes('no-topic') && kinds.includes('free'), kinds);
    await page.locator('.cm-pill[data-cm="att"][data-k="free"]').click();
    check('"Free time" shows only free time', await until(async () => (await page.locator('.cm-att tbody tr').evaluateAll(rs => rs.every(r => ['free', 'empty-hall', 'empty-day'].includes(r.getAttribute('data-kind'))))) && (await page.locator('.cm-att tbody tr').count()) > 0));
    const freeRow = page.locator('.cm-att tbody tr[data-kind="free"]', { hasText: 'Homi J. Bhabha Hall' }).first();
    check('Bhabha Hall is free for 2 h, 11:00 am to 1:00 pm', /free for 2 h/.test(await freeRow.innerText()) && /11:00 am to 1:00 pm/.test(await freeRow.innerText()), await freeRow.innerText());
    await freeRow.locator('[data-cm="show-on-board"]').click();
    const gap = page.locator(`.cm-free[data-hall="${BH}"][data-start="11:00"]`);
    check('"Show on the board" opens the day with that free slot lit up', await until(async () => (await gap.count()) === 1 && /is-flash/.test(await gap.getAttribute('class'))), await gap.count());
    check('the hall heading sums up its day', /2 h free/.test(await page.locator('.cm-head', { hasText: 'Bhabha' }).innerText()));
    // A free slot clicked: the form, filled in.
    await gap.click();
    await until(() => page.locator('#cm-s-title').isVisible());
    check('clicking free time opens "Add a session" in that hall at that time', (await page.locator('#cm-s-room').inputValue()) === BH && (await page.locator('#cm-s-start').inputValue()) === '11:00' && (await page.locator('#cm-s-end').inputValue()) === '11:30');
    await page.locator('#cm-s-title').fill('AI in Healthcare');
    await page.locator('#cm-s-type').selectOption('panel');
    // Find a free slot
    await page.locator('[data-cm="find-slot"]').click();
    check('"Find a free slot" offers times, this hall first', await until(async () => (await page.locator('#cm-s-slot-list .cm-slotpick').count()) > 2) && /Homi J\. Bhabha Hall/.test(await page.locator('#cm-s-slot-list .cm-slotpick').first().innerText()));
    await page.locator('#cm-s-slot-list .cm-slotpick', { hasText: 'Kalam' }).first().click();
    check('picking one sets the hall and the times', (await page.locator('#cm-s-room').inputValue()) === 'Kalam Theatre' && /^\d\d:\d\d$/.test(await page.locator('#cm-s-start').inputValue()));
    await page.locator('#cm-s-room').selectOption(BH); await page.locator('#cm-s-start').fill('11:00'); await page.locator('#cm-s-end').fill('12:00');
    // A new speaker with their details, from inside the session.
    await page.locator('[data-cm="new-in-session"]').click();
    await until(() => page.locator('#cm-n-name').isVisible());
    check('"New speaker" asks for name, designation, organisation, email and mobile, and offers the pass', await page.locator('#cm-n-role').isVisible() && await page.locator('#cm-n-org').isVisible() && await page.locator('#cm-n-email').isVisible() && await page.locator('#cm-n-phone').isVisible() && await page.locator('#cm-n-pass').isChecked());
    await page.locator('#cm-n-name').fill('Dr. Priya Menon');
    await page.locator('#cm-n-role').fill('Chief Medical Officer');
    await page.locator('#cm-n-org').fill('Apollo Hospitals');
    await page.locator('#cm-n-email').fill('priya@apollo.test');
    await page.locator('#cm-n-phone').fill('98200 77777');
    await page.locator('[data-cm="save-new-speaker"]').click();
    check('she joins the session', await until(async () => /Dr\. Priya Menon/.test(await page.locator('#cm-s-people').innerText())));
    let sp = await dbq("SELECT * FROM speakers WHERE email = 'priya@apollo.test'");
    check('she is in the database with designation, organisation, email and mobile', sp.length === 1 && sp[0].role === 'Chief Medical Officer' && sp[0].organisation === 'Apollo Hospitals' && /98200 ?77777/.test(sp[0].phone), sp[0]);
    let att = await dbq("SELECT * FROM attendees WHERE email = 'priya@apollo.test'");
    check('and her Speaker pass is issued', att.length === 1 && att[0].badge_type === 'Speaker' && att[0].payment_status === 'waived' && att[0].company === 'Apollo Hospitals', att[0]);
    // Everyone else at once, in the one box.
    await page.locator('#cm-s-others').fill('Rahul Verma (Fortis), Neha Gupta (Moderator)');
    await page.locator('[data-cm="others-to-speakers"]').click();
    check('"Turn these names into speakers" adds both to the session', await until(async () => (await page.locator('#cm-s-people .cm-person').count()) === 3));
    check('...and empties the box', (await page.locator('#cm-s-others').inputValue()) === '');
    const roles = await page.locator('#cm-s-people select').evaluateAll(s => s.map(x => x.value));
    check('"(Moderator)" becomes her part', roles.includes('moderator'), roles);
    const rv = await dbq("SELECT * FROM speakers WHERE name IN ('Rahul Verma', 'Neha Gupta') ORDER BY name");
    check('both are on the speakers list, Rahul with his organisation', rv.length === 2 && rv.find(r => r.name === 'Rahul Verma').organisation === 'Fortis', rv.map(r => [r.name, r.organisation]));
    await page.locator('#cm-s-save').click();
    check('saved: the drawer closes and the panel is on the board', await until(async () => !(await page.locator('#cm-drawer.is-open').count()) && (await page.locator('.cm-block', { hasText: 'AI in Healthcare' }).count()) === 1, 10000));
    const saved = (await dbq("SELECT * FROM sessions WHERE title = 'AI in Healthcare'"))[0];
    check('the app line names all three, the moderator marked', /Dr\. Priya Menon \(Apollo Hospitals\)/.test(saved.speaker_name) && /Rahul Verma \(Fortis\)/.test(saved.speaker_name) && /Neha Gupta \(Moderator\)/.test(saved.speaker_name), saved.speaker_name);

    // ---- drag, Undo, zoom ----
    await page.locator('[data-cm="tab"][data-k="programme"]').click();
    const block = page.locator('.cm-block', { hasText: 'AI in Healthcare' });
    // The board is drawn again when its data arrives: wait for it to settle, then scroll.
    const settle = async (loc) => { await sleep(700); await until(async () => { await loc.scrollIntoViewIfNeeded({ timeout: 1500 }); return true; }, 10000); await sleep(150); };
    await until(() => block.isVisible());
    await settle(block);
    const b = await block.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 12);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 30, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + 12 + 66, { steps: 6 });
    check('while dragging, the new time shows on the block', /11:30 AM to 12:30 PM|11:30 am to 12:30 pm/i.test(await page.locator('.cm-drag-tip').innerText().catch(() => '')), await page.locator('.cm-drag-tip').innerText().catch(() => 'no tip'));
    await page.mouse.up();
    const moved = await until(async () => (await dbq("SELECT start_time FROM sessions WHERE title = 'AI in Healthcare'"))[0].start_time === '2026-11-20 11:30', 8000);
    check('dropped half an hour lower: saved at 11:30', moved, (await dbq("SELECT start_time, end_time FROM sessions WHERE title = 'AI in Healthcare'"))[0]);
    check('the drop did not open the session form', !(await page.locator('#cm-drawer.is-open').count()));
    check('"Moved ... Undo" appears', await until(() => page.locator('#cm-undo').isVisible()) && /Moved "AI in Healthcare" to 11:30 am to 12:30 pm/.test(await page.locator('#cm-undo').innerText()));
    await page.locator('#cm-undo [data-cm="undo"]').click();
    check('Undo puts it back at 11:00', await until(async () => (await dbq("SELECT start_time FROM sessions WHERE title = 'AI in Healthcare'"))[0].start_time === '2026-11-20 11:00'));
    const blk = () => page.locator('.cm-block', { hasText: 'AI in Healthcare' });
    await until(() => blk().isVisible());
    await settle(blk());
    const h1 = (await blk().boundingBox()).height;
    await page.locator('[data-cm="zoom"][data-k="2"]').click();
    await until(() => blk().isVisible());
    await settle(blk());
    const h2 = (await blk().boundingBox()).height;
    check('"Detail" zoom makes the hour taller', h2 > h1 * 1.3, [h1, h2]);
    await page.locator('[data-cm="zoom"][data-k="1"]').click();
    // ---- To place ----
    await page.locator('[data-cm="tray"]').click();
    check('"To place" says everyone shown to attendees has a session', await until(async () => /Everyone shown to attendees has a session/.test(await page.locator('#cm-tray').innerText())), await page.locator('#cm-tray').innerText().catch(() => ''));
    await page.locator('[data-cm="tray"]').click();

    // ---- the list: day apart from time ----
    await page.locator('[data-cm="view"][data-k="list"]').click();
    await until(() => page.locator('.cm-table thead').isVisible());
    const heads = await page.locator('.cm-table thead th').allInnerTexts();
    check('the list has Day and Time as two columns', heads[0].toUpperCase() === 'DAY' && heads[1].toUpperCase() === 'TIME', heads);
    const firstRow = page.locator('.cm-table tbody tr').first();
    check('the day is a coloured label of its own; the time stands alone', (await firstRow.locator('td').nth(0).locator('.cm-daychip.cm-day-1').count()) === 1 && /day 1/i.test(await firstRow.locator('td').nth(0).innerText()) && /Fri 20 Nov/.test(await firstRow.locator('td').nth(0).innerText()) && /^\d{1,2}:\d\d (am|pm)/.test((await firstRow.locator('td').nth(1).innerText()).trim()), await firstRow.innerText());
    await page.locator('[data-cm="view"][data-k="board"]').click();

    // ---- downloads: Excel, PDF with photos, PDF without ----
    // One speaker gets a photo (a file the site already serves), to see it on the page.
    await dbq("UPDATE speakers SET photo_url = '/images/talks/aditi-saini.webp' WHERE email = 'priya@apollo.test'");
    await page.locator('[data-cm="reload"]').count();
    await page.evaluate(() => ConfDesk.load());
    await sleep(900);
    await page.locator('#cm-dl summary').click();
    const items = await page.locator('#cm-dl .cm-menu-list button b').allInnerTexts();
    check('Download offers PDF with photos, PDF without, and an Excel sheet', items.join('|') === 'PDF with speaker photos|PDF without photos|Excel sheet', items);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-cm="dl-xlsx"]').click()]);
    check('the Excel file is named after the event', dl.suggestedFilename() === 'Bharat-AI-Innovation-2026-programme.xlsx', dl.suggestedFilename());
    const xl = fs.readFileSync(await dl.path());
    const wb = XLSX.read(xl, { type: 'buffer' });
    const prog = XLSX.utils.sheet_to_json(wb.Sheets.Programme, { header: 1, defval: '' });
    const hc = prog.find(r => r[7] === 'AI in Healthcare');
    check('it opens as a workbook with Programme and Speakers sheets', wb.SheetNames.join() === 'Programme,Speakers' && prog[0][0] === 'Bharat AI Innovation 2026: programme', wb.SheetNames);
    check('the new panel is in it: time, both hall names, the three speakers, the moderator marked', hc && hc[2] === '11:00 am' && hc[4] === BH && hc[5] === 'Peacock Hall' && /Dr\. Priya Menon/.test(hc[8]) && /Neha Gupta \(Moderator\)/.test(hc[8]) && /Chief Medical Officer, Apollo Hospitals/.test(hc[9]), hc);
    check('no email or mobile is in the workbook', !/priya@apollo|98200 ?77777|kk@example/.test(xl.toString('latin1')));
    check('the menu closes after a choice', !(await page.locator('#cm-dl[open]').count()));
    await page.locator('#cm-dl summary').click();
    const [pop] = await Promise.all([page.waitForEvent('popup'), page.locator('[data-cm="dl-pdf-photos"]').click()]);
    check('"PDF with speaker photos" opens the programme in a new tab', await until(async () => (await pop.locator('h1').innerText()) === 'Bharat AI Innovation 2026', 15000), await pop.title().catch(() => ''));
    const popText = await pop.locator('.sheet').innerText();
    check('it has the day, both hall names, the times and the speakers with their lines', /DAY 1/i.test(popText) && /Friday 20 November 2026/.test(popText) && /Homi J\. Bhabha Hall\s+Peacock Hall/.test(popText) && /11:00 am/.test(popText) && /Dr\. Priya Menon/.test(popText) && /Chief Medical Officer, Apollo Hospitals/.test(popText) && /MODERATOR/i.test(popText), popText.slice(0, 400));
    const pics = await pop.locator('img.ph').evaluateAll(xs => xs.map(x => ({ small: x.src.indexOf('data:image/jpeg') === 0, ok: x.complete && x.naturalWidth > 0, w: x.naturalWidth })));
    check('her photo is beside her name, made small for the file', pics.length === 1 && pics[0].small && pics[0].ok && pics[0].w === 120, pics);
    check('speakers without a photo get their own initial in a circle', (await pop.locator('.ph.is-none').count()) >= 3);
    const pdf1 = await pop.pdf({ format: 'A4', printBackground: true });
    check('the browser turns it into a real PDF, small enough to share', pdf1.slice(0, 5).toString() === '%PDF-' && pdf1.length < 600 * 1024, Math.round(pdf1.length / 1024) + ' KB');
    await pop.close();
    await page.locator('#cm-dl summary').click();
    const [pop2] = await Promise.all([page.waitForEvent('popup'), page.locator('[data-cm="dl-pdf"]').click()]);
    await until(async () => (await pop2.locator('h1').count()) === 1, 15000);
    check('"PDF without photos" has the same programme and no speaker pictures', /Dr\. Priya Menon/.test(await pop2.locator('.sheet').innerText()) && (await pop2.locator('.ph').count()) === 0 && (await pop2.locator('img').count()) === 1);
    const pdf2 = await pop2.pdf({ format: 'A4', printBackground: true });
    check('...and prints to a PDF too', pdf2.slice(0, 5).toString() === '%PDF-' && pdf2.length < 400 * 1024, Math.round(pdf2.length / 1024) + ' KB');
    await pop2.close();

    // ---- a pass from a speaker's card ----
    await page.locator('[data-cm="tab"][data-k="speakers"]').click();
    const give = page.locator('[data-cm="give-pass"][data-id="1"]');
    check('a speaker with an email and no pass shows "issue one"', await until(() => give.isVisible()));
    await give.click();
    check('one click issues the Speaker pass', await until(async () => ((await dbq("SELECT badge_type FROM attendees WHERE email = 'kk@example.test'"))[0] || {}).badge_type === 'Speaker'));
    check('...and the card then shows it', await until(async () => (await page.locator('[data-cm="give-pass"][data-id="1"]').count()) === 0));

    // ---- Delhi ----
    await page.locator('select[data-cm-input="event"]').selectOption('start-delhi');
    check('"Start planning Delhi" opens its empty programme, private', await until(() => page.locator('#cm-planning').isVisible(), 10000) && /Planning Bharat AI Innovation Delhi 2027/.test(await page.locator('#cm-planning').innerText()) && /Attendees see nothing/.test(await page.locator('#cm-planning').innerText()));
    check('its day buttons are its own', /Wed 28 Jul/.test(await page.locator('.cm-pills').first().innerText()), await page.locator('.cm-pills').first().innerText());
    await page.locator('[data-cm="copy-from"]').click();
    check("Mumbai's programme comes across as drafts", await until(async () => (await dbq('SELECT COUNT(*) AS n FROM sessions WHERE event_id = 2'))[0].n === 5, 10000) && await until(async () => (await page.locator('.cm-block.is-draft').count()) >= 3));
    check('none of them has a speaker', (await dbq('SELECT COUNT(*) AS n FROM sessions WHERE event_id = 2 AND speaker_name IS NOT NULL'))[0].n === 0);
    await page.locator('select[data-cm-input="event"]').selectOption('1');
    check('back to Mumbai: its own programme, no "Planning" note', await until(async () => !(await page.locator('#cm-planning').count()) && (await page.locator('.cm-block', { hasText: 'AI in Healthcare' }).count()) === 1, 10000));
    check('Mumbai was not touched by the copy', (await dbq('SELECT COUNT(*) AS n FROM sessions WHERE event_id = 1'))[0].n === 5);
    check('no script error on the laptop', errors.length === 0, errors);
    await ctx.close();

    // ---- on a phone ----
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await pctx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await pctx.addInitScript(adminInit);
    const ph = await pctx.newPage();
    const perr = [];
    ph.on('pageerror', e => { if (!/sandboxed/.test(String(e))) perr.push(String(e)); });
    await ph.goto(BASE + '/admin#sessions', { waitUntil: 'domcontentloaded' });
    await until(() => ph.locator('[data-cm="stat-attention"]').isVisible(), 20000);
    await ph.locator('[data-cm="stat-attention"]').click();
    check('phone: the attention list opens from the top number', await until(async () => (await ph.locator('.cm-att tbody tr').count()) > 3));
    const w = await ph.evaluate(() => document.documentElement.scrollWidth);
    check('phone: nothing wider than the screen', w <= 391, 'scrollWidth ' + w);
    check('phone: no script error', perr.length === 0, perr);
    await pctx.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
