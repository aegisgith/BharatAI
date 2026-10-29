// Playwright on an emulated Android phone, with a dummy attendee (the harness's
// Riya Shah), for the way in and the steps that are counted (29 Oct 2026):
//   - the startup check: the page code never arrives (one automatic refresh, then
//     the steps on screen, reported), it arrives after the refresh (reported as
//     recovered), it is slow (said and reported, nothing reloaded), and an ordinary
//     load (nothing reported at all)
//   - a sign-in link that no longer works opens the sign-in box on the address
//   - a link opened in a browser signed in as somebody else signs in its owner
//   - the badge and the pass: started, photo asked, refused, closed, QR not ready
// Needs phone-harness.mjs (HARNESS_PORT, default 8778 here). Every call this
// checks is answered inside the browser, so the harness needs nothing new.
const { chromium } = require('./playwright.cjs');
const path = require('path');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8778);
const PHOTO = path.join(__dirname, '..', '..', 'public', 'images', 'speaker-virendra-pal.webp');
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const TOKEN = 'ab'.repeat(32);
const BLAME = /\b(error|errors|problem|problems|issue|issues|fail|failed|failure|bug|bugs|broken|sorry|wrong|crash\w*)\b/i;
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function phone(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA, serviceWorkers: opts.sw ? 'allow' : 'block' });
  if (opts.user) await ctx.addInitScript((u) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('agba_user', JSON.stringify(u)); sessionStorage.setItem('seeded', '1'); } }, opts.user);
  await ctx.addInitScript(() => { try { localStorage.setItem('agba_social_card_offered', '1'); localStorage.setItem('bhai_upsell_5', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  const seen = { boot: [], steps: [], login: [], errors: [] };
  page.on('pageerror', e => seen.errors.push(e.message));
  await ctx.route(/\/api\/app-boot$/, async (route) => { seen.boot.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ json: { ok: true } }); });
  await ctx.route(/\/api\/attendees\/\d+\/track-step$/, async (route) => { seen.steps.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ json: { ok: true } }); });
  return { ctx, page, seen };
}
const loadingShown = (page) => page.evaluate(() => { const e = document.getElementById('loading-screen'); return !!e && getComputedStyle(e).display !== 'none'; });
// A read that lands while the startup check is reopening the page throws
// ("Execution context was destroyed"); that is "not yet", not a failure.
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (e) {} await sleep(250); } return false; };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  // The harness's user, so a stand-in sign-in answers with the same person.
  const probe = await browser.newPage();
  await probe.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
  const riya = await probe.evaluate(() => fetch('/api/attendees/5').then(r => r.json()));
  await probe.close();
  const LINK = '/app?email=' + encodeURIComponent(riya.email) + '&action=social-card&token=' + TOKEN;

  // ---- 1. The page code never arrives ----
  {
    console.log('-- '+"1. The page code never arrives");
    const { ctx, page, seen } = await phone(browser, { sw: true });
    let block = true;
    await ctx.route(/\/app\.js\?/, (route) => (block ? route.abort() : route.continue()));
    await page.goto(BASE + LINK, { waitUntil: 'domcontentloaded' });
    const shown = await until(() => page.evaluate(() => !!document.getElementById('boot-retry')), 40000);
    const fails1 = seen.boot.filter(b => b.stage === 'fail');
    check('never arrives: one automatic refresh, then the steps on screen', shown && fails1.length >= 2 && fails1[0].retried === false && fails1[fails1.length - 1].retried === true, JSON.stringify(seen.boot.map(b => b.stage + ':' + b.retried)));
    check('never arrives: the report says which file, for which link and person', fails1[0] && fails1[0].errs.some(e => e.kind === 'load' && e.src.includes('/app.js')) && fails1[0].email === riya.email && fails1[0].token === TOKEN && fails1[0].action === 'social-card', JSON.stringify(fails1[0]));
    const panel = await page.evaluate(() => { const e = document.getElementById('loading-screen'); return { text: e.innerText, items: e.querySelectorAll('li').length, wide: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
    check('never arrives: the steps are bullet points that fit a phone', panel.items === 4 && /Open in Chrome/.test(panel.text) && /incognito/.test(panel.text) && !panel.wide, JSON.stringify(panel).slice(0, 200));
    check('never arrives: not a word about anything going wrong on our side', !BLAME.test(panel.text), (panel.text.match(BLAME) || [''])[0]);
    block = false;
    await page.click('#boot-retry');
    const opened = await until(async () => !(await loadingShown(page)), 15000);
    const okSeen = await until(async () => seen.boot.some(b => b.stage === 'ok'), 8000);
    check('never arrives: "Try again" once the code can arrive opens the app, reported as recovered', opened && okSeen, JSON.stringify({ opened, stages: seen.boot.map(b => b.stage) }));
    check('never arrives: no script error on the way', !seen.errors.length, seen.errors.join(' | '));
    await ctx.close();
  }

  // ---- 2. It arrives after the automatic refresh ----
  {
    console.log('-- '+"2. It arrives after the automatic refresh");
    const { ctx, page, seen } = await phone(browser);
    let first = true;
    await ctx.route(/\/app\.js\?/, (route) => { if (first) { first = false; return route.abort(); } return route.continue(); });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    const opened = await until(async () => { try { return !(await loadingShown(page)); } catch (e) { return false; } }, 20000);
    await sleep(800);
    const stages = seen.boot.map(b => b.stage).join(',');
    check('arrives after the refresh: the app opens by itself, reported fail then ok', opened && stages === 'fail,ok' && !(await page.evaluate(() => !!document.getElementById('boot-retry'))), stages);
    await ctx.close();
  }

  // ---- 3. An ordinary load ----
  {
    console.log('-- '+"3. An ordinary load");
    const { ctx, page, seen } = await phone(browser, { sw: true });
    await page.goto(BASE + '/app', { waitUntil: 'load' });
    await sleep(2500);
    check('ordinary load: nothing reported, the app is open', !seen.boot.length && !(await loadingShown(page)) && !seen.errors.length, JSON.stringify(seen.boot) + seen.errors.join('|'));
    await ctx.close();
  }

  // ---- 4. Slow ----
  {
    console.log('-- '+"4. Slow");
    const { ctx, page, seen } = await phone(browser);
    await ctx.route(/\/app\.js\?/, async (route) => { await sleep(19000); await route.continue(); });
    await page.goto(BASE + '/app', { waitUntil: 'commit' });
    // On a busy machine the 15 s timer can fire close to the code's arrival, so
    // the note is looked for once the app is open: it stays in the (now hidden)
    // loading screen, and the reports say in which order things happened.
    // Open means the loading screen exists and is hidden: right after 'commit' it
    // does not exist yet, which is not the app being open.
    const opened = await until(() => page.evaluate(() => { const e = document.getElementById('loading-screen'); return !!e && getComputedStyle(e).display === 'none'; }), 40000);
    await until(async () => seen.boot.some(b => b.stage === 'ok'), 8000);
    const note = await page.evaluate(() => !!document.getElementById('boot-slow')).catch(() => false);
    const stages = seen.boot.map(b => b.stage).join(',');
    check('slow: said on screen and reported, nothing reloaded, then reported as recovered', note && opened && stages === 'slow,ok', stages + ' note=' + note + ' opened=' + opened);
    await ctx.close();
  }

  // ---- 5. A sign-in link that no longer works ----
  {
    console.log('-- '+"5. A sign-in link that no longer works");
    const { ctx, page, seen } = await phone(browser);
    await ctx.route(/\/api\/events\/1\/attendees\/login$/, async (route) => { seen.login.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ status: 401, json: { error: 'That link or code has expired. Please request a new one.' } }); });
    await page.goto(BASE + LINK, { waitUntil: 'load' });
    await sleep(1500);
    const st = await page.evaluate(() => ({
      modal: !document.getElementById('registration-modal').classList.contains('hidden'),
      email: document.getElementById('signin-email').value,
      note: document.getElementById('signin-note').classList.contains('hidden') ? '' : document.getElementById('signin-note').textContent,
      action: typeof pendingAction === 'undefined' ? null : pendingAction,
      url: location.search,
    }));
    check('dead link: the sign-in box opens on their address and says what to do', st.modal && st.email === riya.email && /expired/.test(st.note) && /fresh code/.test(st.note), JSON.stringify(st));
    check('dead link: the badge still waits for them, and the address bar is clean', st.action === 'social-card' && st.url === '' && seen.login.length === 1, JSON.stringify(st));
    await ctx.close();
  }

  // ---- 6. A link opened in a browser signed in as somebody else ----
  {
    console.log('-- '+"6. A link opened in a browser signed in as somebody else");
    const other = { ...riya, id: 99, name: 'Someone Else', email: 'someone-else@example.com' };
    const { ctx, page, seen } = await phone(browser, { user: other });
    await ctx.route(/\/api\/events\/1\/attendees\/login$/, async (route) => { seen.login.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ json: riya }); });
    await page.goto(BASE + LINK.replace('action=social-card', 'action=goals'), { waitUntil: 'load' });
    await sleep(1500);
    const who = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('agba_user')).email; } catch (e) { return ''; } });
    check('somebody else signed in: the link signs in its owner', seen.login.length === 1 && seen.login[0].email === riya.email && seen.login[0].token === TOKEN && who === riya.email, JSON.stringify({ login: seen.login, who }));
    await ctx.close();
  }

  // ---- 7. The badge and the pass, counted ----
  {
    console.log('-- '+"7. The badge and the pass, counted");
    const { ctx, page, seen } = await phone(browser, { user: riya });
    let refuse = true;
    await ctx.route(/\/api\/attendees\/5\/avatar$/, (route) => route.fulfill({ json: refuse ? { success: false, error: 'There is no face in this photo' } : { success: true, avatar_url: '/api/uploads/avatars/5.webp' } }));
    await page.goto(BASE + '/app?action=social-card', { waitUntil: 'load' });
    const asked = await until(() => page.evaluate(() => !!document.getElementById('pass-photo-close')), 8000);
    await page.setInputFiles('#pass-photo-input', PHOTO);
    await until(() => page.evaluate(() => /no face/.test((document.getElementById('pass-photo-status') || {}).textContent || '')), 8000);
    await page.click('#pass-photo-close');
    await sleep(600);
    const card = seen.steps.filter(s => s.kind === 'card').map(s => s.step + (s.reason ? ':' + s.reason : '')).join(', ');
    check('badge: started, photo asked, refused with the reason, box closed', asked && card === 'open, photo_asked, photo_fail:There is no face in this photo, photo_cancel', card);

    await page.evaluate(() => { generateDelegatePass(); });
    await until(() => page.evaluate(() => !!document.getElementById('pass-photo-close')), 8000);
    await page.click('#pass-photo-close');
    await sleep(600);
    // With a photo on the server and no pass token to be had.
    await ctx.route(/\/api\/attendees\/5$/, (route) => route.request().method() === 'GET' ? route.fulfill({ json: { ...riya, avatar_url: '/api/uploads/avatars/5.webp' } }) : route.continue());
    await ctx.route(/\/api\/my-pass-token/, (route) => route.fulfill({ json: {} }));
    await page.evaluate(() => { generateDelegatePass(); });
    await sleep(2500);
    const pass = seen.steps.filter(s => s.kind === 'pass').map(s => s.step + (s.reason ? ':' + s.reason : '')).join(', ');
    check('pass: started, photo asked, box closed, then started again and stopped at the QR', /^open, photo_asked, photo_cancel, open, fail:QR not prepared/.test(pass), pass);
    check('badge and pass: no script error on the way', !seen.errors.length, seen.errors.join(' | '));
    await ctx.close();
  }

  // ---- 8. Admin, Overview: the "Pass & badge" card, clicked the way the organiser will ----
  {
    console.log('-- 8. Admin card');
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); });
    const calls = { preview: [], send: [], auto: [] };
    const STATS = {
      since: '29 Oct 2026, 8:46 pm',
      steps: [
        { action: 'card.open', people: 40 }, { action: 'card.photo_asked', people: 31 }, { action: 'card.photo_cancel', people: 12 },
        { action: 'card.photo_fail', people: 5 }, { action: 'card.fail', people: 2 }, { action: 'pass.open', people: 25 },
        { action: 'pass.photo_asked', people: 9 }, { action: 'pass.blocked', people: 3 }, { action: 'pass.fail', people: 1 },
        { action: 'app.boot_fail', people: 2 }, { action: 'app.boot_slow', people: 4 }, { action: 'app.boot_ok', people: 3 },
        { action: 'login.link_refused', people: 7 }, { action: 'help.sent.app', people: 2 }, { action: 'help.sent.card', people: 3 },
      ],
      made: [{ kind: 'card', n: 21 }, { kind: 'pass', n: 19 }],
      stuck: [{ kind: 'card', n: 6 }, { kind: 'pass', n: 1 }],
      reasons: [{ action: 'card.photo_fail', why: 'There is no face in this photo', people: 4 }, { action: 'login.link_refused', why: 'That link or code has expired.', people: 7 }],
      browsers: [{ browser: 'in-app LinkedIn, Chrome 128 on Android 14', people: 2 }, { browser: 'Chrome 130 on Windows', people: 1 }],
      visitors: [{ action: 'app.boot_fail', people: 1 }],
      recent: [{ id: '3329', name: 'Rajib <img src=x onerror="window.__xssHelp=1">', email: 'rajib@technocracy.sg', action: 'app.boot_fail', at: '29 Oct 2026, 9:02 pm', why: 'did not load /app.js?v=1de3727a', browser: 'Chrome 130 on Windows', helped: '' }],
      help: { on: true, due: 1, quiet_minutes: 10, cron_alive: true },
    };
    await ctx.route(/\/api\/admin\/help-stats$/, (r) => r.fulfill({ json: STATS }));
    await ctx.route(/\/api\/admin\/help-mail\/preview/, (r) => { calls.preview.push(r.request().url()); return r.fulfill({ json: { to: 'rajib@technocracy.sg', subject: 'Your Bharat AI Innovation account: the quickest way in', html: '<p id="pv">Hi <strong>Rajib</strong>,</p><ul><li>Refresh the page</li></ul>' } }); });
    await ctx.route(/\/api\/admin\/help-mail\/send$/, (r) => { calls.send.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ json: { sent: true } }); });
    await ctx.route(/\/api\/admin\/help-mail\/auto$/, (r) => { calls.auto.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ json: { ok: true, on: false } }); });
    const page = await ctx.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    // The heading is drawn before the numbers arrive (helpFunnelShell), so wait for
    // a line only the filled card has, or this reads the card half drawn.
    const shown = await until(() => page.evaluate(() => /Made their badge/.test((document.getElementById('help-funnel') || {}).innerText || '')), 20000);
    const text = shown ? await page.evaluate(() => document.getElementById('help-funnel').innerText) : '';
    check('admin card: shows on the Overview with the badge and pass funnels', shown && /Made their badge\s*21\s*of 40/.test(text) && /Downloaded their pass\s*19\s*of 25/.test(text) && /Still stuck\s*6\s*of 40/.test(text), text.slice(0, 300));
    const place = await page.evaluate(() => {
      const card = document.getElementById('help-funnel').getBoundingClientRect().top + window.scrollY;
      const sen = [...document.querySelectorAll('h3')].find(h => /by seniority/.test(h.textContent));
      const tiles = [...document.querySelectorAll('#section-overview .card-hover')].pop();
      return { card, seniority: sen ? sen.getBoundingClientRect().top + window.scrollY : -1, tiles: tiles ? tiles.getBoundingClientRect().bottom + window.scrollY : -1 };
    });
    check('admin card: straight under the number tiles, above everything else on the Overview', place.card > place.tiles && place.card < place.seniority, JSON.stringify(place));
    check('admin card: the way in, the reasons, the browsers and the switch', /App did not open\s*2/.test(text) && /Link no longer signed in\s*7/.test(text) && /There is no face in this photo/.test(text) && /in-app LinkedIn/.test(text) && /5 sent, 1 due now/.test(text), text.slice(0, 600));
    await page.click('#help-funnel details summary');
    const row = await page.evaluate(() => document.querySelector('#help-funnel table').innerText);
    check('admin card: the people list, and a name is text, never markup', /rajib@technocracy\.sg/.test(row) && /Rajib <img/.test(row) && !(await page.evaluate(() => window.__xssHelp)), row.slice(0, 160));
    await page.fill('#help-send-email', 'rajib@technocracy.sg');
    await page.selectOption('#help-send-topic', 'app');
    const [pop] = await Promise.all([ctx.waitForEvent('page'), page.click('#help-funnel button:has-text("Preview")')]);
    await pop.waitForLoadState('domcontentloaded');
    await until(() => pop.evaluate(() => !!document.getElementById('pv')).catch(() => false), 5000);
    const pv = await pop.evaluate(() => ({ title: document.title, body: document.body.innerText }));
    check('admin card: Preview opens the exact email for that address and topic', /quickest way in/.test(pv.title) && /To: rajib@technocracy\.sg/.test(pv.body) && /Hi Rajib/.test(pv.body) && /topic=app&email=rajib%40technocracy\.sg/.test(calls.preview[0] || ''), JSON.stringify({ pv, url: calls.preview[0] }));
    await pop.close();
    await page.click('#help-funnel button:has-text("Send the steps")');
    await until(async () => calls.send.length > 0, 5000);
    await sleep(800);
    check('admin card: Send the steps asks first, then sends that address and topic', dialogs.some(m => /rajib@technocracy\.sg/.test(m) && /replaces the one in their earlier emails/.test(m)) && calls.send.length === 1 && calls.send[0].email === 'rajib@technocracy.sg' && calls.send[0].topic === 'app', JSON.stringify({ dialogs, send: calls.send }));
    check('admin card: says it was sent', await page.evaluate(() => /Sent to rajib@technocracy\.sg/.test(document.body.innerText)), 'no toast');
    await page.uncheck('#help-funnel input[type=checkbox]');
    await until(async () => calls.auto.length > 0, 5000);
    check('admin card: the switch pauses the automatic email', calls.auto.length === 1 && calls.auto[0].on === false, JSON.stringify(calls.auto));
    check('admin card: no script error', !errors.length, errors.join(' | '));
    require('fs').mkdirSync(path.join(__dirname, '.out'), { recursive: true });
    await page.evaluate(() => document.getElementById('help-funnel').scrollIntoView());
    await page.screenshot({ path: path.join(__dirname, '.out', 'help-admin-card.png'), clip: await page.evaluate(() => { const r = document.getElementById('help-funnel').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 8), width: 1366, height: Math.min(900, r.height + 16) }; }) }).catch(() => {});
    await ctx.close();

    // The numbers cannot be loaded: the card says so and Send the steps still works.
    const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx2.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); });
    await ctx2.route(/\/api\/admin\/help-stats$/, (r) => r.fulfill({ status: 500, json: { error: 'D1 went away' } }));
    const page2 = await ctx2.newPage();
    const errors2 = [];
    page2.on('pageerror', e => errors2.push(e.message));
    await page2.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    const said = await until(() => page2.evaluate(() => /Could not load these numbers/.test((document.getElementById('help-funnel') || {}).innerText || '')), 20000);
    const t2 = said ? await page2.evaluate(() => document.getElementById('help-funnel').innerText) : '';
    check('admin card: numbers that cannot load are said, with Try again, and Send the steps stays', said && /who tried, who got stuck/.test(t2) && /Try again/.test(t2) && /Send the steps/.test(t2) && !!(await page2.$('#help-send-email')) && !errors2.length, t2.slice(0, 200) + errors2.join('|'));
    await ctx2.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed: ' + (e && e.stack || e)); process.exit(1); });
