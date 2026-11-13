// END TO END: free passes full, on a phone, in a real browser (12 Nov 2026), on the built
// worker on real SQLite (login-harness.mjs, email played). Migration 0056 is applied
// through the harness and the switch thrown, then: /register says waiting list in the
// organiser's words with the button in its own words; a real registration lands on the
// waiting-list screen (the heading, the chip, the words, the Delegate band) with no page
// wider than the phone; the email that left is the waiting-list one; the app opened
// signed in says the pass is on the waiting list, hides Download and offers the
// Delegate Pass; the button opens the upgrade steps.
// Run by run-all.mjs (harness login-harness.mjs on :8846).
const { chromium } = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8846);
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const WAITLIST_TEXT = 'Free Visitor Passes are full for now. You are on the waiting list. If the wait list gets over, we will inform you.';
const WAITLIST_UPSELL = 'Want to be sure of entry on both days? Get a Delegate Pass.';

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const ctx = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
  await ctx.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
  const page = await ctx.newPage();
  // A statement the harness refuses (a column already there from an earlier run) is not a failure here.
  const sql = async (s, args = []) => { const r = await page.request.post(BASE + '/__sql', { data: { sql: s, args } }); const txt = await r.text(); try { return JSON.parse(txt); } catch { return { error: txt }; } };

  // 0056, one statement at a time, and the switch.
  for (const s of [
    'ALTER TABLE attendees ADD COLUMN entry_status TEXT DEFAULT NULL',
    'ALTER TABLE attendees ADD COLUMN entry_slot TEXT DEFAULT NULL',
    'ALTER TABLE attendees ADD COLUMN entry_decided_at DATETIME DEFAULT NULL',
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('free_pass_waitlist', '1')",
  ]) await sql(s);
  const cfg = await (await page.request.get(BASE + '/api/payments/config')).json();
  check('the switch is on in the harness', cfg.free_pass_waitlist === true, JSON.stringify(cfg).slice(0, 120));

  // /register on a phone.
  await page.goto(BASE + '/register', { waitUntil: 'load' });
  // 13 Nov 2026: one form for everyone. It says nothing of free or waiting; the person is
  // saved, offered the passes, and reads the waiting-list words only after "Not now".
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const card = (await page.locator('.rg-card').innerText()).replace(/\s+/g, ' ');
  check('/register: the form asks who they are and says nothing of free or waiting', (await page.locator('.rg-kind-row label').count()) === 6 && !/free|waiting list/i.test(card), card.slice(0, 300));
  check('/register: the button moves them on', (await page.locator('#rf-submit').innerText()).trim().startsWith('Continue'));
  check('/register: the foot says free passes are full', text.includes('Free Visitor Passes are full. Not ready to pay?'));
  check('/register: nothing wider than the phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // A real registration.
  await page.tap('.rg-kind-row input[value="corporate"] + span');
  await page.fill('#rf-name', 'Asha Rao');
  await page.fill('#rf-email', 'asha.rao@gmail.com');
  await page.fill('#rf-phone', '+91 98200 15151');
  await page.fill('#rf-company', 'Rao Labs');
  await page.fill('#rf-title', 'Founder');
  await page.fill('#rf-city', 'Pune');
  await page.selectOption('#rf-industry', 'Software & SaaS');
  await page.click('#rf-submit');
  await page.waitForSelector('#reg-choose:not(.hidden)', { timeout: 20000 });
  const offered = await page.evaluate(() => ({ passes: [...document.querySelectorAll('#rc-tiers > li')].filter((l) => !l.hidden).map((l) => l.getAttribute('data-pass')).join(), later: document.getElementById('rc-later').textContent, success: !document.getElementById('reg-success').classList.contains('hidden') }));
  check('saved, then the passes: Delegate first, and the last choice is the waiting list', offered.passes === 'Delegate Pass,Premium Delegate Pass,VIP Pass' && offered.later === 'Not now. Keep me on the waiting list' && !offered.success, JSON.stringify(offered));
  await page.tap('#rc-later');
  await page.waitForSelector('#reg-success:not(.hidden)', { timeout: 20000 });
  const name = (await page.locator('#rs-name').innerText()).trim();
  const chip = (await page.locator('#rs-chip-pass').innerText()).trim();
  const sent = (await page.locator('#rs-sent').innerText()).trim();
  const up = (await page.locator('#rs-up-title').innerText()).trim();
  check('success: the heading', name === 'You are on the waiting list, Asha Rao', name);
  check('success: the chip', chip === 'Free Visitor Pass: waiting list', chip);
  check('success: the words and the address', sent.startsWith(WAITLIST_TEXT) && sent.includes('asha.rao@gmail.com'), sent);
  check('success: the Delegate band in the organiser words', up === WAITLIST_UPSELL, up);
  const delegateBtn = page.locator('#reg-success .rs-tier-main .rs-btn');
  check('success: a Delegate button on the screen', await delegateBtn.count() === 1 && await delegateBtn.first().isVisible());
  check('success: nothing wider than the phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  // 13 Nov 2026: on the list, the first thing to do is the profile (photo, LinkedIn, details).
  const hero = await page.evaluate(() => { const h = document.querySelector('#reg-success .rs-hero'); const k = document.querySelector('#reg-success .rs-kicker'); return h ? { href: h.getAttribute('href'), title: (h.querySelector('.rs-hero-title') || {}).textContent, btn: (h.querySelector('.rs-hero-btn') || {}).textContent, kicker: k && k.textContent } : null; });
  check('success: the profile comes first, to the complete-profile link', !!hero && hero.href === '/app?action=complete-profile' && /Finish your profile: add your photo and your LinkedIn/.test(hero.title) && /Finish my profile/.test(hero.btn) && hero.kicker === 'While you wait', JSON.stringify(hero));
  if (process.env.SHOT_DIR) await page.locator('#reg-success').screenshot({ path: process.env.SHOT_DIR + '/waitlist-success.png' }).catch(() => {});
  const row = await sql("SELECT entry_status FROM attendees WHERE email = 'asha.rao@gmail.com'");
  check('the row is on the list', Array.isArray(row) && row[0] && row[0].entry_status === 'waitlisted', JSON.stringify(row));
  const mail = await (await page.request.get(BASE + '/__mail')).json();
  const mine = mail.filter(m => (m.Recipients?.To || []).includes('asha.rao@gmail.com'));
  check('the email that left is the waiting-list one', mine.length === 1 && /waiting list/.test(mine[0].Content.Subject), mine.map(m => m.Content.Subject).join(' | '));

  // The app, signed in by the registration.
  await page.goto(BASE + '/app', { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const el = document.getElementById('pcc-pass-state');
    return el && /waiting list/.test(el.textContent || '');
  }, null, { timeout: 30000 }).catch(() => {});
  const state = await page.evaluate(() => (document.getElementById('pcc-pass-state') || {}).textContent || '');
  const note = await page.evaluate(() => (document.getElementById('pcc-pass-note') || {}).textContent || '');
  check('app: the pass card says waiting list', /is on the waiting list/.test(state), state);
  check('app: the card carries the organiser words', note.includes(WAITLIST_TEXT) && note.includes(WAITLIST_UPSELL), note);
  check('app: no Download button', await page.evaluate(() => { const b = document.getElementById('pcc-download-btn'); return !!b && b.classList.contains('hidden'); }));
  check('app: the card asks for the profile and says why', note.includes('finish your profile with your photo and LinkedIn') && note.includes('We confirm places only for finished profiles.'), note);
  const missing = await page.evaluate(() => { if (typeof updateProfileCompletionCard === 'function') updateProfileCompletionCard(); return (document.getElementById('pc-missing') || {}).textContent || ''; });
  check('app: the profile card names the photo and LinkedIn', /photo/.test(missing) && /LinkedIn/.test(missing), missing);
  const gBtn = page.locator('#pcc-guarantee-btn');
  check('app: the way to be sure of entry is on the card', await gBtn.count() === 1 && await gBtn.isVisible());
  await gBtn.click().catch(() => {});
  await page.waitForTimeout(600);
  check('app: it opens the Delegate steps', await page.evaluate(() => { const m = document.getElementById('visitor-upgrade-modal'); return !!m && !m.classList.contains('hidden'); }));

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('crashed: ' + (e && e.stack || e)); process.exit(1); });
