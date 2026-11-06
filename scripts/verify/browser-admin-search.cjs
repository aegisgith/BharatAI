// The Attendees search box in a real browser (Edge), on the real built worker and
// real SQLite (board-harness.mjs, about 3,100 people). Started by run-all.mjs.
// The complaint of 6 Nov 2026: it took one letter, then the cursor was gone. So the
// typing checks press real keys one at a time and never click the box again.
// Unit (the page's own matching helpers), integration (what the page draws),
// system (the worker's real list) and end to end (keys on a keyboard).
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8798);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const until = async (fn, ms) => { const t = Date.now() + ms; while (Date.now() < t) { if (await fn()) return true; await sleep(50); } return false; };

// People with the awkward details of the real list, added to what the worker sent.
const PEOPLE = [
  [90001, 'Raj Patel', 'rajkp@apex36tech.com', '8369083082', 'Apex 36 Technologies'],
  [90002, 'Raj Chauhan', 'raj@apex36tech.com', '7045544709', 'Apex36 Technologies'],
  [90003, 'Maneesh Agrawal', 'magrawal@wayfair.com', '+919845049812', 'Wayfair'],
  [90004, 'Mackenzie Rao', 'mk@example.com', '9000000001', 'Rao & Sons'],
  [90005, 'Ken Adams', 'ken@example.com', '9000000002', 'Adams <b>Co</b>'],
  [90006, 'Sooraj Mohan', 'sooraj.mohan@integro.in', '7836867837', 'Integro Finserv'],
  [90007, 'Priya Panelonly', 'priya@college.edu', '9000000003', 'DJ Sanghvi', 0],
  [90008, "Anil D'Souza", 'anil@example.com', '9000000004', "D'Souza & Co"],
];

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }

  // Edge by default. BROWSER=firefox or BROWSER=webkit (Safari's engine) runs the
  // same checks there, when Playwright's own copy of that browser is installed:
  // the operators use Safari and Firefox.
  const other = process.env.BROWSER;
  const browser = other ? await pw[other].launch({ headless: true }) : await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const open = async () => {
      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof switchSection === 'function');
      await page.evaluate(() => switchSection('attendees'));
      return until(() => page.evaluate(() => document.querySelectorAll('.att-row').length > 0), 30000);
    };
    const addPeople = () => page.evaluate((people) => {
      lastAttendees = lastAttendees.filter(a => a.id < 90000).concat(people.map(p => ({ id: p[0], name: p[1], email: p[2], mobile: p[3], company: p[4], main_event: p[5] === 0 ? 0 : 1, job_title: 'Engineer', city: 'Mumbai', country: 'India', badge_type: 'Visitor Pass', payment_status: 'paid', created_at: '2026-11-01 10:00:00' })));
      loadAdminAttendees(null, true);
    }, PEOPLE);
    // The duplicates answer takes many seconds on this harness and would redraw the
    // list in the middle of a check. An empty one keeps the first part repeatable;
    // a held-back one and then the server's real one are let through further down.
    const DUPES = '**/attendees/duplicates';
    const noDupes = (r) => r.fulfill({ json: { groups: [], mobileGroups: 0, certainGroups: 0, nameGroups: 0 } });
    await page.route(DUPES, noDupes);
    const rowCount = () => page.evaluate(() => document.querySelectorAll('.att-row').length);
    const allRowsIn = (n) => until(async () => (await rowCount()) === n, 15000);
    check('the Attendees list loads', await open(), 'no rows');
    await addPeople();

    const box = page.locator('#admin-att-search');
    const settled = () => until(() => page.evaluate(() => !attSearchTimer), 3000);
    const names = async () => { await settled(); return page.evaluate(() => [...document.querySelectorAll('.att-row td:nth-child(4)')].map(td => td.innerText.trim())); };
    const count = async () => { await settled(); return page.evaluate(() => document.getElementById('att-search-count').innerText); };
    const help = async () => { await settled(); return page.evaluate(() => (document.getElementById('att-search-help') || {}).innerText || ''); };
    const search = async (q) => { await box.fill(q); return names(); };

    // ---- the complaint: type a whole name without clicking again ----
    await box.click();
    await page.evaluate(() => { document.getElementById('admin-att-search').dataset.same = 'yes'; });
    await page.keyboard.type('raj patel', { delay: 200 });
    await settled();
    const typed = await page.evaluate(() => { const b = document.getElementById('admin-att-search'); return { v: b.value, focused: document.activeElement === b, same: b.dataset.same, caret: b.selectionStart }; });
    check('slowly, with the list redrawing between letters: the whole name lands in the box', typed.v === 'raj patel', JSON.stringify(typed));
    check('the box still has the cursor, at the end, and was never replaced', typed.focused && typed.same === 'yes' && typed.caret === 9, JSON.stringify(typed));
    check('the list was filtered', (await names())[0] === 'Raj Patel', JSON.stringify((await names()).slice(0, 5)));

    await box.fill('');
    await box.click();
    await page.keyboard.type('maneesh agrawal wayfair', { delay: 0 });
    check('typing as fast as keys can go loses nothing', (await box.inputValue()) === 'maneesh agrawal wayfair', await box.inputValue());
    check('and finds the person', (await names())[0] === 'Maneesh Agrawal', JSON.stringify(await names()));

    await box.fill('rajpatel');
    await box.click();
    await settled();
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.type(' ');
    await settled();
    const mid = await page.evaluate(() => { const b = document.getElementById('admin-att-search'); return { v: b.value, caret: b.selectionStart }; });
    check('editing in the middle of the words keeps the cursor there', mid.v === 'raj patel' && mid.caret === 4, JSON.stringify(mid));

    await box.fill('');
    await settled();
    await box.click();
    await page.keyboard.type('ra');
    await page.evaluate(() => loadAdminAttendees(null, true));   // a refresh arriving mid-word
    await page.keyboard.type('j');
    check('a refresh mid-word does not lose the cursor', (await box.inputValue()) === 'raj', await box.inputValue());

    // ---- typing never waits for the table ----
    await box.fill('');
    await settled();
    await box.click();
    const draws = await page.evaluate(() => { window.__draws = 0; const real = attPutSection; attPutSection = function (h) { window.__draws++; return real(h); }; return true; }).then(async () => {
      await page.keyboard.type('maneesh agrawal', { delay: 40 });
      await settled();
      return page.evaluate(() => window.__draws);
    });
    check('a name typed in one go redraws the list once or twice, not per letter', draws >= 1 && draws <= 2, draws + ' redraws');
    const redraw = await page.evaluate(() => { const t = performance.now(); attQuery = 'r'; attSearchRender(); return performance.now() - t; });
    console.log('note: one full page of results takes ' + Math.round(redraw) + ' ms to draw, once typing pauses');
    await box.fill('');
    await settled();

    // ---- how it matches, on the page ----
    let got = await search('patel raj');
    check('words in any order: "patel raj"', got[0] === 'Raj Patel', JSON.stringify(got.slice(0, 3)));
    got = await search('raj apex');
    check('words across fields: "raj apex" finds both at the company', got.includes('Raj Patel') && got.includes('Raj Chauhan') && got.length === 2, JSON.stringify(got));
    got = await search('apex36');
    check('"apex36" also finds "Apex 36"', got.includes('Raj Patel') && got.includes('Raj Chauhan'), JSON.stringify(got));
    got = await search('apex 36');
    check('"apex 36" also finds "Apex36"', got.includes('Raj Patel') && got.includes('Raj Chauhan'), JSON.stringify(got));
    got = await search('RAJ   PATEL');
    check('capitals and extra spaces do not matter', got[0] === 'Raj Patel', JSON.stringify(got.slice(0, 3)));
    for (const m of ['+91 98450 49812', '98450-49812', '098450 49812', '919845049812', '98450']) {
      got = await search(m);
      check('mobile typed as "' + m + '" finds the person', got.includes('Maneesh Agrawal'), JSON.stringify(got.slice(0, 3)));
    }
    got = await search('wayfair.com');
    check('email fragment', got[0] === 'Maneesh Agrawal', JSON.stringify(got.slice(0, 3)));
    got = await search('#90003');
    check('an ID', got[0] === 'Maneesh Agrawal', JSON.stringify(got.slice(0, 3)));
    got = await search("d'souza");
    check('an apostrophe stays in the box and finds the person', got[0] === "Anil D'Souza" && (await box.inputValue()) === "d'souza", JSON.stringify(got.slice(0, 3)));

    // ---- best first ----
    got = await search('ken');
    check('"ken": the name that starts with it comes before a name that only contains it', got[0] === 'Ken Adams' && got.indexOf('Mackenzie Rao') > 0, JSON.stringify(got.slice(0, 4)));
    check('it says so', await page.evaluate(() => /Best matches first/.test(document.getElementById('section-attendees').innerText)), 'no label');
    await page.evaluate(() => sortAttendees('email'));
    const headerWon = await until(() => page.evaluate(() => /Sorted by email/.test(document.getElementById('section-attendees').innerText)), 15000);
    check('clicking a column header takes over from best-first', headerWon, 'still ranked');
    await page.evaluate(() => resetAttSort());
    await until(() => page.evaluate(() => /Best matches first/.test(document.getElementById('section-attendees').innerText)), 15000);
    await addPeople();   // those two refetched the list

    // ---- marking the words, safely ----
    await search('ken adams');
    const marks = await page.evaluate(() => [...document.querySelectorAll('#att-row-90005 mark')].map(m => m.textContent));
    check('the letters searched for are marked in the row', marks.includes('Ken') && marks.includes('ken'), JSON.stringify(marks));
    await search('ken adams co');
    const safe = await page.evaluate(() => { const c = document.querySelector('#att-row-90005 td:nth-child(7)'); return c ? { text: c.innerText, bold: !!c.querySelector('b'), marks: c.querySelectorAll('mark').length } : {}; });
    check('a company with markup in it shows as text, even when marked', safe.text === 'Adams <b>Co</b>' && !safe.bold && safe.marks > 0, JSON.stringify(safe));
    await search('mackenzie amp');
    const amp = await page.evaluate(() => { const c = document.querySelector('#att-row-90004 td:nth-child(7)'); return c ? { html: c.innerHTML, text: c.innerText } : {}; });
    check('searching "amp" never marks inside an & entity', amp.text === 'Rao & Sons' && !/<mark/.test(amp.html), JSON.stringify(amp));
    const hostile = '"><img src=x onerror=window.__bad=1>';
    const held = await page.evaluate((v) => {
      document.getElementById('admin-att-search').blur();
      attQuery = v; attSearchRender();
      return document.getElementById('admin-att-search').value === v && !document.querySelector('#att-search-help img');
    }, hostile);
    check('a search with quotes and markup stays in the box and draws nothing', held, 'value lost or markup injected');
    await sleep(200);
    check('and nothing ran', await page.evaluate(() => !window.__bad), 'script ran');

    // ---- when nothing shows ----
    await search('priya panelonly');
    check('nobody in the list: says who is outside it', /No one found in this list/.test(await help()) && /1 person matches among campus panel registrants/.test(await help()), await help());
    await search('raj');
    const alsoHidden = await page.evaluate((id) => { lastAttendees.push({ id, name: 'Raj Panelonly', email: 'rp@college.edu', mobile: '9000000005', company: 'DJ Sanghvi', main_event: 0, badge_type: 'Visitor Pass' }); loadAdminAttendees(null, true); return (document.getElementById('att-search-help') || {}).innerText || ''; }, 90009);
    check('some found and some outside it: says "1 more person"', /1 more person matches/.test(alsoHidden) && !/No one found/.test(alsoHidden), alsoHidden);
    await page.evaluate(() => { lastAttendees = lastAttendees.filter(a => a.id !== 90009); });
    await search('priya panelonly');
    await page.locator('#att-search-help button', { hasText: 'Show them' }).click();
    got = await names();
    check('"Show them" brings the person in and keeps the search', got.includes('Priya Panelonly') && (await box.inputValue()) === 'priya panelonly', JSON.stringify(got));
    check('and Everyone is what the filter now says', await page.evaluate(() => attFilters.main === ''), 'filter unchanged');
    await page.evaluate(() => { attFilters.main = 'yes'; });

    await search('suraj mohan');
    const near = await help();
    check('a near spelling: no blank table, says nothing was found', /No one found for .suraj mohan/.test(near), near);
    check('and offers the close name', /Did you mean: .*Sooraj Mohan/.test(near), near);
    await page.locator('#att-search-help button', { hasText: 'Sooraj Mohan' }).click();
    got = await names();
    check('clicking the close name searches for it', got[0] === 'Sooraj Mohan' && (await box.inputValue()) === 'Sooraj Mohan', JSON.stringify(got));
    await search('zzzqqqxxx');
    const none = await help();
    check('truly nobody: a way forward, and no invented names', /Clear the search/.test(none) && /add a new attendee/.test(none) && !/Did you mean/.test(none), none);

    // ---- keys and buttons ----
    await box.fill('sooraj mohan');
    check('one result says Enter opens it', /1 found of .*press Enter to open/.test(await count()), await count());
    await box.fill('#2601');   // someone really in the database, so the record can load
    await box.press('Enter');   // before the pause: must not act on the old list
    const called = await until(() => page.evaluate(() => /Delegate 0/.test(document.body.innerText.replace(document.getElementById('section-attendees').innerText, ''))), 8000);
    check('Enter opens that one person, even straight after typing', called, 'drawer did not open');

    // ---- opening: the list does not wait for the duplicates answer ----
    await page.unroute(DUPES);
    let letDupesThrough; const dupGate = new Promise(r => { letDupesThrough = r; });
    let listAsked = 0, listAskedBeforeDupes = -1, dupesAsked = 0;
    page.on('request', r => { if (/attendees\?limit/.test(r.url())) listAsked++; });
    await page.route(DUPES, async (r) => {
      dupesAsked++;
      if (listAskedBeforeDupes < 0) listAskedBeforeDupes = listAsked;
      await dupGate;
      const ids = await page.evaluate(() => (window.__attVisibleIds || []).slice(0, 2).map(Number));
      await r.fulfill({ json: { groups: [{ reason: 'mobile', certain: true, primary: { id: ids[0] }, duplicates: [{ id: ids[1] }], count: 2 }], mobileGroups: 1, certainGroups: 1, nameGroups: 0 } });
    });
    listAsked = 0;
    check('the page opens again, with the duplicates answer still on its way', await open(), 'no rows');
    await until(() => dupesAsked > 0, 5000);
    check('duplicates are asked for once the whole list is in, not alongside it', dupesAsked === 1 && listAsked >= 5 && listAskedBeforeDupes === listAsked, JSON.stringify({ dupesAsked, listAsked, listAskedBeforeDupes }));
    const early = await page.evaluate(() => document.getElementById('section-attendees').innerText);
    check('everyone is on the screen without it', /\d+ total/.test(early) && !/same-mobile duplicates/.test(early) && (await rowCount()) > 0, early.slice(0, 120));
    await box.click();
    await page.keyboard.type('vis');
    await settled();
    letDupesThrough();
    const drawnIn = await until(() => page.evaluate(() => /1 same-mobile duplicates \(1 ready to merge\)/.test(document.getElementById('section-attendees').innerText)), 10000);
    check('when the answer comes, its count is drawn in and the two people are marked', drawnIn && await page.evaluate(() => document.querySelectorAll('.att-row.dup-row').length === 2), await page.evaluate(() => document.getElementById('section-attendees').innerText.slice(0, 160)));
    check('and the search box kept its letters and the cursor through that', (await box.inputValue()) === 'vis' && await page.evaluate(() => document.activeElement.id === 'admin-att-search'), await box.inputValue());
    await page.evaluate(() => { window.__draws = 0; const real = attPutSection; attPutSection = function (h) { window.__draws++; return real(h); }; attLoadDuplicates(); });
    await until(() => dupesAsked === 2, 5000);
    await sleep(400);
    check('the same answer a second time redraws nothing', await page.evaluate(() => window.__draws) === 0, 'redrawn');
    await page.unroute(DUPES);
    await page.route(DUPES, noDupes);
    await page.evaluate(() => { attSearchClear(); });
    await box.click();
    await page.keyboard.type('visitor');
    await box.press('Enter');
    await sleep(300);
    check('Enter with many results does nothing surprising', (await box.inputValue()) === 'visitor' && await page.evaluate(() => document.activeElement.id === 'admin-att-search'), 'focus moved');
    await settled();
    check('one clear button only: the browser adds its own to a search-type box', (await box.getAttribute('type')) === 'text', await box.getAttribute('type'));
    await page.locator('#att-search-clear').click();
    check('the clear button empties the box and leaves the cursor in it', (await box.inputValue()) === '' && await page.evaluate(() => document.activeElement.id === 'admin-att-search' && attQuery === ''), 'not cleared');
    await page.keyboard.type('vip');
    await page.keyboard.press('Escape');
    check('Esc clears and keeps the cursor for the next name', (await box.inputValue()) === '' && await page.evaluate(() => document.activeElement.id === 'admin-att-search'), await box.inputValue());
    await page.keyboard.press('Escape');
    check('a second Esc leaves the box', await page.evaluate(() => document.activeElement.id !== 'admin-att-search'), 'still focused');
    await page.keyboard.press('/');
    check('/ jumps to the box and is not typed into it', (await box.inputValue()) === '' && await page.evaluate(() => document.activeElement.id === 'admin-att-search'), await box.inputValue());
    await page.keyboard.type('a/b');
    check('/ inside the box is an ordinary letter', (await box.inputValue()) === 'a/b', await box.inputValue());
    await page.evaluate(() => { attSearchClear(); document.activeElement.blur(); });

    // ---- filters and the search leave each other alone ----
    await search('visitor');
    await page.evaluate(() => setAttFilter('payment', 'pending'));
    await page.locator('button', { hasText: 'Clear 1 filter' }).click();
    check('clearing the filters keeps what was typed', (await box.inputValue()) === 'visitor', await box.inputValue());

    // ---- the Set pass / Delete bar shows only while someone is ticked ----
    await search('');
    const bar = page.locator('#att-bulk-bar');
    check('with nobody ticked, the bar with Set pass and Delete is not on the screen', !(await bar.isVisible()), 'bar visible at 0 selected');
    const tickBox = page.locator('.att-row input[type="checkbox"]').nth(3);
    const rowTop = () => tickBox.evaluate(el => Math.round(el.getBoundingClientRect().top));
    await page.evaluate(() => window.scrollTo(0, 200));
    const before = await rowTop();
    await tickBox.check();
    const after = await rowTop();
    check('ticking one person shows it, saying 1 selected', (await bar.isVisible()) && /1 selected/.test(await bar.innerText()), await bar.innerText());
    check('and the ticked row has not moved on the screen', Math.abs(after - before) <= 1, before + ' -> ' + after);
    await page.locator('.att-row input[type="checkbox"]').nth(4).check();
    check('a second tick counts 2 and the bar stays', (await bar.isVisible()) && /2 selected/.test(await bar.innerText()), await bar.innerText());
    await page.evaluate(() => loadAdminAttendees(null, true));
    check('a redraw of the list keeps the bar and the ticks', (await bar.isVisible()) && /2 selected/.test(await bar.innerText()) && (await page.locator('.att-row input[type="checkbox"]:checked').count()) === 2, await bar.innerText());
    await page.locator('.att-row input[type="checkbox"]').nth(4).uncheck();
    const b2 = await rowTop();
    await tickBox.uncheck();
    const a2 = await rowTop();
    check('unticking the last person hides it again, the row still in place', !(await bar.isVisible()) && Math.abs(a2 - b2) <= 1, b2 + ' -> ' + a2);
    await page.locator('#attendee-table thead input[type="checkbox"]').check();
    check('the box in the heading ticks the page and offers "Select all ... matching"', await until(async () => (await bar.isVisible()) && /Select all \d+ matching/.test(await bar.innerText()), 5000), 'no offer');
    await bar.locator('button', { hasText: /^Clear$/ }).click();
    check('Clear unticks everyone and the bar goes', await until(async () => !(await bar.isVisible()) && (await page.locator('.att-row input[type="checkbox"]:checked').count()) === 0, 5000), 'bar still there');
    await page.evaluate(() => window.scrollTo(0, 0));

    // ---- the table draws a screenful at once, then the rest in steps ----
    await search('');
    await page.evaluate(() => { document.activeElement.blur(); document.querySelector('#section-attendees .overflow-y-auto').scrollTop = 0; });
    await allRowsIn(100);
    const first = await page.evaluate(() => { loadAdminAttendees(null, true); return { now: document.querySelectorAll('.att-row').length, screen: attRowsFirst(0), page: window.__attVisibleIds.length }; });
    check('a redraw puts a screenful of rows on the page at once, not the whole hundred', first.page === 100 && first.now === first.screen && first.now < 40, JSON.stringify(first));
    const inOrder = () => page.evaluate(() => [...document.querySelectorAll('.att-row')].map(r => r.id.replace('att-row-', '')).join(',') === window.__attVisibleIds.join(','));
    check('the rest follow: all hundred, each person once, in order', (await allRowsIn(100)) && await inOrder(), String(await rowCount()));
    await page.evaluate(async () => { loadAdminAttendees(null, true); await new Promise(r => setTimeout(r, 45)); loadAdminAttendees(null, true); });
    await allRowsIn(100);
    await sleep(300);
    check('a second redraw while the first is still filling leaves one clean table', (await rowCount()) === 100 && await inOrder(), String(await rowCount()));
    await page.evaluate(() => attToggleAllVisible(true));
    await allRowsIn(100);
    check('ticking the whole page ticks the rows that arrive later too', (await page.locator('.att-row input[type="checkbox"]:checked').count()) === 100, String(await page.locator('.att-row input[type="checkbox"]:checked').count()));
    await page.evaluate(() => attClearSelection());
    await page.evaluate(() => { localStorage.setItem('att_hidden_cols', '[6]'); loadAdminAttendees(null, true); });
    await allRowsIn(100);
    await sleep(100);
    check('a hidden column is hidden on the rows that arrive later too', await page.evaluate(() => [...document.querySelectorAll('.att-row')].every(r => r.children[6].classList.contains('att-col-hidden'))), 'some rows show it');
    await page.evaluate(() => { localStorage.removeItem('att_hidden_cols'); loadAdminAttendees(null, true); });
    await allRowsIn(100);
    const kept = await page.evaluate(async () => {
      document.querySelector('#section-attendees .overflow-y-auto').scrollTop = 1200;
      loadAdminAttendees(null, true);
      const now = document.querySelectorAll('.att-row').length;
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));
      return { top: document.querySelector('#section-attendees .overflow-y-auto').scrollTop, now };
    });
    check('a redraw while scrolled down comes back at the same place', Math.abs(kept.top - 1200) <= 2 && kept.now > first.now, JSON.stringify(kept));
    await allRowsIn(100);
    const far = await page.evaluate(() => { const id = window.__attVisibleIds[70]; document.querySelector('#section-attendees .overflow-y-auto').scrollTop = 0; loadAdminAttendees(id, true); return !!document.getElementById('att-row-' + id); });
    check('asked to show a row far down the page, that row is there at once', far, 'row not drawn');
    await allRowsIn(100);
    await page.evaluate(() => { document.querySelector('#section-attendees .overflow-y-auto').scrollTop = 0; });

    // ---- unit checks of the helpers, inside the page ----
    const u = await page.evaluate(() => ({
      blank: attSearchParse('   '), plain: attSearchParse('  Raj\tPatel ').words, short: attSearchParse('98').phone,
      plus: attSearchParse('+919845049812').phone, zero: attSearchParse('09845049812').phone, name: attSearchParse('raj 12').phone,
      d1: attSearchDistance('suraj', 'sooraj', 2), d2: attSearchDistance('abc', 'abd', 1), far: attSearchDistance('kumar', 'zhang', 2),
      none: attSearchApply([{ id: 1, name: 'A' }], '', true).length, nullSafe: attSearchApply([{ id: 1, name: null, email: null, mobile: null }], 'x', true).length,
      htmlOff: (attHLWords = [], attHL('<x>')), noValue: (attHLWords = ['a'], attHL(null)),
      date: fmtRegDate('2026-11-01 10:00:00'), dateOld: new Date('2026-11-01T10:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }),
      dateNone: fmtRegDate(''), dateBad: fmtRegDate('soon'),
      sumNone: attDupSummary(null), sumEmpty: attDupSummary({ groups: [] }),
      sumOne: attDupSummary({ mobileGroups: 1, certainGroups: 1, nameGroups: 0, groups: [{ primary: { id: 5 }, duplicates: [{ id: 9 }] }] }),
      rowsShort: attRowsFirst(0) >= 12, rowsScrolled: attRowsFirst(4000) >= 100,
    }));
    check('the date reads as it always did, and a blank or bad one is a dash', u.date === u.dateOld && /\d/.test(u.date) && />-</.test(u.dateNone) && />-</.test(u.dateBad), JSON.stringify([u.date, u.dateOld]));
    check('duplicates: no answer and an empty answer are the same news, a group is different news', u.sumNone === u.sumEmpty && u.sumOne === '1/1/0:5,9', JSON.stringify([u.sumNone, u.sumOne]));
    check('rows drawn at once: at least twelve, and enough to reach wherever the list was scrolled', u.rowsShort && u.rowsScrolled, JSON.stringify(u));
    check('parse: blank is no search, tabs split words, too few digits is not a mobile', u.blank === null && u.plain.join('|') === 'raj|patel' && u.short === '' && u.name === '', JSON.stringify(u));
    check('parse: +91 and a leading 0 come off a mobile', u.plus === '9845049812' && u.zero === '9845049812', JSON.stringify(u));
    check('distance: Suraj to Sooraj is 2, one letter is 1, far apart gives up', u.d1 === 2 && u.d2 === 1 && u.far === 3, JSON.stringify(u));
    check('blank search returns everyone, empty fields do not throw', u.none === 1 && u.nullSafe === 0, JSON.stringify(u));
    check('marking still escapes with nothing to mark, and takes an empty value', u.htmlOff === '&lt;x&gt;' && u.noValue === '', JSON.stringify(u));
    // ---- the server's own duplicates answer, slow as it is on this harness ----
    await page.unroute(DUPES);
    await page.evaluate(() => attLoadDuplicates());
    const real = await until(() => page.evaluate(() => /similar names|duplicates/.test(document.querySelector('#section-attendees .flex').innerText)), 120000);
    check('the real duplicates answer is drawn in when the server sends it', real, await page.evaluate(() => document.querySelector('#section-attendees .flex').innerText.slice(0, 160)));
    check('no script error anywhere above', errors.length === 0, JSON.stringify(errors));

    // ---- a phone ----
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => attSearchUse('visitor'));
    const phone = await page.evaluate(() => { const b = document.getElementById('admin-att-search').getBoundingClientRect(); return { left: b.left, right: b.right, inner: window.innerWidth }; });
    check('on a 390px phone the box fits the screen', phone.right <= phone.inner && phone.left >= 0, JSON.stringify(phone));
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll admin search checks passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL suite crashed: ' + (e.stack || e.message)); process.exit(1); });
