// End to end: the Media & Influencer Pass in a real browser (Edge) on the real built worker
// and real SQLite (media-harness.mjs), 12 Nov 2026. A phone: the page at 360 and 390
// wide with nothing pushing it sideways, 16px boxes and big buttons; Send with nothing
// chosen; the influencer part opening; each mistake named under its own box with the box
// focused (followers missing, nothing ticked, a link that is not one, not agreed); the
// server's own refusal (a mistyped email host) shown under the email box; the thank-you.
// Then a laptop: Admin's sidebar count, the Media & Influencer screen with her platforms,
// followers and sample links, Approve and issue pass (her Influencer Pass, the email),
// a contact-page request declined without an email, the tabs; and the screen on a phone.
// Needs media-harness.mjs (HARNESS_PORT, default 8867).
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8867);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); if (ok) passes++; else fails++; };
const until = async (fn, ms = 15000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch { /* not yet */ } await sleep(200); } return false; };
const db = async () => (await fetch(BASE + '/__db')).json();
const mails = async () => (await fetch(BASE + '/__mail')).json();
const signIn = () => { if (window.top !== window) return; sessionStorage.setItem('tc_admin_token', 'iq-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Priya'); };
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/__db')).ok; } catch { /* starting */ } if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    // ---------------------------------------------------------------- a phone
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID });
    const page = await phone.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/media-pass', { waitUntil: 'load' });
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('390 wide: the page does not scroll sideways', (await sideways()) <= 1, await sideways());
    check('the boxes are 16px (no zoom when tapped) and the button is big', await page.evaluate(() => {
      const i = document.getElementById('mp-name'), b = document.getElementById('mp-go');
      return getComputedStyle(i).fontSize === '16px' && i.getBoundingClientRect().height >= 48 && b.getBoundingClientRect().height >= 50;
    }));
    check('labels sit above their boxes', await page.evaluate(() => { const l = document.querySelector('label[for="mp-name"]').getBoundingClientRect(), i = document.getElementById('mp-name').getBoundingClientRect(); return l.bottom <= i.top + 1; }));

    await page.click('#mp-go');
    check('Send with nothing chosen: asked to choose, under the question and by the button', await until(async () => /Please choose Media or Influencer \/ creator\./.test(await page.locator('#mp-kind-box .mp-err').innerText()) && /Please check: Please choose/.test(await page.locator('#mp-msg').innerText())));
    check('...and nothing was sent', (await db()).requests.length === 1);

    await page.click('label:has(#mp-kind-influencer)');
    check('choosing Influencer / creator opens its questions and keeps the media ones closed', await page.locator('#mp-influencer').isVisible() && !(await page.locator('#mp-media').isVisible()));
    check('the choice clears the message', (await page.locator('#mp-msg').innerText()).trim() === '');
    await page.setViewportSize({ width: 360, height: 780 });
    check('360 wide with the influencer part open: still nothing sideways', (await sideways()) <= 1, await sideways());

    await page.fill('#mp-name', 'Asha Rao');
    await page.fill('#mp-email', 'asha@creator.in');
    await page.fill('#mp-mobile', '98200 12345');
    await page.fill('#mp-organisation', 'Asha Explains AI');
    await page.fill('#mp-designation', 'Creator');
    await page.fill('#mp-city', 'Pune');
    await page.fill('#pf-instagram-handle', '@asha.ai');
    await page.click('#mp-go');
    check('a handle without followers: named under that platform, the followers box focused and outlined', await until(async () => /Please add how many followers you have on Instagram\./.test(await page.locator('.mp-plat[data-platform="instagram"] .mp-err').innerText())) &&
      await page.evaluate(() => document.activeElement && document.activeElement.id === 'pf-instagram-followers' && document.activeElement.getAttribute('aria-invalid') === 'true'));
    await page.fill('#pf-instagram-followers', '45k');
    check('typing in the box takes the red outline and the message away', await page.evaluate(() => !document.getElementById('pf-instagram-followers').hasAttribute('aria-invalid')) && (await page.locator('.mp-plat[data-platform="instagram"] .mp-err').innerText()).trim() === '');
    await page.fill('#pf-youtube-handle', '@AshaExplains');
    await page.fill('#pf-youtube-followers', '1.2 lakh');
    await page.fill('#mp-niche', 'AI explainers');
    await page.fill('#mp-audience', 'All India');
    await page.click('#mp-go');
    check('nothing ticked to make: named under the list', await until(async () => /Please tick at least one thing you will make\./.test(await page.locator('#mp-formats-box .mp-err').innerText())));
    await page.click('label:has(#mp-format-reels)');
    await page.click('label:has(#mp-format-live)');
    await page.fill('#mp-during', 'Live stories and two reels from the floor.');
    await page.fill('#mp-sample-1', 'my best reel');
    await page.click('#mp-go');
    check('a sample that is not a link: named under it', await until(async () => /Link 1 does not look like a web address/.test(await page.locator('#mp-sample-1').locator('xpath=..').locator('.mp-err').innerText())) &&
      await page.evaluate(() => document.activeElement && document.activeElement.id === 'mp-sample-1'));
    await page.fill('#mp-sample-1', 'www.instagram.com/reel/abc');
    await page.click('#mp-go');
    check('not agreed: named under the box', await until(async () => /Please tick the box to agree\./.test(await page.locator('.mp-agree .mp-err').innerText())));
    check('...the agree box is a big target', await page.evaluate(() => document.querySelector('label[for="mp-agree"]').getBoundingClientRect().height >= 48));
    await page.click('label[for="mp-agree"]');
    check('still nothing sent while a box was wrong', (await db()).requests.length === 1);
    await page.click('#mp-go');
    check('sent: the thank-you replaces the form and says the 2 working days', await until(async () => await page.locator('#mp-done').isVisible() && !(await page.locator('#mp-form').isVisible())) && /reply by email within 2 working days/.test(await page.locator('#mp-done').innerText()));
    let d = await db();
    const asha = d.requests.find((x) => x.email === 'asha@creator.in');
    const meta = asha && JSON.parse(asha.metadata);
    check('stored with what she typed: the two platforms, 45,000 and 1,20,000, the sample made a link', meta && meta.kind === 'influencer' && meta.platforms.length === 2 && meta.platforms[0].followers === 45000 && meta.platforms[1].followers === 120000 && meta.samples[0] === 'https://www.instagram.com/reel/abc' && meta.formats.join() === 'reels,live', meta);
    check('360 wide after sending: nothing sideways', (await sideways()) <= 1);

    // The server's own refusal, under its box.
    const p2 = await phone.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(BASE + '/media-pass?as=media', { waitUntil: 'load' });
    check('?as=media opens on the media questions', await p2.locator('#mp-media').isVisible() && !(await p2.locator('#mp-influencer').isVisible()));
    for (const [id, v] of [['mp-name', 'Ravi Kumar'], ['mp-email', 'ravi@gmail.con'], ['mp-mobile', '9820011111'], ['mp-organisation', 'Mumbai News'], ['mp-designation', 'Reporter'], ['mp-city', 'Mumbai'], ['mp-outlet', 'Mumbai News Online'], ['mp-beat', 'Technology'], ['mp-work-1', 'https://mumbainews.in/ai'], ['mp-coverage', 'A story on AI in factories.']]) await p2.fill('#' + id, v);
    await p2.click('label[for="mp-agree"]');
    await p2.click('#mp-go');
    check('a mistyped email host: the server says so under the email box, with the right address', await until(async () => /Did you mean ravi@gmail\.com\?/.test(await p2.locator('#mp-email').locator('xpath=..').locator('.mp-err').innerText())) &&
      await p2.evaluate(() => document.activeElement && document.activeElement.id === 'mp-email'));
    await p2.fill('#mp-email', 'ravi@gmail.com');
    await p2.click('#mp-go');
    check('corrected, it goes', await until(async () => p2.locator('#mp-done').isVisible()));
    await p2.close();
    const sent = await mails();
    check('the team was emailed for each request', sent.filter((m) => (m.Recipients.To || []).includes('team@bharataiinnovation.com')).length === 2);
    await phone.close();

    // ---------------------------------------------------------------- a laptop: Admin
    const laptop = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    await laptop.addInitScript(signIn);
    const ad = await laptop.newPage();
    ad.on('pageerror', (e) => errors.push(e.message));
    ad.on('dialog', (dl) => dl.accept());
    await ad.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    check('the sidebar says how many are waiting', await until(async () => (await ad.locator('#media-new-badge').innerText()).trim() === '3'), await ad.locator('#media-new-badge').innerText().catch(() => 'no badge'));
    await ad.click('[data-section="media"]');
    check('the screen loads its own script and style, one card per request', await until(async () => (await ad.locator('.mdd .md-card').count()) === 3, 30000), await ad.locator('.mdd .md-card').count());
    check('the title says where you are', (await ad.locator('#page-title').innerText()) === 'Media & Influencer Pass');
    check('the stylesheet is applied (a card has its border)', await ad.locator('.md-card').first().evaluate((el) => getComputedStyle(el).borderTopStyle === 'solid' && getComputedStyle(el).borderRadius === '14px'));
    const card = ad.locator('.md-card[data-row="' + asha.id + '"]');
    check('newest first: Ravi, then Asha, then the contact-page request', /Ravi Kumar/.test(await ad.locator('.md-card').first().innerText()) && /Old Press/.test(await ad.locator('.md-card').last().innerText()));
    check('her card: Influencer, her reach, each platform with its followers', /INFLUENCER/i.test(await card.locator('.md-kind').innerText()) && /1,65,000 followers/.test(await card.locator('.md-reach').innerText()) &&
      /Instagram\s+@asha\.ai\s+45,000/.test(await card.locator('.md-plat').innerText()) && /In all\s+1,65,000/.test(await card.locator('.md-plat').innerText()), await card.innerText());
    check('her handles and samples are links that open in a new tab without the opener', (await card.locator('.md-plat a').first().getAttribute('href')) === 'https://www.instagram.com/asha.ai/' &&
      (await card.locator('.md-links a').first().getAttribute('href')) === 'https://www.instagram.com/reel/abc' && (await card.locator('.md-links a').first().getAttribute('rel')) === 'noopener noreferrer' && (await card.locator('.md-links a').first().getAttribute('target')) === '_blank');
    check('her plan and what she will make', /Live stories and two reels/.test(await card.innerText()) && /Reels or Shorts/.test(await card.innerText()));
    check('not registered yet, so approving registers her', /Not registered yet/.test(await card.locator('.md-pass').innerText()));
    check('the contact-page request shows its words and lets you choose the pass', /I cover tech for Daily Times/.test(await ad.locator('.md-card').last().innerText()) && (await ad.locator('.md-card').last().locator('select[data-pick]').inputValue()) === 'media');

    await card.locator('textarea[data-note]').fill('See you at the media desk.');
    await card.locator('[data-act="approve"]').click();
    check('Approve and issue pass: the card says what was done and by whom', await until(async () => /Approved by Priya.*Influencer Pass issued, the pass link emailed/.test(await card.locator('.md-done').innerText())), await card.innerText());
    d = await db();
    const a = d.attendees.find((x) => x.email === 'asha@creator.in');
    check('...she holds an Influencer Pass now, role Influencer, lunch', a && a.badge_type === 'Influencer Pass' && a.role === 'Influencer' && a.lunch_inclusion === 'Yes', a);
    const okMail = (await mails()).find((m) => m.Content.Subject === 'Your Influencer Pass is approved - Bharat AI Innovation 2026');
    check('...her email went, with the note and the pass button', !!okMail && /See you at the media desk\./.test(okMail.Content.Body[0].Content) && /action=download-pass/.test(okMail.Content.Body[0].Content));
    check('...one fewer waiting, in the sidebar too', await until(async () => (await ad.locator('#media-new-badge').innerText()).trim() === '2'));
    check('...still on screen with the resend button', await card.locator('[data-act="resend"]').isVisible());

    const old = ad.locator('.md-card').last();
    await old.locator('input[data-mail]').uncheck();
    await old.locator('[data-act="decline"]').click();
    check('the contact-page request declined with Email them unticked', await until(async () => (await old.getAttribute('data-state')) === 'declined'));
    check('...no email to them', !(await mails()).some((m) => (m.Recipients.To || []).includes('press@daily.in')));
    check('...a declined request can still be approved from its card', await old.locator('[data-act="approve"]').isVisible() && !(await old.locator('[data-act="decline"]').count()));
    await ad.click('.md-tab[data-tab="new"]');
    check('Waiting now shows only Ravi', (await ad.locator('.md-card').count()) === 1 && /Ravi Kumar/.test(await ad.locator('.md-card').innerText()));
    check('the tabs carry their counts', (await ad.locator('.md-tab').allInnerTexts()).join('|').replace(/\s+/g, '') === 'Waiting1|Approved1|Declined1|All3', await ad.locator('.md-tab').allInnerTexts());
    await ad.selectOption('select[data-kindfilter]', 'influencer');
    await ad.click('.md-tab[data-tab="all"]');
    check('the kind filter shows only influencers', (await ad.locator('.md-card').count()) === 1 && /Asha Rao/.test(await ad.locator('.md-card').innerText()));
    await ad.selectOption('select[data-kindfilter]', '');

    // The screen on a phone.
    await ad.setViewportSize({ width: 390, height: 844 });
    await sleep(300);
    check('Admin on a phone: the screen does not push the page sideways', await ad.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), await ad.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
    check('...the answers stack in one column', await ad.locator('.md-q').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length === 1));
    await laptop.close();
  } finally {
    await browser.close();
  }
  check('no page errors anywhere', errors.length === 0, errors);
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed: ' + (e && e.stack || e)); process.exit(1); });
