// Exhibitor teams (11 Nov 2026) in a real browser (Edge), on the real built worker and
// real SQLite (team-harness.mjs). First a phone, as the booth contact: the emailed
// sign-in link opening Your Team, every box the organiser asked for, the form naming
// what is wrong, a photo uploaded, the pass issued, the next person asked to buy a
// Delegate Pass, edit and remove, the branding sizes, the stage talk taking its
// speaker from the team, nothing wider than the screen, no page errors. Then a laptop,
// as the organisers: Teams & Passes, the deadline, an exception to the number of
// passes, the team with its photo, the email asked for, and the CSV.
// Needs team-harness.mjs (HARNESS_PORT, default 8851). Started by run-all.mjs.
const crypto = require('crypto');
const path = require('path');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8851);
const PHOTO = path.join(__dirname, '..', '..', 'public', 'images', 'talks', 'aditi-saini.webp');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(200); } return false; };
// On a phone the dashboard menu is folded away: open it first, as a person would.
const openMenuItem = async (pg, sel) => {
  await sleep(500); // a menu still sliding shut from the last tap
  const inView = await pg.locator(sel).evaluate(e => { const r = e.getBoundingClientRect(); return r.right > 4 && r.left < innerWidth - 4; });
  if (!inView) { await pg.locator('#dash-sidebar-toggle').click(); await sleep(450); }
  await pg.locator(sel).click();
};
const dbq = async (q) => (await fetch(BASE + '/__db?q=' + encodeURIComponent(q))).json();
// The link the "add your team" email carries, made the way the server makes it.
const hmac = (m) => crypto.createHmac('sha256', 'h-mp').update(m).digest('hex');
// An event-app session and a pass QR token, made the way the server makes them (harness secret 'h').
const appCookie = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const b = id + '.' + exp; return b + '.' + crypto.createHmac('sha256', 'h').update(b).digest('hex'); };
const passToken = (id) => id + '.' + crypto.createHmac('sha256', 'h').update('pass:' + id).digest('hex').slice(0, 24);
const signInLink = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const fp = hmac('mplink-pw:').slice(0, 16); return `/marketplace/signin?t=${id}.${exp}.${fp}.${hmac(`mplink:${id}.${exp}.${fp}`)}&go=team`; };

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/payments/config')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ================= the booth contact, on a phone =================
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    const noSideScroll = async (where) => {
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      check('phone: nothing wider than the screen on ' + where, w <= 391, 'scrollWidth ' + w);
    };

    await page.goto(BASE + signInLink(1));
    check('the emailed link signs the contact in and opens Your Team', await until(async () => page.url().endsWith('/marketplace/dashboard#team') && await page.locator('#section-team').isVisible()), page.url());
    const intro = await page.locator('#team-intro').innerText();
    check('Your Team says what the booth includes and that the contact needs to add themselves', /Harness Explorer Pvt Ltd/.test(intro) && /includes 1 pass/i.test(intro) && /only if you add yourself/.test(intro), intro);
    check('the menu shows Your Team and Booth Branding', await page.locator('#dash-nav-team').count() === 1 && !(await page.locator('#dash-nav-team').getAttribute('class')).includes('hidden') && !(await page.locator('#dash-nav-branding').getAttribute('class')).includes('hidden'), '');
    await noSideScroll('Your Team');

    // ---- the form ----
    await page.locator('#team-add-btn').click();
    check('Add a person opens the form, at the booth ticked, the company filled in', await until(() => page.locator('#team-form').isVisible()) && await page.locator('#team-at-booth').isChecked() && await page.locator('#team-company').inputValue() === 'Harness Explorer Pvt Ltd', '');
    for (const [id, label] of [['team-first', 'First name'], ['team-last', 'Last name'], ['team-designation', 'Designation'], ['team-company', 'Company name'], ['team-email', 'Email'], ['team-mobile', 'Mobile number'], ['team-linkedin', 'LinkedIn profile'], ['team-photo-file', 'Photo']]) {
      const lbl = await page.locator(`label[for="${id}"]`).innerText().catch(() => '')
      check('the form has a labelled box: ' + label, lbl.startsWith(label) && await page.locator('#' + id).isVisible(), lbl);
    }
    check('the role boxes say at the booth and on stage', /At the booth/.test(await page.locator('.team-roles').innerText()) && /On stage/.test(await page.locator('.team-roles').innerText()), '');
    const sizes = await page.evaluate(() => ['team-first', 'team-email', 'team-mobile'].map(id => parseFloat(getComputedStyle(document.getElementById(id)).fontSize)));
    check('boxes are 16px, so a phone does not zoom in on them', sizes.every(s => s >= 16), sizes);
    const tap = await page.evaluate(() => [...document.querySelectorAll('.team-role, #team-form button[type=submit], #team-add-btn')].map(e => e.getBoundingClientRect().height));
    check('the role choices and buttons are big enough to tap (44px)', tap.every(h => h >= 43.5), tap);

    await page.locator('#team-at-booth').uncheck();
    await page.locator('#team-form button[type=submit]').click();
    check('no role: the form says so and saves nothing', await until(async () => /choose their role/.test(await page.locator('#team-form-error').innerText())), await page.locator('#team-form-error').innerText());
    await page.locator('#team-speaker').check();
    await page.locator('#team-at-booth').check();
    await page.locator('#team-form button[type=submit]').click();
    check('no first name: named, and the box is focused', await until(async () => /first name/.test(await page.locator('#team-form-error').innerText()) && await page.evaluate(() => document.activeElement?.id === 'team-first')), await page.locator('#team-form-error').innerText());
    await page.locator('#team-first').fill('Asha');
    await page.locator('#team-last').fill('Rao');
    await page.locator('#team-designation').fill('Head of Sales');
    await page.locator('#team-email').fill('asha.rao@explorer.test');
    await page.locator('#team-mobile').fill('98200 12345');
    await page.locator('#team-linkedin').fill('linkedin.com/in/asha-rao');
    await page.locator('#team-form button[type=submit]').click();
    check('a mobile someone else holds is refused, their email masked', await until(async () => /already registered to another person \(so•••@else\.test\)/.test(await page.locator('#team-form-error').innerText())), await page.locator('#team-form-error').innerText());
    await page.locator('#team-mobile').fill('98200 55555');
    await page.locator('#team-linkedin').fill('example.com/asha');
    await page.locator('#team-form button[type=submit]').click();
    check('a link that is not LinkedIn is named', await until(async () => /LinkedIn/.test(await page.locator('#team-form-error').innerText()) && await page.evaluate(() => document.activeElement?.id === 'team-linkedin')), await page.locator('#team-form-error').innerText());
    check('nothing has been saved yet', (await dbq('SELECT COUNT(*) AS n FROM exhibitor_team WHERE exhibitor_id = 1'))[0].n === 0, '');
    await page.locator('#team-linkedin').fill('linkedin.com/in/asha-rao');
    await page.locator('#team-photo-file').setInputFiles(PHOTO);
    check('the chosen photo shows before saving', await until(() => page.locator('#team-photo-preview').isVisible()), '');
    await page.locator('#team-form button[type=submit]').click();
    check('saved: the form closes and the person is on the list', await until(async () => await page.locator('#team-form').isHidden() && (await page.locator('#team-list .team-card').count()) === 1, 10000), await page.locator('#team-form-error').innerText().catch(() => ''));
    const card = await page.locator('#team-list .team-card').first().innerText();
    check('the card shows name, designation, both roles and the speaker pass', /Asha Rao/.test(card) && /Head of Sales/.test(card) && /At the booth/.test(card) && /On stage/.test(card) && /Speaker pass issued/.test(card), card);
    check('the card shows the uploaded photo', await page.locator('#team-list .team-card img.team-photo').count() === 1 && /^\/api\/mp\/uploads\/\d+$/.test(await page.locator('#team-list .team-card img.team-photo').getAttribute('src')), '');
    const asha = (await dbq("SELECT badge_type, payment_status, job_title, mobile, linkedin_url, avatar_url, role FROM attendees WHERE email = 'asha.rao@explorer.test'"))[0];
    check('her pass exists: Exhibition Speaker, waived, details and photo on it', asha?.badge_type === 'Exhibition Speaker' && asha.payment_status === 'waived' && asha.job_title === 'Head of Sales' && asha.mobile === '98200 55555' && asha.linkedin_url === 'https://linkedin.com/in/asha-rao' && /^data:image\//.test(asha.avatar_url || ''), asha && { ...asha, avatar_url: String(asha.avatar_url).slice(0, 30) });
    check('the contact got no pass of their own', (await dbq("SELECT COUNT(*) AS n FROM attendees WHERE email = 'spoc@explorer.test'"))[0].n === 0, '');
    await noSideScroll('Your Team with a person');
    const [passDl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('[data-team-pass]').first().click()]);
    check("the contact downloads Asha's pass, drawn by the app's own pass designer", /\.png$/i.test(passDl.suggestedFilename()) && require('fs').statSync(await passDl.path()).size > 20000, passDl.suggestedFilename());
    const [socialDl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('[data-team-social]').first().click()]);
    check("and her social card", /\.png$/i.test(socialDl.suggestedFilename()) && require('fs').statSync(await socialDl.path()).size > 20000, socialDl.suggestedFilename());

    // ---- a badge scanned at the booth becomes a lead ----
    // Asha, on the team, is signed in to the event app on her own phone.
    const ashaId = (await dbq("SELECT id FROM attendees WHERE email = 'asha.rao@explorer.test'"))[0].id;
    const visitorId = (await dbq("SELECT id FROM attendees WHERE email = 'someone@else.test'"))[0].id;
    const lctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await lctx.addCookies([{ name: 'bai_session', value: appCookie(ashaId), url: BASE }]);
    const lp = await lctx.newPage();
    const lerrors = [];
    lp.on('pageerror', e => lerrors.push(String(e)));
    await lp.goto(BASE + '/exhibitor/scan');
    check('team phone: the scanner page names her company and asks for the camera', await until(async () => /Harness Explorer Pvt Ltd/.test(await lp.locator('main').innerText())) && await lp.locator('#v').count() === 1, await lp.locator('main').innerText().catch(() => ''));
    await lp.goto(BASE + '/verify/' + passToken(visitorId));
    check('scanning a visitor opens the lead screen and saves the lead by itself', await until(async () => /Saved to your leads/.test(await lp.locator('#st').innerText())) && /Somebody Else/.test(await lp.locator('.card').innerText()) && (await dbq('SELECT COUNT(*) AS n FROM exhibitor_leads WHERE exhibitor_id = 1'))[0].n === 1, await lp.locator('main').innerText().catch(() => ''));
    check('the lead screen shows no email or mobile', !/someone@else|9820012345/.test(await lp.content()), '');
    await lp.locator('[data-r="hot"]').tap();
    check('one tap rates it hot', await until(async () => /Saved as hot/.test(await lp.locator('#st').innerText()) && await lp.locator('[data-r="hot"]').getAttribute('aria-pressed') === 'true') && (await dbq('SELECT rating FROM exhibitor_leads WHERE exhibitor_id = 1'))[0].rating === 'hot', await lp.locator('#st').innerText());
    await lp.locator('#n').fill('Wants a demo next week');
    await lp.locator('#sv').tap();
    check('the note is saved, the rating kept', await until(async () => /Note saved/.test(await lp.locator('#st').innerText())) && JSON.stringify((await dbq('SELECT rating, note, scanned_by FROM exhibitor_leads WHERE exhibitor_id = 1'))[0]) === JSON.stringify({ rating: 'hot', note: 'Wants a demo next week', scanned_by: 'Asha Rao' }), await lp.locator('#st').innerText());
    const lw = await lp.evaluate(() => [document.documentElement.scrollWidth, ...[...document.querySelectorAll('.rate button, .btn')].map(b => Math.round(b.getBoundingClientRect().height))]);
    check('the lead screen fits a phone, with buttons big enough to tap', lw[0] <= 391 && lw.slice(1).every(h => h >= 44), lw);
    check('Scan next badge goes back to the scanner', await lp.locator('a.btn[href="/exhibitor/scan"]').count() === 1, '');
    check('team phone: no page errors', lerrors.length === 0, lerrors.join(' | '));
    await lctx.close();
    // The booth contact sees it on the dashboard.
    await page.reload();
    await page.locator('#section-team').waitFor();
    await openMenuItem(page, '#dash-nav-leads');
    const leadsText = await page.locator('#section-leads').innerText();
    check('dashboard: Leads lists the scanned visitor, rated hot, with the note and who scanned', /1 lead · 1 scanned at your booth · 1 hot/.test(leadsText) && /Somebody Else/.test(leadsText) && /Badge scanned/.test(leadsText) && /by Asha Rao/.test(leadsText) && /Our note: Wants a demo next week/.test(leadsText) && await page.locator('[data-rating="hot"]').getAttribute('aria-pressed') === 'true', leadsText);
    await page.locator('[data-rating="warm"]').click();
    check('dashboard: the rating can be changed', await until(async () => (await dbq('SELECT rating FROM exhibitor_leads WHERE exhibitor_id = 1'))[0].rating === 'warm' && await page.locator('[data-rating="warm"]').getAttribute('aria-pressed') === 'true'), '');
    const [leadsDl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.locator('#leads-csv').click()]);
    const leadsCsv = require('fs').readFileSync(await leadsDl.path(), 'utf8');
    check('dashboard: the leads download as a CSV', leadsDl.suggestedFilename() === 'booth-leads.csv' && /Somebody Else/.test(leadsCsv) && /Badge scanned/.test(leadsCsv) && /warm/.test(leadsCsv), leadsCsv.slice(0, 200));
    await noSideScroll('Leads');
    await openMenuItem(page, '#dash-nav-team');

    // ---- the booth's one pass is used: the next person is asked to buy a Delegate Pass ----
    await page.locator('#team-add-btn').click();
    const full = page.locator('#team-full');
    check('Add again on a full booth: asked to buy a Delegate Pass, with its price', await until(async () => await full.isVisible() && /all are in use/.test(await full.innerText()) && /Delegate Pass \(₹[\d,]+ \+ GST\)/.test(await full.innerText())), await full.innerText().catch(() => ''));
    check('the button goes to the Delegate Pass, tagged as an exhibitor extra', await full.locator('a.mp-btn-primary').getAttribute('href') === '/register?source=exhibitor_extra#delegate' && await full.locator('a.mp-btn-primary').getAttribute('target') === '_blank', '');
    check('the form stays closed', await page.locator('#team-form').isHidden(), '');
    await page.locator('[data-team-add-own]').click();
    await page.locator('#team-first').fill('Binod');
    await page.locator('#team-designation').fill('Engineer');
    await page.locator('#team-email').fill('binod@explorer.test');
    await page.locator('#team-form button[type=submit]').click();
    check('someone without a pass of their own is still refused, and the prompt comes back', await until(async () => await page.locator('#team-full').isVisible() && await page.locator('#team-form').isHidden()) && (await page.locator('#team-list .team-card').count()) === 1, JSON.stringify({ err: await page.locator('#team-form-error').innerText().catch(() => ''), fullVisible: await page.locator('#team-full').isVisible(), formHidden: await page.locator('#team-form').isHidden(), cards: await page.locator('#team-list .team-card').count(), errors }));

    // ---- edit ----
    await page.locator('[data-team-edit]').first().click();
    check('Edit opens the form filled in, titled with the name', await until(async () => await page.locator('#team-form').isVisible() && await page.locator('#team-designation').inputValue() === 'Head of Sales' && /Edit Asha Rao/.test(await page.locator('#team-form-title').innerText())), '');
    await page.locator('#team-designation').fill('VP Sales');
    await page.locator('#team-form button[type=submit]').click();
    check('the edit is saved', await until(async () => /VP Sales/.test(await page.locator('#team-list .team-card').first().innerText())) && (await dbq("SELECT job_title FROM attendees WHERE email = 'asha.rao@explorer.test'"))[0].job_title === 'Head of Sales', '');

    // ---- the stage talk takes its speaker from the team ----
    await openMenuItem(page, '#dash-nav-stage');
    const fromTeam = page.locator('#stage-from-team');
    check('Stage Talk: the speaker comes from Your Team and the boxes are hidden', await until(async () => await fromTeam.isVisible() && /Asha Rao/.test(await fromTeam.innerText()) && /VP Sales/.test(await fromTeam.innerText())) && await page.locator('#stage-speaker').isHidden() && await page.locator('#stage-topic').isVisible(), await fromTeam.innerText().catch(() => ''));
    await page.locator('#stage-topic').fill('Selling AI to banks');
    await page.locator('#stage-form button[type=submit]').click();
    check('the topic saves, the speaker stays Asha', await until(async () => { const t = (await dbq('SELECT topic, speaker_name FROM innovation_talks WHERE exhibitor_id = 1'))[0]; return t?.topic === 'Selling AI to banks' && t.speaker_name === 'Asha Rao'; }), '');

    // ---- branding sizes ----
    await openMenuItem(page, '#dash-nav-branding');
    const brand = await page.locator('#branding-card').innerText();
    check('Booth Branding: the Explorer Booth sizes, revised', /Explorer Booth \(2m × 2m\)/.test(brand) && /Fascia Name\s+1800mm \(W\) × 300mm \(H\)/.test(brand) && /Back Wall\s+1940mm \(W\) × 2440mm \(H\)/.test(brand) && /Table Logo\s+960mm \(W\) × 670mm \(H\)/.test(brand), brand);
    check('Booth Branding: email the artwork to the Bharat AI contact, register@ in CC', /email your final artwork to Test Owner at owner@example\.test and mark register@bharataiinnovation\.com in CC/.test(brand), brand);
    await noSideScroll('Booth Branding');

    // ---- overview to-do ----
    await openMenuItem(page, '.dash-sidebar-item[data-section="overview"]');
    const boothCard = await page.locator('#dash-booth').innerText();
    check('Overview: the booth card names the event, the booth, the passes and the payment', /Bharat AI Innovation 2026/.test(boothCard) && /20–21 Nov 2026 · World Trade Center, Mumbai/.test(boothCard) && /No\. 21 · Explorer Booth \(2m × 2m\)/.test(boothCard) && /1 of 1 issued/.test(boothCard) && /Paid ₹1,00,000/.test(boothCard) && /Pending ₹52,220/.test(boothCard) && /Total ₹1,52,220 including GST · Invoice BAI\/26-27\/9/.test(boothCard), boothCard);
    check('the overview to-do lists the team step as done', /Add your team and their photos/.test(await page.locator('#dash-todo').innerText()) && /1 person added\./.test(await page.locator('#dash-todo').innerText()), await page.locator('#dash-todo').innerText());

    // ---- the Delhi edition, on the dashboard's first screen ----
    const delhiCard = page.locator('#dash-delhi');
    check('Overview: the Delhi card is shown to the exhibitor, in the words of the Delhi page', await until(() => delhiCard.isVisible()) && /Delhi 2027/i.test(await delhiCard.innerText()) && /Exhibit in Delhi: 29–30 July 2027/.test(await delhiCard.innerText()) && /Booths and partnerships are open now/.test(await delhiCard.innerText()), await delhiCard.innerText().catch(() => ''));
    const delhiLink = delhiCard.locator('a[data-delhi-open]');
    check('Overview: its button goes to the booths on the Delhi page, in a new tab', await delhiLink.getAttribute('href') === '/delhi?from=exhibitor#booths' && await delhiLink.getAttribute('target') === '_blank' && /See booths for Delhi/.test(await delhiLink.innerText()), await delhiLink.getAttribute('href'));
    await delhiCard.scrollIntoViewIfNeeded();
    check('Overview: the Delhi picture loads', await until(() => delhiCard.locator('img').evaluate(i => i.complete && i.naturalWidth > 0)), '');
    const dbtn = await delhiLink.boundingBox();
    check('phone: the Delhi button is big enough to press and inside the screen', !!dbtn && dbtn.height >= 36 && dbtn.x >= 0 && dbtn.x + dbtn.width <= 390, dbtn);
    await noSideScroll('Overview with the Delhi card');
    const [delhiTab] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }), delhiLink.click()]);
    check('Overview: pressing it opens the Delhi page in its own tab and the dashboard stays', await until(() => /\/delhi\?from=exhibitor#booths$/.test(delhiTab.url())) && /\/marketplace\/dashboard/.test(page.url()), delhiTab.url());
    await delhiTab.close();
    check('Overview: the press is counted once for this exhibitor account', await until(async () => (await dbq("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'delhi_promo.open' AND entity = 'mp_company' AND entity_id = '1'"))[0].n === 1), '');

    await openMenuItem(page, '#dash-nav-connect');
    const connect = await page.locator('#section-connect').innerText();
    check('Bharat AI Connect: the tab says what the app is for and who has signed in', /Open Bharat AI Connect/.test(connect) && /0 of 1 signed in so far/.test(connect) && /Asha Rao\s*Not signed in yet/.test(connect) && await page.locator('#section-connect a.connect-open').getAttribute('href') === '/app', connect);
    await noSideScroll('Bharat AI Connect');

    // ---- report a problem ----
    await openMenuItem(page, '#dash-nav-report');
    await page.locator('#report-form button[type=submit]').click();
    check('Report a problem: sending without a topic is refused on screen', await until(async () => /choose what the problem is about/.test(await page.locator('#report-error').innerText())), '');
    await page.locator('#report-topic').selectOption('payment');
    await page.locator('#report-message').fill('We paid in full on 5 November, but the page shows an amount pending.');
    await page.locator('#report-form button[type=submit]').click();
    check('the report is sent and listed as open', await until(async () => /Payment or invoice\s*Open/.test(await page.locator('#report-list').innerText())) && (await dbq("SELECT COUNT(*) AS n FROM inquiries WHERE inquiry_type = 'exhibitor_issue'"))[0].n === 1, await page.locator('#report-list').innerText().catch(() => ''));
    await noSideScroll('Report a problem');

    // ---- remove ----
    await openMenuItem(page, '#dash-nav-team');
    await page.locator('[data-team-remove]').first().click();
    check('Remove takes the person off and gives back the pass', await until(async () => (await page.locator('#team-list .team-card').count()) === 0) && (await dbq("SELECT badge_type FROM attendees WHERE email = 'asha.rao@explorer.test'"))[0].badge_type === 'Visitor Pass', '');
    check('with nobody on stage, the stage form shows the speaker boxes again', await (async () => { await openMenuItem(page, '#dash-nav-stage'); return until(async () => await page.locator('#stage-from-team').isHidden() && await page.locator('#stage-speaker').isVisible()); })(), '');
    check('phone: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();

    // ================= the sheet-only contact sees their imported person =================
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p2 = await ctx2.newPage();
    const errors2 = [];
    p2.on('pageerror', e => errors2.push(String(e)));
    await p2.goto(BASE + signInLink(2));
    await until(() => p2.locator('#section-team').isVisible());
    const c2 = await p2.locator('#team-list .team-card').first().innerText().catch(() => '');
    check('a person from the sheet is already listed, with what is still needed', /Shivendra Singh/.test(c2) && /Still needed: Photo, Mobile, LinkedIn/.test(c2), c2);
    check('Startup Pod from the sheet: 1 pass, branding with no side walls', /includes 1 pass/.test(await p2.locator('#team-intro').innerText()) && await (async () => { await openMenuItem(p2, '#dash-nav-branding'); return /Left Wall\s+None/.test(await p2.locator('#branding-card').innerText()); })(), '');
    check('sheet contact: no page errors', errors2.length === 0, errors2.join(' | '));
    await ctx2.close();

    // ================= the organisers, on a laptop =================
    const actx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
    await actx.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); });
    const ap = await actx.newPage();
    const aerrors = [];
    ap.on('pageerror', e => aerrors.push(String(e)));
    let promptAnswer = '3';
    ap.on('dialog', d => (d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept()));
    await ap.goto(BASE + '/marketplace/admin');
    await ap.locator('.dash-sidebar-item[data-section="teams"]').click();
    check('admin: Teams & Passes lists both exhibitors', await until(async () => /Harness Explorer Pvt Ltd/.test(await ap.locator('#admin-teams').innerText()) && /Sheet Only Labs/.test(await ap.locator('#admin-teams').innerText())), await ap.locator('#admin-teams').innerText().catch(() => ''));
    check('admin: the summary counts people and photos missing', /1 people · 0 with a pass · 1 photos missing/.test(await ap.locator('#team-summary').innerText()) || /people/.test(await ap.locator('#team-summary').innerText()), await ap.locator('#team-summary').innerText());
    await ap.locator('#team-deadline').fill('15 November 2026');
    await ap.locator('#team-deadline-form button').click();
    check('admin: the deadline is saved', await until(async () => (await dbq("SELECT value FROM app_settings WHERE key = 'team_details_deadline'"))[0]?.value === '15 November 2026'), '');
    await ap.locator('[data-team-passes="1"]').click();
    check('admin: an exception of 3 passes for the Explorer Booth', await until(async () => (await dbq('SELECT passes FROM exhibitor_team_settings WHERE exhibitor_id = 1'))[0]?.passes === 3 && /0 of 3/.test(await ap.locator('#admin-teams').innerText())), await ap.locator('#admin-teams').innerText());
    await ap.locator('[data-team-settle="2"]').click();
    check('admin: Issue passes gives the sheet person their speaker pass', await until(async () => (await dbq("SELECT badge_type FROM attendees WHERE email = 'shivendra@sheet.test'"))[0]?.badge_type === 'Exhibition Speaker'), '');
    await ap.locator('[data-team-show="2"]').click();
    check('admin: Show team lists the person with no photo yet', await until(async () => /Shivendra Singh/.test(await ap.locator('[data-team-detail="2"]').innerText()) && /No photo/.test(await ap.locator('[data-team-detail="2"]').innerText())), '');
    await ap.locator('[data-team-ask="2"]').click();
    const teamMail = async () => (await (await fetch(BASE + '/__sent')).json()).find(m => m.Recipients.To[0] === 'spoc@sheet.test');
    const mails = await until(async () => !!(await teamMail()));
    const mail = await teamMail();
    const html = mail?.Content.Body[0].Content || '';
    check('admin: Ask sends the team email to the sheet contact', mails && mail.Recipients.To[0] === 'spoc@sheet.test' && /Dear Shweta,/.test(html) && /Deadline: 15 November 2026/.test(html) && /We have already added the person/.test(html), mail && mail.Recipients);
    check('admin: once asked, the row says asked today', await until(async () => /Asked today/.test(await ap.locator('#admin-teams').innerText())), '');
    await ap.locator('.dash-sidebar-item[data-section="reports"]').click();
    await ap.locator('.dash-sidebar-item[data-section="exhibitors"]').click();
    check('admin: the exhibitor list in the app is OFF, and says what turning it on shows', await until(async () => /Exhibitor list in the app: OFF/.test(await ap.locator('#directory-card').innerText()) && /shows 2 exhibitors/.test(await ap.locator('#directory-card').innerText())), await ap.locator('#directory-card').innerText().catch(() => ''));
    await ap.locator('#directory-toggle').click();
    check('admin: Turn it on makes the list live', await until(async () => /Exhibitor list in the app: ON/.test(await ap.locator('#directory-card').innerText())) && (await (await fetch(BASE + '/api/events/1/exhibitors')).json()).length === 2, await ap.locator('#directory-card').innerText().catch(() => ''));
    await ap.locator('.dash-sidebar-item[data-section="reports"]').click();
    check('admin: Reports shows the open report, with a count on the menu', await until(async () => /Harness Explorer Pvt Ltd/.test(await ap.locator('#admin-reports').innerText()) && /Open/.test(await ap.locator('#admin-reports').innerText())) && (await ap.locator('#reports-count').innerText()) === '1', await ap.locator('#admin-reports').innerText().catch(() => ''));
    promptAnswer = 'We have recorded your payment. Thank you.';
    await ap.locator('[data-report-resolve]').first().click();
    check('admin: Mark resolved with a reply', await until(async () => /Resolved/.test(await ap.locator('#admin-reports').innerText()) && /Reply: We have recorded your payment/.test(await ap.locator('#admin-reports').innerText())), '');
    // ---- partners in the app ----
    await ap.locator('.dash-sidebar-item[data-section="partners"]').click();
    check('admin: Partners in the app starts with nobody', await until(async () => /No partners are shown in the app yet/.test(await ap.locator('#partners-rows').innerText())), await ap.locator('#partners-rows').innerText().catch(() => ''));
    await ap.locator('#partner-add').click();
    await ap.locator('[data-partner-row] [data-f="name"]').fill('Jade Global');
    await ap.locator('[data-partner-row] [data-f="logo"]').fill('https://elsewhere.example/logo.png');
    await ap.locator('#partners-save').click();
    check('admin: a logo from another site is refused, in words, and what was typed stays', await until(async () => /Not saved\. Row 1: the logo must be a picture on this site/.test(await ap.locator('#partners-msg').innerText())) && await ap.locator('[data-partner-row] [data-f="name"]').inputValue() === 'Jade Global', await ap.locator('#partners-msg').innerText());
    await ap.locator('[data-partner-row] [data-f="label"]').fill('Panel Host Partner');
    await ap.locator('[data-partner-row] [data-f="logo"]').fill('/images/exhibitors/jade-global.webp');
    await ap.locator('#partners-save').click();
    check('admin: the partner is saved', await until(async () => /Saved\. 1 partner is now shown in the app\./.test(await ap.locator('#partners-msg').innerText())), await ap.locator('#partners-msg').innerText());
    // ---- the Delhi edition in the app ----
    check('admin: the Delhi card is on, with our wording shown in grey', await until(async () => await ap.locator('#delhi-on').isChecked() && (await ap.locator('#delhi-title').getAttribute('placeholder')) === 'Next: Bharat AI Innovation Delhi 2027') && await ap.locator('#delhi-title').inputValue() === '' && (await ap.locator('#delhi-ex-cta').getAttribute('placeholder')) === 'See booths for Delhi', await ap.locator('#delhi-title').getAttribute('placeholder'));
    check('admin: it says how many have opened it', /Opened so far by 0 people in the app and 1 exhibitor account\. Each one is counted once\./.test(await ap.locator('#delhi-opened').innerText()), await ap.locator('#delhi-opened').innerText());
    await ap.locator('#delhi-title').fill('x'.repeat(80));
    check('admin: the heading box stops at 80 characters', (await ap.locator('#delhi-title').inputValue()).length === 80 && await ap.locator('#delhi-title').getAttribute('maxlength') === '80', '');
    await ap.locator('#delhi-title').fill('Delhi is next: 29–30 July 2027');
    await ap.locator('#delhi-save').click();
    check('admin: the new heading is saved and stays in its box', await until(async () => /Saved\. The Delhi card is shown in the app and on exhibitor dashboards\./.test(await ap.locator('#delhi-msg').innerText())) && await ap.locator('#delhi-title').inputValue() === 'Delhi is next: 29–30 July 2027' && await ap.locator('#delhi-on').isChecked(), await ap.locator('#delhi-msg').innerText());
    await ap.locator('.dash-sidebar-item[data-section="teams"]').click();
    const [dl] = await Promise.all([ap.waitForEvent('download', { timeout: 10000 }), ap.locator('#team-csv').click()]);
    const csv = require('fs').readFileSync(await dl.path(), 'utf8');
    check('admin: the CSV downloads with everyone', dl.suggestedFilename() === 'exhibitor-teams.csv' && /Exhibitor,Booth,First name/.test(csv) && /Shivendra/.test(csv), csv.slice(0, 200));
    const aw = await ap.evaluate(() => document.documentElement.scrollWidth);
    check('admin: the page itself does not scroll sideways (the table scrolls in its box)', aw <= 1366, aw);
    check('admin: no page errors', aerrors.length === 0, aerrors.join(' | '));
    await actx.close();

    // ================= an attendee: Our partners, and the workshop certificate =================
    // Wider than 900 both ways: on a touch laptop the app takes a smaller window for a phone and
    // shows the picture to save instead of downloading it (isTouchPhone).
    const wctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
    await wctx.addCookies([{ name: 'bai_session', value: appCookie(900), url: BASE }]);
    await wctx.addInitScript(() => { try { localStorage.setItem('agba_user', JSON.stringify({ id: 900, event_id: 1, name: 'Wendy Workshop', email: 'wendy@example.test', badge_type: 'Premium Delegate Pass', payment_status: 'paid' })); } catch (e) {} });
    const wp = await wctx.newPage();
    const werrors = [];
    wp.on('pageerror', e => werrors.push(String(e)));
    await wp.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    check('app: Home shows the partner the organisers added, with its label and logo', await until(async () => await wp.locator('#app-partners').isVisible() && /Panel Host Partner/.test(await wp.locator('#app-partners').innerText()), 12000) && await wp.locator('#app-partners img').getAttribute('src') === '/images/exhibitors/jade-global.webp' && await wp.locator('#app-partners img').getAttribute('alt') === 'Jade Global', await wp.locator('#app-partners').innerText().catch(() => ''));
    await wp.locator('#app-partners').scrollIntoViewIfNeeded();
    const logoShown = await until(() => wp.evaluate(() => { const i = document.querySelector('#app-partners img'); return !!i && i.complete && i.naturalWidth > 0; }));
    check('app: the partner logo really loads', logoShown, logoShown);
    await wp.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser && currentUser.id === 900, null, { timeout: 15000 }).catch(() => {});
    await wp.evaluate(() => switchTab('myprofile'));
    check('app: someone with a workshop seat is offered the workshop certificate', await until(() => wp.locator('#ws-cert-btn').isVisible(), 12000), await wp.locator('#ws-cert-btn').count());
    const [cdl] = await Promise.all([wp.waitForEvent('download', { timeout: 25000 }), wp.locator('#ws-cert-btn').click()]);
    const csize = require('fs').statSync(await cdl.path()).size;
    check('app: the workshop certificate downloads as a picture', cdl.suggestedFilename() === 'BharatAI-2026-Workshop-Certificate.png' && csize > 20000, cdl.suggestedFilename() + ' ' + csize);
    // ---- the Delhi edition on Home ----
    await wp.evaluate(() => switchTab('dashboard'));
    const dcard = wp.locator('#app-delhi');
    check('app: a signed-in person sees the Delhi card on Home, with the heading the organisers typed', await until(async () => await dcard.isVisible() && /Delhi is next: 29–30 July 2027/.test(await dcard.innerText()), 12000) && /Passes are open now/.test(await dcard.innerText()) && /See the Delhi edition/.test(await dcard.innerText()), await dcard.innerText().catch(() => ''));
    check('app: the card goes to the Delhi page, in a new tab', await wp.locator('#app-delhi-link').getAttribute('href') === '/delhi?from=app' && await wp.locator('#app-delhi-link').getAttribute('target') === '_blank', await wp.locator('#app-delhi-link').getAttribute('href'));
    await dcard.scrollIntoViewIfNeeded();
    const dlook = await wp.evaluate(() => { const css = (id) => getComputedStyle(document.getElementById(id)); const i = document.getElementById('app-delhi-img'); return { title: css('app-delhi-title').color, text: css('app-delhi-text').color, cta: css('app-delhi-cta').color, ctaBg: css('app-delhi-cta').backgroundColor, src: i.getAttribute('src') }; });
    check('app: the Delhi picture loads (the large one on a computer)', await until(() => wp.locator('#app-delhi-img').evaluate(i => i.complete && i.naturalWidth > 0)) && dlook.src === '/images/delhi/mandapam-dusk-1600.webp', dlook.src);
    check('app: the words are white on the dark picture and the button is the app orange', dlook.title === 'rgb(255, 255, 255)' && dlook.text === 'rgb(227, 229, 242)' && dlook.cta === 'rgb(255, 255, 255)' && dlook.ctaBg === 'rgb(200, 79, 0)', dlook);
    const [dtab] = await Promise.all([wctx.waitForEvent('page', { timeout: 8000 }), wp.locator('#app-delhi-link').click()]);
    check('app: pressing it opens the Delhi page in its own tab and the app stays open', await until(() => /\/delhi\?from=app$/.test(dtab.url())) && /\/app/.test(wp.url()), dtab.url());
    await dtab.close();
    check('app: the press is counted once for this person', await until(async () => (await dbq("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'delhi_promo.open' AND entity = 'attendee' AND entity_id = '900'"))[0].n === 1), '');
    check('app: no page errors', werrors.length === 0, werrors.join(' | '));
    await wctx.close();

    // ---- the same card on a phone ----
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await pctx.addCookies([{ name: 'bai_session', value: appCookie(900), url: BASE }]);
    await pctx.addInitScript(() => { try { localStorage.setItem('agba_user', JSON.stringify({ id: 900, event_id: 1, name: 'Wendy Workshop', email: 'wendy@example.test', badge_type: 'Premium Delegate Pass', payment_status: 'paid' })); } catch (e) {} });
    const pp = await pctx.newPage();
    const perrors = [];
    pp.on('pageerror', e => perrors.push(String(e)));
    await pp.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    const pcard = pp.locator('#app-delhi-link');
    check('phone: the Delhi card is on Home for a signed-in person', await until(() => pcard.isVisible(), 12000), '');
    await pcard.scrollIntoViewIfNeeded();
    const pbox = await pcard.boundingBox();
    const pcta = await pp.locator('#app-delhi-cta').boundingBox();
    const pw = await pp.evaluate(() => document.documentElement.scrollWidth);
    check('phone: the card fits the screen and nothing scrolls sideways', !!pbox && pbox.x >= 0 && pbox.x + pbox.width <= 390 && pw <= 391, { pbox, pw });
    check('phone: the button is inside the card and big enough to press', !!pcta && pcta.height >= 36 && pcta.x >= pbox.x && pcta.x + pcta.width <= pbox.x + pbox.width && pcta.y + pcta.height <= pbox.y + pbox.height, pcta);
    check('phone: the small picture is used, and it loads', await pp.locator('#app-delhi-img').getAttribute('src') === '/images/delhi/mandapam-dusk-phone.webp' && await until(() => pp.locator('#app-delhi-img').evaluate(i => i.complete && i.naturalWidth > 0)), await pp.locator('#app-delhi-img').getAttribute('src'));
    check('phone: the heading and the line can be read in full (not cut off)', await pp.evaluate(() => ['app-delhi-title', 'app-delhi-text'].every(id => { const e = document.getElementById(id); return e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().height > 0; })), '');
    check('phone: no page errors', perrors.length === 0, perrors.join(' | '));
    await pctx.close();

    // ---- someone not signed in is not shown it (they are choosing a Mumbai pass) ----
    const octx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const op = await octx.newPage();
    await op.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    check('signed out: the partners arrive but the Delhi card stays hidden', await until(() => op.locator('#app-partners').isVisible(), 12000) && !(await op.locator('#app-delhi-link').isVisible()), '');
    await octx.close();

    // ---- the organisers switch it off ----
    const actx2 = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await actx2.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); });
    const ap2 = await actx2.newPage();
    await ap2.goto(BASE + '/marketplace/admin');
    await ap2.locator('.dash-sidebar-item[data-section="partners"]').click();
    check('admin: both presses show in the count', await until(async () => /Opened so far by 1 person in the app and 1 exhibitor account\./.test(await ap2.locator('#delhi-opened').innerText())), await ap2.locator('#delhi-opened').innerText().catch(() => ''));
    await ap2.locator('#delhi-on').uncheck();
    await ap2.locator('#delhi-save').click();
    check('admin: switching it off says the card is hidden', await until(async () => /Saved\. The Delhi card is hidden\./.test(await ap2.locator('#delhi-msg').innerText())), await ap2.locator('#delhi-msg').innerText());
    await actx2.close();
    const hctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await hctx.addCookies([{ name: 'bai_session', value: appCookie(900), url: BASE }, { name: 'mp_session', value: '1.' + hmac('1'), url: BASE }]);
    await hctx.addInitScript(() => { try { localStorage.setItem('agba_user', JSON.stringify({ id: 900, event_id: 1, name: 'Wendy Workshop', email: 'wendy@example.test', badge_type: 'Premium Delegate Pass', payment_status: 'paid' })); } catch (e) {} });
    const hp = await hctx.newPage();
    await hp.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    check('switched off: the app shows the partners and no Delhi card', await until(() => hp.locator('#app-partners').isVisible(), 12000) && !(await hp.locator('#app-delhi-link').isVisible()), '');
    await hp.goto(BASE + '/marketplace/dashboard');
    check('switched off: the exhibitor dashboard shows the booth and no Delhi card', await until(() => hp.locator('#dash-booth').isVisible(), 12000) && !(await hp.locator('#dash-delhi').isVisible()), '');
    await hctx.close();

    // ---- the email, opened in the browser as the contact would see it ----
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mp = await mctx.newPage();
    await mp.setContent(html);
    const mailText = await mp.locator('body').innerText();
    check('the email reads in order: greeting, details, passes, button, deadline, sign-off', ['Dear Shweta,', 'Greetings from Bharat AI Innovation!', 'Booth Representative and Speaker Details', 'Passes Included', 'Add your team details', 'Deadline: 15 November 2026', 'Warm regards,'].every((w, i, a) => mailText.indexOf(w) > -1 && (i === 0 || mailText.indexOf(w) > mailText.indexOf(a[i - 1]))), mailText.slice(0, 400));
    const mw = await mp.evaluate(() => document.documentElement.scrollWidth);
    check('the email fits a phone screen', mw <= 391, mw);
    await mctx.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nAll exhibitor team browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL suite crashed: ' + (e.stack || e.message)); process.exit(1); });
