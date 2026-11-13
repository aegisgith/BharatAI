// Announcing a whole panel (13 Nov 2026) in a real browser (Edge), on the real built
// worker and real SQLite (conference-harness.mjs, 0054 applied). On a laptop: a
// panellist's own Announce names the rest of the panel and the moderator; "Announce the
// whole panel instead" writes one post with the day, time, both hall names, the
// moderator and every panellist; posting it marks each of them Announced; the session
// editor has its own Announce. On a phone: the app shows the post with its line breaks.
// Needs conference-harness.mjs (HARNESS_PORT, default 8857). Started by run-all.mjs.
const crypto = require('crypto');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8857);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { try { if (await fn()) return true; } catch {} await sleep(150); } return false; };
const dbq = async (q) => (await fetch(BASE + '/__db?q=' + encodeURIComponent(q))).json();
const appCookie = (id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const b = id + '.' + exp; return b + '.' + crypto.createHmac('sha256', 'h').update(b).digest('hex'); };
const adminInit = () => { if (window.top !== window) return; sessionStorage.setItem('tc_admin_token', 'h-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Harness'); };

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1/sessions')).ok; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await ctx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await ctx.addInitScript(adminInit);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => { if (!/sandboxed/.test(String(e))) errors.push(String(e)); });
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/admin#sessions', { waitUntil: 'domcontentloaded' });
    check('Admin opens on Conference', await until(() => page.locator('.cm-stats').isVisible(), 20000));

    // ---- a panellist's own announcement names the rest of the panel ----
    await page.click('[data-cm="tab"][data-k="speakers"]');
    await page.click('[data-cm="spk-filter"][data-k="all"]');
    const tarun = page.locator('.cm-card', { hasText: 'Tarun Chugh' });
    await tarun.locator('[data-cm="announce"]').click();
    check('a panellist’s Announce opens', await until(async () => ((await page.locator('#cm-a-content').inputValue().catch(() => '')) || '').includes('Tarun Chugh')));
    const own = await page.locator('#cm-a-content').inputValue();
    check('...naming who else is on the panel, the typed name too', own.includes('Also on the panel:') && own.includes('Ratan Kumar Kesh'), own);
    check('...and who moderates it, with their role and organisation', own.includes('Moderated by Shailesh Dhuri, Chief Executive Officer, Decimal Point Analytics.'), own);
    check('...with the day, time and both hall names', own.includes('Fri 20 Nov 2026, 2:00 pm to 3:00 pm, Homi J. Bhabha Hall (Peacock Hall).'), own);
    check('...and never themselves twice', own.split('Tarun Chugh').length === 2, own);

    // ---- the whole panel instead ----
    const sw = page.locator('[data-cm="announce-session"]');
    check('"Announce the whole panel instead" is offered', await sw.isVisible() && (await sw.textContent()).includes('whole panel'));
    await sw.click();
    check('the panel’s Announce opens', await until(async () => ((await page.locator('#modal-container h3').textContent().catch(() => '')) || '').includes('Announce the panel')));
    const t = await page.locator('#cm-a-title').inputValue();
    const c = await page.locator('#cm-a-content').inputValue();
    check('the headline says it is a panel, the day and its title', t === 'Panel discussion on Fri 20 Nov: AI Democratizing and Driving Financial Inclusion', t);
    check('the message has the title, day, time and both hall names', c.startsWith('"AI Democratizing and Driving Financial Inclusion"\nFri 20 Nov 2026, 2:00 pm to 3:00 pm, Homi J. Bhabha Hall (Peacock Hall).'), c);
    check('the moderator, with role and organisation', c.includes('Moderator:\n• Shailesh Dhuri, Chief Executive Officer, Decimal Point Analytics'), c);
    check('every panellist, one per line, with role and organisation', c.includes('Panellists:\n• Tarun Chugh, MD & CEO, Bajaj Life Insurance\n• Ratan Kumar Kesh'), c);
    await page.fill('#cm-a-content', c + '\n\nSeats are first come, first served.');
    await page.click('#cm-a-post');
    check('posted: both speakers’ cards say Announced', await until(async () => (await tarun.textContent()).includes('Announced') && (await page.locator('.cm-card', { hasText: 'Shailesh Dhuri' }).textContent()).includes('Announced'), 10000));
    const ann = (await dbq('SELECT title, content FROM announcements ORDER BY id DESC LIMIT 1'))[0];
    check('...the post is as written, with the organiser’s own line', ann && ann.title.startsWith('Panel discussion') && ann.content.endsWith('Seats are first come, first served.') && ann.content.includes('\n• Tarun Chugh'), ann);
    const logged = await dbq('SELECT speaker_id FROM speaker_announcements ORDER BY speaker_id');
    check('...and both are recorded as announced', logged.map(x => x.speaker_id).join() === '2,3', logged);

    // ---- the session editor has its own Announce ----
    await page.click('[data-cm="tab"][data-k="programme"]');
    await page.click('[data-cm="view"][data-k="list"]');
    await page.click('[data-cm="day"][data-k="2026-11-20"]').catch(() => {});
    const row = page.locator('.cm-table tbody tr', { hasText: 'Financial Inclusion' }).first();
    await until(() => row.isVisible(), 8000);
    await row.click();
    check('the session editor offers Announce', await until(() => page.locator('#cm-drawer.is-open [data-cm="announce-session"]').isVisible()));
    await page.locator('#cm-drawer.is-open [data-cm="announce-session"]').click();
    check('...which closes the editor and opens the panel’s Announce on top', await until(async () => !(await page.locator('#cm-drawer.is-open').count()) && ((await page.locator('#modal-container h3').textContent().catch(() => '')) || '').includes('Announce the panel')));
    await page.click('[data-cm="modal-close"]');
    check('no page errors on the laptop', errors.length === 0, errors);
    await ctx.close();

    // ---- on a phone, the app shows the post with its line breaks ----
    const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await actx.route(u => !u.hostname.startsWith('localhost'), r => r.abort());
    await actx.addCookies([{ name: 'bai_session', value: appCookie(1), url: BASE }]);
    await actx.addInitScript(() => { try { localStorage.setItem('agba_user', JSON.stringify({ id: 1, event_id: 1, name: 'Shailesh Dhuri', email: 'shailesh@example.test', badge_type: 'Speaker', payment_status: 'waived' })); } catch (e) {} });
    const ap = await actx.newPage();
    const aerr = []; ap.on('pageerror', e => aerr.push(String(e)));
    await ap.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    const p = ap.locator('#announcements-feed p', { hasText: 'Seats are first come' });
    check('app: the panel’s post is in the announcements', await until(async () => (await p.count()) > 0, 20000));
    const look = await p.first().evaluate(el => ({ ws: getComputedStyle(el).whiteSpace, text: el.textContent }));
    check('app: its line breaks are kept, so the panellists read as a list', look.ws === 'pre-line' && look.text.includes('\n• Tarun Chugh'), look);
    check('no page errors in the app', aerr.length === 0, aerr);
    await actx.close();
  } finally { await browser.close(); }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
