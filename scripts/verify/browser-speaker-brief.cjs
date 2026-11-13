// Speaker briefs (12 Nov 2026) in a real browser (Edge), on the real built worker and
// real SQLite (conference-harness.mjs, 0054 applied). On a laptop, as the organisers:
// Admin -> Conference -> "Speaker briefs" lists the speakers with their status; the
// note is saved for every brief; a preview shows the panel; a note typed for one
// email changes the preview; "Copy for WhatsApp" copies text with no link; ticked
// speakers are sent in turn and turn "Sent"; a slot moved afterwards shows "Changed"
// and its brief is an update; "Brief" on a speaker card opens the same sheet; Escape
// closes. 13 Nov 2026: the subject, greeting, opening and note are edited before sending. On a phone: the list and the preview fit the screen. No page errors.
// Needs conference-harness.mjs (HARNESS_PORT, default 8857). Started by run-all.mjs.
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8857);
const SHOTS = process.env.SHOTS || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(150); } return false; };
const dbq = async (q) => (await fetch(BASE + '/__db?q=' + encodeURIComponent(q))).json();
const sentCount = async () => (await (await fetch(BASE + '/__sent')).json()).length;
const adminInit = () => { if (window.top !== window) return; sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); };

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1/sessions')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    // ================= the organisers, on a laptop =================
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await ctx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await ctx.addInitScript(adminInit);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => { if (!/sandboxed/.test(String(e))) errors.push(String(e)); });
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.goto(BASE + '/admin#sessions', { waitUntil: 'domcontentloaded' });
    check('Admin opens on Conference', await until(() => page.locator('.cm-stats').isVisible(), 20000));
    const btn = page.locator('[data-cm="brief-list"]');
    check('the Conference bar has "Speaker briefs"', await until(() => btn.isVisible(), 10000));
    await btn.click();
    check('the list opens', await until(() => page.locator('#sb-list .sb-item').first().isVisible()));
    const rows = await page.locator('#sb-list .sb-item').count();
    const chips = (await page.locator('#sb-list .sb-chip').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
    check('it opens on "To send", with counts on every filter', chips[0].startsWith('To send') && /\d/.test(chips[0]) && chips.some(c => c.startsWith('No email')) && rows >= 1, chips);
    const shailesh = page.locator('#sb-list .sb-item', { hasText: 'Shailesh Dhuri' });
    check('a ready speaker shows their slot by both hall names and "Not sent yet"', (await shailesh.textContent()).includes('Homi J. Bhabha Hall · Peacock Hall') && (await shailesh.textContent()).includes('Not sent yet') && (await shailesh.textContent()).includes('Moderator'), await shailesh.textContent());
    check('focus starts in the list (the note box)', await page.evaluate(() => document.activeElement && document.activeElement.id === 'sb-note'));

    // ---- the note for every brief ----
    await page.fill('#sb-note', 'Please reach the hall 30 minutes before your session.');
    check('typing marks it "Not saved yet"', (await page.locator('#sb-note-state').textContent()).includes('Not saved'));
    await page.click('[data-sb="save-note"]');
    check('saved: the screen says so and the database has it', await until(async () => (await page.locator('#sb-note-state').textContent()).trim() === 'Saved.') &&
      (await dbq("SELECT value FROM app_settings WHERE key = 'speaker_brief_note'"))[0]?.value === 'Please reach the hall 30 minutes before your session.');

    // ---- one speaker's preview ----
    await shailesh.locator('[data-sb="open"]').click();
    check('the preview sheet opens over the list', await until(() => page.locator('#sb-one .sb-preview').isVisible()));
    const frame = page.frameLocator('#sb-one-preview');
    check('the preview is the real email: panel, both hall names, the saved note', await until(async () => {
      const t = await frame.locator('body').textContent();
      return t.includes('Tarun Chugh (Bajaj Life Insurance)') && t.includes('Ratan Kumar Kesh (Bandhan Bank)') && t.includes('Homi J. Bhabha Hall · Peacock Hall') && t.includes('Please reach the hall 30 minutes');
    }));
    check('the subject is in a box you can change', (await page.inputValue('#sb-one-subj')).startsWith('Your session at Bharat AI Innovation 2026: Friday 20 November'));
    check('so are the greeting and the opening words', (await page.inputValue('#sb-one-greet')) === 'Dear Shailesh,' && (await page.inputValue('#sb-one-open')).startsWith('Thank you for speaking'));
    check('"Put back the usual words" is hidden until something changes', await page.locator('#sb-one-reset').isHidden());
    check('it says who it goes to and about their pass', (await page.locator('#sb-one .sb-meta').textContent()).includes('shailesh@example.test') && (await page.locator('#sb-one .sb-meta').textContent()).includes('Speaker pass'));
    await page.fill('#sb-one-note', 'Your mic check is at 1:30 pm.');
    check('a note typed for this email shows in the preview', await until(async () => (await frame.locator('body').textContent()).includes('Your mic check is at 1:30 pm.')));
    await page.fill('#sb-one-greet', 'Dear Mr. Dhuri,');
    await page.fill('#sb-one-open', 'Thank you for moderating the Insurance panel.');
    check('changed greeting and opening show in the preview', await until(async () => { const t = await frame.locator('body').textContent(); return t.includes('Dear Mr. Dhuri,') && t.includes('Thank you for moderating the Insurance panel.') && !t.includes('Dear Shailesh,'); }));
    check('the panel and hall are still filled in under the new words', (await frame.locator('body').textContent()).includes('Tarun Chugh (Bajaj Life Insurance)'));
    check('"Put back the usual words" appears', await page.locator('#sb-one-reset').isVisible());
    await page.click('#sb-one-reset');
    check('it puts the usual words back, in the boxes and the preview', (await page.inputValue('#sb-one-greet')) === 'Dear Shailesh,' && await until(async () => (await frame.locator('body').textContent()).includes('Dear Shailesh,')) && await page.locator('#sb-one-reset').isHidden());
    await page.fill('#sb-one-note', 'Your mic check is at 1:30 pm.');
    check('nothing was sent by previewing', (await sentCount()) === 0);
    await page.locator('#sb-one [data-sb="copy"]').click();
    const copied = await until(async () => /On the panel/.test(await page.evaluate(() => navigator.clipboard.readText())));
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check('"Copy for WhatsApp" copies the details with the typed note and no link', copied && clip.includes('Your mic check is at 1:30 pm.') && !/https?:/.test(clip), clip);
    dialogs.length = 0;
    await page.keyboard.press('Escape');
    check('closing with changed words asks first', dialogs.some(m => m.includes('Your changes to its words will be lost')), dialogs);
    check('Escape closes the preview and leaves the list open', await until(async () => !(await page.locator('#sb-one').isVisible()) && (await page.locator('#sb-list').isVisible())));

    // ---- send to the ticked ones ----
    await page.click('[data-sb="select-todo"]');
    const ticked = await page.locator('#sb-list .sb-check:checked').count();
    const sendLabel = (await page.locator('#sb-send-many').textContent()).trim();
    check('"Tick all to send" ticks every ready speaker and the button counts them', ticked >= 2 && sendLabel === 'Send ' + ticked + ' briefs', [ticked, sendLabel]);
    dialogs.length = 0;
    await page.click('#sb-send-many');
    check('it asks first, naming how many', dialogs.some(m => m.includes('Send the speaker brief to ' + ticked + ' speakers now?')), dialogs);
    check('all of them go, one each', await until(async () => (await sentCount()) === ticked, 20000), await sentCount());
    check('the list then says "Sent N of N"', await until(async () => (await page.locator('#sb-progress').textContent()).includes('Sent ' + ticked + ' of ' + ticked + '.'), 10000), await page.locator('#sb-progress').textContent());
    await page.click('[data-sb="filter"][data-f="sent"]');
    check('they are under "Sent" with the time', await until(async () => (await page.locator('#sb-list .sb-item').count()) === ticked) &&
      (await page.locator('#sb-list .sb-status.is-sent').first().textContent()).startsWith('Sent '));
    check('each send is logged', (await dbq("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'speaker.brief'"))[0].n === ticked);

    // ---- the slot moves; the list notices ----
    await page.keyboard.press('Escape');
    await dbq("UPDATE sessions SET start_time = '2026-11-20 14:30', end_time = '2026-11-20 15:30' WHERE session_type = 'panel'");
    await btn.click();
    check('reopened: the moved panel’s moderator is "Changed since sent"', await until(async () => (await page.locator('#sb-list .sb-item', { hasText: 'Shailesh Dhuri' }).textContent()).includes('Changed since sent')));
    await page.locator('#sb-list .sb-item', { hasText: 'Shailesh Dhuri' }).locator('[data-sb="open"]').click();
    check('their brief is now an update ("Send update", subject "Updated:")', await until(async () => (await page.locator('#sb-one-send').textContent()).includes('Send update') && (await page.inputValue('#sb-one-subj')).startsWith('Updated:')));
    await page.fill('#sb-one-open', 'Sorry: your panel has moved by 15 minutes.');
    const before = await sentCount();
    await page.click('#sb-one-send');
    check('the update goes', await until(async () => (await sentCount()) === before + 1));
    const last = JSON.stringify((await (await fetch(BASE + '/__sent')).json()).slice(-1));
    check('with the opening words typed for it, the usual "Updated:" subject and the new time', last.includes('Sorry: your panel has moved by 15 minutes.') && /Updated: Your session/.test(last) && last.includes('2:30 pm'), last.slice(0, 300));
    await page.keyboard.press('Escape');
    check('Escape closes the list too', await until(async () => !(await page.locator('#sb-root.is-open').count())));

    // ---- from a speaker's card ----
    await page.click('[data-cm="tab"][data-k="speakers"]');
    const cardBrief = page.locator('[data-cm="brief"][data-id="3"]');
    check('each speaker card has "Brief"', await until(() => cardBrief.isVisible()));
    await cardBrief.click();
    check('"Brief" opens the same preview, now "Sent"', await until(async () => (await page.locator('#sb-one .sb-meta').textContent()).includes('Sent')));
    await page.keyboard.press('Escape');
    check('no page errors on the laptop', errors.length === 0, errors);
    await ctx.close();

    // ================= on a phone =================
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await pctx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await pctx.addInitScript(adminInit);
    const ph = await pctx.newPage();
    const perr = [];
    ph.on('pageerror', e => { if (!/sandboxed/.test(String(e))) perr.push(String(e)); });
    ph.on('dialog', d => d.accept());
    await ph.goto(BASE + '/admin#sessions', { waitUntil: 'domcontentloaded' });
    await until(() => ph.locator('.cm-stats').isVisible(), 20000);
    await ph.evaluate(() => window.SpeakerBrief.openList());
    check('phone: the list opens', await until(() => ph.locator('#sb-list .sb-item').first().isVisible()));
    await ph.click('[data-sb="filter"][data-f="all"]');
    const fit = await ph.evaluate(() => { const d = document.getElementById('sb-list'); return { panel: d.scrollWidth - d.clientWidth, w: d.getBoundingClientRect().width, vw: innerWidth }; });
    check('phone: the list fits the screen, nothing sideways', fit.panel <= 0 && fit.w <= fit.vw, fit);
    if (SHOTS) await ph.screenshot({ path: SHOTS + '/brief-390-list.png' });
    await ph.locator('#sb-list .sb-item', { hasText: 'Shailesh Dhuri' }).locator('[data-sb="open"]').click();
    check('phone: the preview opens and fits', await until(() => ph.locator('#sb-one .sb-preview').isVisible()) &&
      await ph.evaluate(() => { const d = document.getElementById('sb-one'); return d.scrollWidth <= d.clientWidth && document.getElementById('sb-one-preview').getBoundingClientRect().width <= innerWidth; }));
    const sendBox = await ph.locator('#sb-one-send').boundingBox();
    check('phone: the send button is a comfortable size to tap', sendBox && sendBox.height >= 40, sendBox);
    if (SHOTS) { await ph.waitForTimeout(400); await ph.screenshot({ path: SHOTS + '/brief-390-preview.png' }); }
    check('no page errors on the phone', perr.length === 0, perr);
    await pctx.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
