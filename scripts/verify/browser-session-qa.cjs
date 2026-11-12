// END TO END for questions from the room (12 Nov 2026), real browsers on the built worker
// and real SQLite (login-harness.mjs): on a phone, the session's Questions button, the
// sheet (a title with markup shows as text), asking; a second person votes; the
// moderator's screen marks it answered; the hall screen shows the top question with no
// name; Admin -> Live Q&A lists the session with its links.
// Needs login-harness.mjs (HARNESS_PORT, default 8794). Started by run-all.mjs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8794);
const SHOTS = process.env.SHOTS_DIR || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const sql = (s, a = []) => post('/__sql', { sql: s, args: a });
const key = (sid) => crypto.createHmac('sha256', 'smoke-admin').update('qa:' + sid).digest('hex').slice(0, 32);
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const TITLE = 'AI in Healthcare <img src=x onerror=alert(1)>';

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const { sessionCookie } = await import(pathToFileURL(path.join(__dirname, 'pay-db.mjs')).href);
  const mig = fs.readFileSync(path.join(__dirname, '../../migrations/0060_session_questions.sql'), 'utf8').replace(/--[^\n]*/g, '');
  for (const st of mig.split(';').map((x) => x.trim()).filter(Boolean)) await sql(st);
  for (const [id, name] of [[1201, 'Asha Rao'], [1202, 'Ravi Kumar']]) {
    await sql("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, company, job_title, city, main_event) VALUES (?, 1, ?, ?, ?, 'Delegate Pass', 'paid', ?, 'Head of Data', 'Mumbai', 1)", [id, name, 'p' + id + '@example.com', String(9820400000 + id), 'Org ' + id]);
  }
  await sql("INSERT INTO sessions (id, event_id, title, session_type, room, start_time, end_time) VALUES (2001, 1, ?, 'panel', 'Bhabha', '2026-11-20T11:00', '2026-11-20T11:45')", [TITLE]);
  await sql("INSERT INTO sessions (id, event_id, title, session_type, room, start_time, end_time) VALUES (2002, 1, 'Lunch', 'break', '', '2026-11-20T13:00', '2026-11-20T14:00')");
  const who = async (id) => (await sql('SELECT * FROM attendees WHERE id = ?', [id]))[0];

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  const phoneAs = async (id) => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: 'block' });
    await c.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    if (id) {
      const [name, value] = sessionCookie('smoke-session', id).split('=');
      await c.addCookies([{ name, value, url: BASE }]);
      await c.addInitScript((u) => { if (!localStorage.getItem('agba_user')) localStorage.setItem('agba_user', JSON.stringify(u)); }, await who(id));
    }
    const p = await c.newPage();
    p.setDefaultTimeout(30000);
    p.errors = [];
    p.dialogs = [];
    p.on('pageerror', (e) => p.errors.push(e.message));
    p.on('dialog', (d) => { p.dialogs.push(d.message()); d.accept(); });
    return { c, p };
  };
  try {
    // ---- Asha, on her phone ----
    const A = await phoneAs(1201);
    await A.p.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await A.p.waitForFunction(() => typeof switchTab === 'function' && typeof openSessionQuestions === 'function', null, { timeout: 30000 });
    // All halls, as "Show all halls" does: the schedule opens on one hall.
    await A.p.evaluate(() => { selectedDay = '2026-11-20'; selectedHall = ''; switchTab('schedule'); });
    const btn = await A.p.waitForSelector('button[onclick*="openSessionQuestions(2001)"]', { timeout: 30000 }).then(() => true).catch(() => false);
    const lunchBtn = await A.p.locator('button[onclick*="openSessionQuestions(2002)"]').count();
    check('the schedule shows Questions on the session, not on the lunch break', btn && lunchBtn === 0, 'button ' + btn + ', lunch ' + lunchBtn);
    const h = btn ? await A.p.evaluate(() => Math.round(document.querySelector('button[onclick*="openSessionQuestions(2001)"]').getBoundingClientRect().height)) : 0;
    check('the button is a thumb-sized 44 px', h >= 44, String(h));
    if (btn) await A.p.locator('button[onclick*="openSessionQuestions(2001)"]').tap();
    await A.p.waitForFunction(() => document.getElementById('qa-title') && document.getElementById('qa-title').textContent.length > 0, null, { timeout: 20000 }).catch(() => {});
    const sheet = await A.p.evaluate(() => ({ title: document.getElementById('qa-title').textContent, img: !!document.querySelector('#qa-modal img'), empty: document.getElementById('qa-list').textContent }));
    check('the sheet shows the title as text, never as markup', sheet.title === 'AI in Healthcare <img src=x onerror=alert(1)>' && !sheet.img, JSON.stringify(sheet));
    check('no questions yet: it says ask the first one', /Ask the first one/.test(sheet.empty), sheet.empty);
    await A.p.locator('#qa-send').tap();
    check('sending an empty question says what to do', (await A.p.evaluate(() => document.body.innerText)).includes('Write your question in a few words'));
    await A.p.fill('#qa-body', 'How do you validate models with hospitals? <b>bold</b>');
    await A.p.locator('#qa-send').tap();
    await A.p.waitForFunction(() => /How do you validate/.test(document.getElementById('qa-list').textContent), null, { timeout: 20000 }).catch(() => {});
    const mine = await A.p.evaluate(() => ({ text: document.getElementById('qa-list').innerText, bold: !!document.querySelector('#qa-list b'), box: document.getElementById('qa-body').value }));
    check('her question is listed as hers, as plain text, and the box is cleared', /How do you validate models with hospitals\? <b>bold<\/b>/.test(mine.text) && /Yours/.test(mine.text) && !mine.bold && mine.box === '', JSON.stringify(mine));
    const wide = await A.p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check('no sideways scroll on the phone', wide <= 0, String(wide));
    if (SHOTS) await A.p.screenshot({ path: path.join(SHOTS, 'qa-sheet.png') });
    await A.p.keyboard.press('Escape');
    check('Escape closes the sheet', (await A.p.locator('#qa-modal').count()) === 0);
    check('no alert ran and no script errors (Asha)', A.p.dialogs.length === 0 && A.p.errors.length === 0, JSON.stringify(A.p.dialogs) + A.p.errors.join(' | '));

    // ---- Ravi votes ----
    const R = await phoneAs(1202);
    await R.p.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await R.p.waitForFunction(() => typeof openSessionQuestions === 'function', null, { timeout: 30000 });
    await R.p.evaluate(() => openSessionQuestions(2001));
    await R.p.waitForSelector('#qa-list button[aria-pressed]', { timeout: 20000 }).catch(() => {});
    await R.p.locator('#qa-list button[aria-pressed]').first().tap();
    await R.p.waitForFunction(() => { const b = document.querySelector('#qa-list button[aria-pressed]'); return b && b.getAttribute('aria-pressed') === 'true'; }, null, { timeout: 20000 }).catch(() => {});
    const vote = await R.p.evaluate(() => { const b = document.querySelector('#qa-list button[aria-pressed]'); return b ? { pressed: b.getAttribute('aria-pressed'), text: b.textContent.trim(), yours: /Yours/.test(document.getElementById('qa-list').innerText), name: /Asha/.test(document.getElementById('qa-list').innerText) } : {}; });
    check("Ravi votes: 1 vote, pressed; not his; no name of who asked", vote.pressed === 'true' && vote.text === '1' && !vote.yours && !vote.name, JSON.stringify(vote));
    await R.c.close();

    // ---- the moderator ----
    const M = await phoneAs(0);
    await M.p.goto(BASE + '/live.html?s=2001&k=' + key(2001), { waitUntil: 'domcontentloaded' });
    await M.p.waitForSelector('.lv-q', { timeout: 20000 }).catch(() => {});
    const mod = await M.p.evaluate(() => ({ title: document.getElementById('lv-title').textContent, who: (document.querySelector('.lv-who') || {}).textContent || '', votes: (document.querySelector('.lv-votes') || {}).textContent || '', stage: document.getElementById('lv-stage').getAttribute('href') }));
    check('moderator: the title as text, the question with "Asked by Asha, Org 1201" and its vote', mod.title === 'AI in Healthcare <img src=x onerror=alert(1)>' && mod.who === 'Asked by Asha, Org 1201' && /^1\s*vote$/.test(mod.votes.trim()) && /view=stage/.test(mod.stage), JSON.stringify(mod));
    if (SHOTS) await M.p.screenshot({ path: path.join(SHOTS, 'qa-moderator.png') });

    // ---- the hall screen, before it is answered ----
    const S = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await S.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    const sp = await S.newPage();
    await sp.goto(BASE + '/live.html?s=2001&k=' + key(2001) + '&view=stage', { waitUntil: 'domcontentloaded' });
    await sp.waitForSelector('.lv-q', { timeout: 20000 }).catch(() => {});
    const stage = await sp.evaluate(() => ({ text: document.body.innerText, buttons: document.querySelectorAll('.lv-btn').length, size: parseFloat(getComputedStyle(document.querySelector('.lv-body')).fontSize) }));
    check('hall screen: the question large, no name, no buttons', /How do you validate models/.test(stage.text) && !/Asha|Org 1201/.test(stage.text) && stage.buttons === 0 && stage.size >= 40, JSON.stringify({ buttons: stage.buttons, size: stage.size }));
    if (SHOTS) await sp.screenshot({ path: path.join(SHOTS, 'qa-stage.png') });
    await S.close();

    await M.p.locator('.lv-btn.done').first().tap();
    await M.p.waitForSelector('#lv-answered-box:not([hidden])', { timeout: 20000 }).catch(() => {});
    const done = await M.p.evaluate(() => ({ waiting: document.querySelectorAll('#lv-live .lv-q').length, answered: document.querySelectorAll('#lv-answered .lv-q').length, sum: document.getElementById('lv-answered-sum').textContent }));
    check('"Answered" moves it to the answered list', done.waiting === 0 && done.answered === 1 && done.sum === 'Answered (1)', JSON.stringify(done));
    await M.p.goto(BASE + '/live.html?s=2001&k=0123456789abcdef0123456789abcdef', { waitUntil: 'domcontentloaded' });
    await M.p.waitForSelector('.lv-stop', { timeout: 20000 }).catch(() => {});
    check('a wrong key says so in words', /not complete/.test(await M.p.evaluate(() => (document.querySelector('.lv-stop') || {}).textContent || '')));
    check('no script errors on the moderator screen', M.p.errors.length === 0, M.p.errors.join(' | '));
    await M.c.close();

    // ---- Admin ----
    const D = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    await D.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    await D.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'smoke-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Check'); });
    const a = await D.newPage();
    a.setDefaultTimeout(30000);
    const aerr = [];
    a.on('pageerror', (e) => aerr.push(e.message));
    a.on('dialog', (d) => d.dismiss());
    await a.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await a.waitForFunction(() => typeof switchSection === 'function', null, { timeout: 30000 });
    await a.click('[data-section="liveqa"]');
    await a.waitForSelector('#section-liveqa .aqd-table', { timeout: 30000 }).catch(() => {});
    const adm = await a.evaluate(() => ({ title: document.getElementById('page-title').textContent, text: document.getElementById('section-liveqa').innerText, link: (document.querySelector('#section-liveqa [data-copy]') || {}).getAttribute ? document.querySelector('#section-liveqa [data-copy]').getAttribute('data-copy') : '', img: !!document.querySelector('#section-liveqa img') }));
    check('Admin -> Live Q&A: the session (title as text, not the lunch), its counts and its moderator link', adm.title === 'Live Q&A' && /AI in Healthcare <img src=x onerror=alert\(1\)>/.test(adm.text) && !/Lunch/.test(adm.text) && !adm.img && /\/live\?s=2001&k=[0-9a-f]{32}$/.test(adm.link), JSON.stringify({ title: adm.title, link: adm.link, text: adm.text.slice(0, 300) }));
    if (SHOTS) await a.screenshot({ path: path.join(SHOTS, 'qa-admin.png') });
    check('no script errors on Admin', aerr.length === 0, aerr.join(' | '));
    await D.close();
    await A.c.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall session question browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
