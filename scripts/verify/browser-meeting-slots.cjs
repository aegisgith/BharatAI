// END TO END for meetings on the day (12 Nov 2026), a real phone-sized browser on the
// built worker and real SQLite (login-harness.mjs): an urgent notice stays at the top
// until it is closed, and stays closed; asking for a meeting is a day and a time, the
// times the other person is busy cannot be picked, and the chosen time is what is saved.
// Needs login-harness.mjs (HARNESS_PORT, default 8794). Started by run-all.mjs.
const path = require('path');
const { pathToFileURL } = require('url');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8794);
const SHOTS = process.env.SHOTS_DIR || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const sql = (s, a = []) => post('/__sql', { sql: s, args: a });
const seed = (id, name) => sql("INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, company, job_title, city, main_event) VALUES (?, 1, ?, ?, ?, 'Delegate Pass', 'paid', ?, 'Head of Data', 'Mumbai', 1)",
  [id, name, 'p' + id + '@example.com', String(9820300000 + id), 'Org ' + id]);
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const { sessionCookie } = await import(pathToFileURL(path.join(__dirname, 'pay-db.mjs')).href);
  await seed(701, 'Asha Asker');
  await seed(702, 'Ravi Busy');
  await seed(703, 'Meera Other');
  await sql("INSERT INTO meetings (event_id, requester_id, requestee_id, title, meeting_time, duration_minutes, location, status) VALUES (1, 703, 702, 'Private talk', '2026-11-20T11:00', 30, 'Lounge', 'accepted')");
  await sql("INSERT INTO announcements (event_id, title, content, announcement_type, pinned) VALUES (1, 'Keynote moves to Centrum Hall A', 'The 2 pm keynote is now in Centrum Hall A, ground floor.', 'urgent', 1)");
  const me = (await sql('SELECT * FROM attendees WHERE id = 701'))[0];

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: 'block' });
    await c.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    const [name, value] = sessionCookie('smoke-session', 701).split('=');
    await c.addCookies([{ name, value, url: BASE }]);
    await c.addInitScript((u) => { if (!localStorage.getItem('agba_user')) localStorage.setItem('agba_user', JSON.stringify(u)); }, me);
    const p = await c.newPage();
    p.setDefaultTimeout(30000);
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // ---- the urgent notice ----
    const banner = await p.waitForSelector('#urgent-banner', { timeout: 30000 }).then(() => true).catch(() => false);
    const b = banner ? await p.evaluate(() => { const el = document.getElementById('urgent-banner'); const r = el.getBoundingClientRect(); const btn = el.querySelector('button').getBoundingClientRect(); return { text: el.innerText, role: el.getAttribute('role'), top: r.top, width: r.width, btnW: btn.width, btnH: btn.height }; }) : {};
    check('the urgent notice is at the top of the phone, title and words', banner && /Keynote moves to Centrum Hall A/.test(b.text) && /ground floor/.test(b.text) && b.role === 'alert' && b.top < 60 && b.width <= 390, JSON.stringify(b));
    check('its close button is big enough for a thumb (44 px)', b.btnW >= 44 && b.btnH >= 44, JSON.stringify(b));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'urgent-banner.png') });
    if (banner) await p.click('#urgent-banner button');
    check('closing it takes it away', (await p.locator('#urgent-banner').count()) === 0);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof pollNotifications === 'function' && typeof _notifCache !== 'undefined' && _notifCache.length > 0, null, { timeout: 30000 }).catch(() => {});
    await sleep(800);
    check('and it stays closed after the app is opened again', (await p.locator('#urgent-banner').count()) === 0);

    // ---- the meeting time ----
    await p.evaluate(() => openMeetingModal(702));
    await p.waitForFunction(() => { const s = document.getElementById('meeting-slot'); return s && Array.from(s.options).some((o) => o.disabled); }, null, { timeout: 15000 }).catch(() => {});
    const slots = await p.evaluate(() => Array.from(document.getElementById('meeting-slot').options).map((o) => ({ v: o.value, t: o.textContent, off: o.disabled })));
    const off = slots.filter((s) => s.off).map((s) => s.v);
    check('times run 9:00 am to 5:45 pm, every 15 minutes', slots.length === 36 && slots[0].v === '09:00' && slots[0].t === '9:00 am' && slots[35].v === '17:45' && slots[35].t === '5:45 pm', JSON.stringify(slots.slice(0, 2)) + ' ' + slots.length);
    check('for 30 minutes, 10:45, 11:00 and 11:15 are marked "they are busy" and cannot be picked', JSON.stringify(off) === JSON.stringify(['10:45', '11:00', '11:15']) && slots.filter((s) => s.off).every((s) => / \(they are busy\)$/.test(s.t)), JSON.stringify(slots.filter((s) => s.off)));
    await p.selectOption('#meeting-duration', '15');
    const off15 = await p.evaluate(() => Array.from(document.getElementById('meeting-slot').options).filter((o) => o.disabled).map((o) => o.value));
    check('for 15 minutes, only 11:00 and 11:15 are busy', JSON.stringify(off15) === JSON.stringify(['11:00', '11:15']), JSON.stringify(off15));
    await p.selectOption('#meeting-day', '2026-11-21');
    const off21 = await p.evaluate(() => Array.from(document.getElementById('meeting-slot').options).filter((o) => o.disabled).length);
    check('on Saturday nothing is busy', off21 === 0, String(off21));
    await p.selectOption('#meeting-day', '2026-11-20');
    await p.selectOption('#meeting-slot', '10:30');
    await p.fill('#meeting-title', 'Data partnership');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'meeting-slots.png') });
    await p.click('#meeting-form button[type="submit"]');
    await p.waitForFunction(() => document.getElementById('meeting-modal').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
    const saved = (await sql("SELECT meeting_time, duration_minutes, status FROM meetings WHERE requester_id = 701 AND requestee_id = 702"))[0] || {};
    check('the chosen day and time is what is saved', saved.meeting_time === '2026-11-20T10:30' && Number(saved.duration_minutes) === 15 && saved.status === 'pending', JSON.stringify(saved));
    check('no script errors on the page', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall meeting slot browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
