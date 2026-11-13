// End to end: Admin, Submissions in a real browser (Edge) on the real built worker and
// real SQLite (submissions-harness.mjs), 12 Nov 2026. A laptop: the sidebar count, one
// card per email with its picture, who it is from and the right thing already chosen;
// a logo used and undone; a photo used; people added to a team after unticking one;
// nothing chosen is refused in words; an email whose name, subject, words, link and
// file name are attacks draws as text and runs nothing; a vector file opened on its
// own cannot run its script; set aside and bring back; the "without asking" switch.
// Then a phone: one column, nothing pushing the page sideways.
// Needs submissions-harness.mjs (HARNESS_PORT, default 8865).
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8865);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); if (!ok) fails++; };
const until = async (fn, ms = 15000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch { /* not yet */ } await sleep(200); } return false; };
const db = async () => (await fetch(BASE + '/__db')).json();
const signIn = () => { if (window.top !== window) return; sessionStorage.setItem('tc_admin_token', 'iq-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Priya'); };

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/__db')).ok; } catch { /* starting */ } if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    await ctx.addInitScript(signIn);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());

    // ---- the sidebar, from any section ----
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    const first = await db();
    const acme = first.exhibitors.find((e) => /Acme/.test(e.company_name));
    check('five emails were filed by the real route', first.subs.length === 5 && first.subs.every((s) => s.status === 'new'), first.subs);
    check('the sidebar says how many are waiting', await until(async () => (await page.locator('#sub-new-badge').innerText()).trim() === '5'), await page.locator('#sub-new-badge').innerText().catch(() => 'no badge'));

    // ---- the screen ----
    await page.click('[data-section="submissions"]');
    check('the screen loads its own script and style and draws one card per email', await until(async () => (await page.locator('.sbd .sb-card').count()) === 5, 30000), await page.locator('.sbd .sb-card').count());
    check('the stylesheet is applied (a card has its border and two columns)', await page.locator('.sb-card').first().evaluate((el) => { const s = getComputedStyle(el); return s.borderTopStyle === 'solid' && s.display === 'grid' && s.gridTemplateColumns.split(' ').length === 2; }));
    check('three tabs with their counts', (await page.locator('.sb-tab').allInnerTexts()).join('|').replace(/\s+/g, '') === 'Waiting5|Used0|Setaside0', await page.locator('.sb-tab').allInnerTexts());
    check('newest first', /Mallory/.test(await page.locator('.sb-card').first().innerText()) && /Our logo for the website/.test(await page.locator('.sb-card').last().innerText()));

    const card = (source) => page.locator('.sb-card[data-row="' + first.subs.find((s) => s.source_id === source).id + '"]');
    const logo = card('h-logo');
    check('logo card: called a Logo, from whom, when in India', /LOGO/i.test(await logo.locator('.sb-kind').innerText()) && /Ravi Kumar/.test(await logo.locator('.sb-who').innerText()) && /12 Nov, 8:30 am/.test(await logo.locator('.sb-when').innerText()), await logo.locator('.sb-who').innerText());
    check('logo card: says the sender is the booth contact, for certain', /Acme Robotics Pvt Ltd/.test(await logo.locator('.sb-match').first().innerText()) && /the booth contact/.test(await logo.locator('.sb-sure').first().innerText()));
    check('logo card: the picture draws', await until(() => logo.locator('.sb-thumb img').evaluate((img) => img.complete && img.naturalWidth === 300)));
    check('logo card: the size and name of the file', /Acme logo\.png/.test(await logo.locator('.sb-fname').innerText()) && /300 × 100/.test(await logo.locator('.sb-fmeta').innerText()));
    check('logo card: Acme is already chosen, as a logo', (await logo.locator('select[data-pick]').inputValue()) === 'logo:' + acme.id);
    check('logo card: the link opens the email in AImailPilot, in a new tab', (await logo.locator('.sb-links a').getAttribute('href')).startsWith('https://aimailpilot.com/#inbox/') && (await logo.locator('.sb-links a').getAttribute('rel')) === 'noopener');

    // ---- a logo used, then undone ----
    await logo.locator('[data-act="apply"]').click();
    check('Use it: the card says what was done and by whom', await until(async () => /Logo of Acme Robotics Pvt Ltd, by Priya/.test(await logo.locator('.sb-done').innerText())), await logo.innerText());
    let now = await db();
    check('Use it: the exhibitor now carries the logo', /\/api\/uploads\/submissions\//.test(now.exhibitors.find((e) => e.id === acme.id).logo_url || ''), now.exhibitors);
    check('Use it: one fewer waiting, in the sidebar too', await until(async () => (await page.locator('#sub-new-badge').innerText()).trim() === '4'));
    check('Use it: the card stays in view with Undo beside it', await logo.locator('[data-act="undo"]').isVisible() && (await logo.getAttribute('data-status')) === 'applied');
    await logo.locator('[data-act="undo"]').click();
    check('Undo: the logo is taken off again', await until(async () => !(await db()).exhibitors.find((e) => e.id === acme.id).logo_url));
    check('Undo: the card is waiting again', await until(async () => (await logo.getAttribute('data-status')) === 'new' && (await logo.locator('.sb-done').count()) === 0));
    await logo.locator('[data-act="apply"]').click();
    await until(async () => (await logo.locator('.sb-done').count()) === 1);

    // ---- a photo ----
    const photo = card('h-photo');
    const talk = first.talks.find((t) => /Asha/.test(t.speaker_name));
    check('photo card: the speaker\'s talk is already chosen', /PHOTO/i.test(await photo.locator('.sb-kind').innerText()) && (await photo.locator('select[data-pick]').inputValue()) === 'talk:' + talk.id);
    check('photo card: a photo is cropped to fill, a logo is shown whole', (await photo.locator('.sb-thumb img').evaluate((i) => getComputedStyle(i).objectFit)) === 'cover' && (await logo.locator('.sb-thumb img').evaluate((i) => getComputedStyle(i).objectFit)) === 'contain');
    await photo.locator('[data-act="apply"]').click();
    check('photo used: the talk carries it', await until(async () => /\/api\/uploads\/submissions\//.test((await db()).talks.find((t) => t.id === talk.id).speaker_photo_url || '')));

    // ---- a team ----
    const team = card('h-team');
    check('team card: three people read from the email, each in boxes to correct', (await team.locator('tr[data-person]').count()) === 3 && (await team.locator('tr[data-person] [data-p="first_name"]').first().inputValue()) === 'Priya' && (await team.locator('tr[data-person] [data-p="mobile"]').first().inputValue()) === '9820012345');
    check('team card: the exhibitor is already chosen', (await team.locator('select[data-team-pick]').inputValue()) === String(acme.id));
    await team.locator('tr[data-person]').nth(2).locator('[data-p="on"]').uncheck();
    await team.locator('tr[data-person]').nth(1).locator('[data-p="designation"]').fill('Head of Sales');
    await team.locator('[data-act="team"]').click();
    check('team: the two ticked are added, with the corrected designation; the third is not', await until(async () => { const t = (await db()).team; return t.some((m) => m.email === 'priya.nair@acmerobotics.in' && m.added_by === 'inbox:Priya') && t.some((m) => m.email === 'arjun@acmerobotics.in') && !t.some((m) => m.email === 'kiran@acmerobotics.in'); }), (await db()).team);
    check('team: the card says who was added', await until(async () => /2 added to the team of Acme Robotics Pvt Ltd, by Priya: Priya Nair, Arjun Mehta/.test(await team.innerText())), await team.innerText());

    // ---- nothing chosen ----
    const evil = card('h-evil');
    check('a stranger: nothing is chosen for you, and the card says so', (await evil.locator('select[data-pick]').inputValue()) === '' && /not on any list yet/.test(await evil.locator('.sb-match').innerText()));
    await evil.locator('[data-act="apply"]').click();
    check('Use it with nothing chosen: refused in words, nothing sent', await until(async () => /Choose what this file is first/.test(await evil.locator('[data-err]').innerText())) && (await db()).subs.find((s) => s.source_id === 'h-evil').status === 'new');

    // ---- an email that attacks the reader ----
    check('attack: the name, subject and words are shown as typed', /<img src=x onerror="window.__subXss=1">Mallory/.test(await evil.locator('.sb-who').innerText()) && /<script>window.__subXss=2<\/script>Logo/.test(await evil.locator('.sb-subject').innerText()) && /<b onmouseover/.test(await evil.locator('.sb-body').innerText()));
    check('attack: no element was made from any of it', (await evil.locator('.sb-who img, .sb-subject script, .sb-body img, .sb-body b, .sb-fname img').count()) === 0);
    check('attack: a link that is not a web page is not a link', (await evil.locator('.sb-links a').count()) === 0);
    check('attack: the file name is plain, its address is under submissions/', !/[<>"]/.test(await evil.locator('.sb-fname').innerText()) && /^\/api\/uploads\/submissions\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(await evil.locator('.sb-thumb').getAttribute('href')), await evil.locator('.sb-thumb').getAttribute('href'));
    await evil.locator('.sb-body').hover();
    check('attack: nothing ran', (await page.evaluate(() => window.__subXss)) === undefined);

    // ---- a vector file ----
    const vec = card('h-svg');
    check('vector logo: likely Acme, by the company email, and only ever offered as a logo', /likely, same company email/.test(await vec.locator('.sb-maybe').first().innerText()) && (await vec.locator('select[data-pick]').inputValue()) === 'logo:' + acme.id && (await vec.locator('select[data-pick] optgroup').count()) === 1);
    const svgPage = await ctx.newPage();
    await svgPage.goto(BASE + (await vec.locator('.sb-thumb').getAttribute('href')));
    await sleep(500);
    check('vector logo: opened on its own, the script inside does not run', (await svgPage.evaluate(() => window.__subXss).catch(() => undefined)) === undefined);
    await svgPage.close();
    check('vector logo: shown as a picture in the card, the script inert', (await page.evaluate(() => window.__subXss)) === undefined && await vec.locator('.sb-thumb img').evaluate((img) => img.complete && img.naturalWidth > 0));

    // ---- choosing and rejecting (13 Nov 2026) ----
    await vec.locator('[data-act="match"][data-do="reject"][data-type="exhibitor"]').first().click();
    check('No on a suggestion: crossed out, and the picker no longer starts on it', await until(async () => (await vec.locator('.sb-chip[data-off="1"]').count()) >= 1 && (await vec.locator('select[data-pick]').inputValue()) !== 'logo:' + acme.id), await vec.locator('.sb-match').first().innerText());
    await vec.locator('.sb-chip[data-off="1"] [data-do="clear"]').first().click();
    check('Undo: offered again, and the picker starts on it again', await until(async () => (await vec.locator('.sb-chip[data-off="1"]').count()) === 0 && (await vec.locator('select[data-pick]').inputValue()) === 'logo:' + acme.id));
    await vec.locator('[data-act="match"][data-do="choose"][data-type="talk"]').first().click();
    check('Yes on a suggestion: marked chosen', await until(async () => /✓ chosen/.test(await vec.locator('.sb-chip[data-on="1"]').first().innerText())));
    await vec.locator('[data-act="file-reject"]').click();
    check('Reject a file: kept small and crossed out, with no Use it', await until(async () => (await vec.locator('.sb-file[data-rejected="1"]').count()) === 1 && (await vec.locator('[data-act="apply"]').count()) === 0));
    await vec.locator('[data-act="file-undo"]').click();
    check('Undo: the file is back to use', await until(async () => (await vec.locator('[data-act="apply"]').count()) === 1));
    await team.locator('[data-act="person"][data-do="reject"]').first().click();
    check('✕ on a person: crossed out, unticked and locked', await until(async () => (await team.locator('tr[data-person="0"]').getAttribute('data-off')) === '1' && !(await team.locator('tr[data-person="0"] [data-p="on"]').isChecked()) && await team.locator('tr[data-person="0"] [data-p="first_name"]').isDisabled()));
    await team.locator('tr[data-person="0"] [data-do="undo"]').click();
    check('Undo: the person is back', await until(async () => (await team.locator('tr[data-person="0"]').getAttribute('data-off')) === null));
    await team.locator('[data-act="tick-none"]').click();
    check('Untick all, then Tick all', (await team.locator('[data-p="on"]:checked').count()) === 0 && await (async () => { await team.locator('[data-act="tick-all"]').click(); return (await team.locator('[data-p="on"]:checked').count()) === 3; })());
    check('every choice is saved on the server, by Priya', await until(async () => { const r = await (await fetch(BASE + '/api/admin/inbox-submissions?status=all', { headers: { Authorization: 'Bearer iq-admin' } })).json(); const v = r.rows.find((x) => x.subject === 'Logo in vector'); return v && v.matches.chosen && v.matches.chosen.talk && v.decided_by === 'Priya'; }));

    // ---- set aside, bring back ----
    await evil.locator('[data-act="dismiss"]').click();
    check('Set aside: the card leaves Waiting', await until(async () => (await evil.count()) === 0));
    await page.click('[data-tab="dismissed"]');
    check('Set aside: it is under Set aside, with who did it', await until(async () => (await page.locator('.sb-card').count()) === 1 && /Set aside by Priya/.test(await page.locator('.sb-foot').innerText())), await page.locator('.sbd').innerText());
    await page.locator('[data-act="reopen"]').click();
    check('Bring back: Set aside is empty again', await until(async () => (await page.locator('.sb-card').count()) === 0 && /Nothing has been set aside/.test(await page.locator('.sb-empty').innerText())));
    await page.click('[data-tab="applied"]');
    check('Used: the three that were used, each with what was done', await until(async () => (await page.locator('.sb-card').count()) === 3) && (await page.locator('.sb-done').count()) === 3, await page.locator('.sb-card').count());
    await page.click('[data-tab="new"]');
    check('Waiting: the two left, and the tabs agree with the sidebar', await until(async () => (await page.locator('.sb-card').count()) === 2) && (await page.locator('[data-tab="new"] b').innerText()) === '2' && (await page.locator('#sub-new-badge').innerText()).trim() === '2', await page.locator('.sb-tabs').innerText());

    // ---- without asking ----
    check('Use without asking is off, and folded away', /: off/.test(await page.locator('.sb-auto summary').innerText()) && !(await page.locator('.sb-auto').evaluate((d) => d.open)));
    await page.locator('.sb-auto summary').click();
    await page.locator('[data-auto="logo"]').check();
    check('switch: Logos on is saved on the server and said on screen', await until(async () => { const s = (await db()).settings[0]; return s && JSON.parse(s.value).logo === true && JSON.parse(s.value).photo === false; }) && await until(async () => /on for logos/.test(await page.locator('.sb-auto summary').innerText())));
    await page.locator('[data-auto="logo"]').uncheck();
    check('switch: off again', await until(async () => JSON.parse((await db()).settings[0].value).logo === false));

    // ---- a link straight to the section ----
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => errors.push('link: ' + e.message));
    await p2.goto(BASE + '/admin#submissions', { waitUntil: 'domcontentloaded' });
    check('/admin#submissions opens the screen directly', await until(async () => (await p2.locator('.sbd .sb-card').count()) === 2, 30000));
    await p2.close();
    check('no script error on the laptop', errors.length === 0, errors);

    // ---- a phone ----
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await phone.addInitScript(signIn);
    const ph = await phone.newPage();
    ph.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await ph.goto(BASE + '/admin#submissions', { waitUntil: 'domcontentloaded' });
    check('phone: the screen draws', await until(async () => (await ph.locator('.sbd .sb-card').count()) === 2, 30000));
    const wide = await ph.evaluate(() => { const s = document.getElementById('section-submissions'); return { page: document.documentElement.scrollWidth, sec: s.scrollWidth, secw: s.clientWidth }; });
    check('phone: nothing pushes the page sideways', wide.page <= 391 && wide.sec <= wide.secw + 1, wide);
    check('phone: a card is one column', await ph.locator('.sb-card').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length === 1));
    check('phone: the button is big enough to tap', await ph.locator('.sb-btn-go').first().evaluate((el) => el.getBoundingClientRect().height >= 30));
    check('no script error on the phone', errors.length === 0, errors);
  } catch (e) {
    console.log('FAIL crashed: ' + (e && e.stack || e));
    fails++;
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
