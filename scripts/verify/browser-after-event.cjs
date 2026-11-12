// END TO END for After the Event (12 Nov 2026), a real browser on the built worker and
// real SQLite (login-harness.mjs): the survey on a phone, opened from the email's number,
// answered and thanked, with Delhi offered to a "yes"; the first question missed; a
// broken link; no sideways scroll at 390 or 320 px; then Admin's After the Event screen
// with the survey numbers, an exhibitor row and the email preview.
// Needs login-harness.mjs (HARNESS_PORT, default 8794). Started by run-all.mjs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8794);
const SHOTS = process.env.SHOTS_DIR || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const sql = (s, a = []) => post('/__sql', { sql: s, args: a });
const sig = (id) => crypto.createHmac('sha256', 'smoke-admin').update('feedback:' + id).digest('hex').slice(0, 32);
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  // 0057, one statement at a time.
  const mig = fs.readFileSync(path.join(__dirname, '../../migrations/0057_feedback.sql'), 'utf8').replace(/--[^\n]*/g, '');
  for (const st of mig.split(';').map((x) => x.trim()).filter(Boolean)) await sql(st);
  await sql("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, company, job_title, city, main_event, checked_in_at) VALUES (801, 1, 'Asha Rao', 'asha801@example.com', '9820380801', 'Delegate Pass', 'paid', 'Org 801', 'Head of Data', 'Mumbai', 1, '2026-11-20 04:00:00')");
  await sql("INSERT INTO exhibitors (id, event_id, company_name, contact_email, booth_number) VALUES (901, 1, 'Acme AI', 'spoc@acme.example', 'B12')");

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: 'block' });
    await phone.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    const p = await phone.newPage();
    p.setDefaultTimeout(30000);
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));

    // ---- from the email: tapped 8 ----
    await p.goto(BASE + '/feedback.html?a=801&k=' + sig(801) + '&r=8', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.getElementById('fb-hello').textContent.length > 0, null, { timeout: 20000 }).catch(() => {});
    const start = await p.evaluate(() => ({ hello: document.getElementById('fb-hello').textContent, eight: document.querySelector('input[name="recommend"][value="8"]').checked, wide: document.documentElement.scrollWidth - innerWidth }));
    check('opened from the email: "Hi Asha," and 8 already chosen', start.hello === 'Hi Asha,' && start.eight, JSON.stringify(start));
    check('no sideways scroll at 390 px', start.wide <= 0, String(start.wide));
    const tap = async (name, value) => { await p.locator('input[name="' + name + '"][value="' + value + '"] + span').tap(); };
    await tap('useful', 'people');
    await tap('useful', 'exhibition');
    await tap('met', 'several');
    await tap('entry', 'good');
    await tap('delhi', 'yes');
    await p.fill('#fb-fix', 'Signs to the boardrooms');
    const sizes = await p.evaluate(() => Array.from(document.querySelectorAll('.fb-chip span')).map((s) => { const r = s.getBoundingClientRect(); return Math.round(r.height); }));
    check('every answer is at least 44 px tall to tap', sizes.length === 26 && sizes.every((h) => h >= 44), JSON.stringify(sizes));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'feedback-phone.png'), fullPage: true });
    await p.locator('#fb-send').tap();
    await p.waitForSelector('#fb-done:not([hidden])', { timeout: 20000 }).catch(() => {});
    const doneState = await p.evaluate(() => ({ title: document.getElementById('fb-done-title').textContent, delhi: !document.getElementById('fb-delhi').hidden, href: document.querySelector('#fb-delhi a').getAttribute('href') }));
    check('sent: "Thank you, Asha." and Delhi passes offered to a "yes"', doneState.title === 'Thank you, Asha.' && doneState.delhi && doneState.href === '/delhi#passes', JSON.stringify(doneState));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'feedback-done.png') });
    const saved = (await sql('SELECT * FROM feedback WHERE attendee_id = 801'))[0] || {};
    check('the answers are saved as given', saved.recommend === 8 && saved.useful === 'exhibition,people' && saved.met === 'several' && saved.entry === 'good' && saved.delhi === 'yes' && saved.fix === 'Signs to the boardrooms', JSON.stringify(saved));
    await p.locator('#fb-again').tap();
    const back = await p.evaluate(() => !document.getElementById('fb-card').hidden && document.querySelector('input[name="delhi"][value="yes"]').checked);
    check('"Change my answers" brings the form back as filled', back);

    // ---- opened again later: the answers are there ----
    await p.goto(BASE + '/feedback.html?a=801&k=' + sig(801), { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#fb-before:not([hidden])', { timeout: 20000 }).catch(() => {});
    const again = await p.evaluate(() => ({ note: document.getElementById('fb-before').textContent, eight: document.querySelector('input[name="recommend"][value="8"]').checked, fix: document.getElementById('fb-fix').value }));
    check('opened again: says it was answered, shows the answers', /answered already/.test(again.note) && again.eight && again.fix === 'Signs to the boardrooms', JSON.stringify(again));

    // ---- the first question missed (preview: nothing saved) ----
    await p.goto(BASE + '/feedback.html?preview=1', { waitUntil: 'domcontentloaded' });
    await p.locator('#fb-send').tap();
    const missed = await p.evaluate(() => ({ err: document.getElementById('fb-error').textContent, hidden: document.getElementById('fb-error').hidden, inv: document.getElementById('fb-q-recommend').getAttribute('aria-invalid'), preview: !document.getElementById('fb-preview').hidden }));
    check('the first question missed: told in words, marked, on the preview', !missed.hidden && /0 to 10/.test(missed.err) && missed.inv === 'true' && missed.preview, JSON.stringify(missed));
    await p.locator('input[name="recommend"][value="3"] + span').tap();
    await p.locator('#fb-send').tap();
    await p.waitForSelector('#fb-done:not([hidden])', { timeout: 10000 }).catch(() => {});
    const count = (await sql('SELECT COUNT(*) AS n FROM feedback'))[0].n;
    check('the preview thanks you and saves nothing', (await p.isVisible('#fb-done')) && count === 1, String(count));

    // ---- a broken link ----
    await p.goto(BASE + '/feedback.html?a=801&k=bad', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.fb-stop', { timeout: 20000 }).catch(() => {});
    const stop = await p.evaluate(() => ({ text: (document.querySelector('.fb-stop') || {}).textContent || '', form: !!document.getElementById('fb-form') }));
    check('a broken link says so in words, with no form', /not complete/.test(stop.text) && !stop.form, JSON.stringify(stop));

    // ---- 320 px ----
    await p.setViewportSize({ width: 320, height: 640 });
    await p.goto(BASE + '/feedback.html?preview=1', { waitUntil: 'domcontentloaded' });
    const narrow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check('no sideways scroll at 320 px', narrow <= 0, String(narrow));
    check('no script errors on the survey page', errors.length === 0, errors.join(' | '));
    await phone.close();

    // ---- Admin ----
    const desk = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    await desk.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    await desk.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'smoke-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Check'); });
    const a = await desk.newPage();
    a.setDefaultTimeout(30000);
    const aerr = [];
    // The test's own init script (the admin token) also runs inside the sandboxed email
    // preview, which may not touch storage: those errors are the test's, not the page's.
    a.on('pageerror', (e) => { if (!/sandboxed and lacks the 'allow-same-origin' flag/.test(e.message)) aerr.push(e.message); });
    await a.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await a.waitForFunction(() => typeof switchSection === 'function', null, { timeout: 30000 });
    const btn = await a.evaluate(() => { const b = document.querySelector('[data-section="after"]'); return b ? b.textContent.trim() : ''; });
    check('Admin has "After the Event" in the sidebar', btn === 'After the Event', btn);
    await a.click('[data-section="after"]');
    await a.waitForSelector('#section-after .afd-card', { timeout: 30000 }).catch(() => {});
    const view = await a.evaluate(() => ({ title: document.getElementById('page-title').textContent, text: document.getElementById('section-after').innerText }));
    check('the screen: survey with 1 checked in and 1 answered, a score, the exhibitor row', view.title === 'After the Event' && /Feedback survey/.test(view.text) && /Send to everyone who checked in \(1\)/.test(view.text)
      && /Coming to Delhi 2027/.test(view.text) && /Signs to the boardrooms/.test(view.text) && /Acme AI/.test(view.text) && /Nothing recorded/.test(view.text), view.text.slice(0, 600));
    if (SHOTS) await a.screenshot({ path: path.join(SHOTS, 'admin-after.png'), fullPage: true });
    await a.click('[data-act="preview-survey"]');
    await a.waitForSelector('#afd-preview iframe', { timeout: 15000 }).catch(() => {});
    const pv = await a.evaluate(() => { const f = document.querySelector('#afd-preview iframe'); return f ? (f.srcdoc || '') : ''; });
    check('"Preview the email" shows the survey email', /How likely are you to recommend/.test(pv) && /preview=1/.test(pv), pv.slice(0, 200));
    await a.keyboard.press('Escape');
    check('Escape closes the preview', (await a.locator('#afd-preview').count()) === 0);
    await a.click('[data-act="preview-ex"][data-id="901"]');
    await a.waitForSelector('#afd-preview iframe', { timeout: 15000 }).catch(() => {});
    const ex = await a.evaluate(() => { const f = document.querySelector('#afd-preview iframe'); return { html: f ? f.srcdoc : '', head: (document.querySelector('#afd-preview .afd-modal-head') || {}).innerText || '' }; });
    check('the exhibitor preview names the contact address and shows the results email', /spoc@acme\.example/.test(ex.head) && /Your results from Bharat AI Innovation 2026: Acme AI/.test(ex.head) && /did not scan any badges/.test(ex.html), ex.head);
    check('no script errors on Admin', aerr.length === 0, aerr.join(' | '));
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall after-the-event browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
