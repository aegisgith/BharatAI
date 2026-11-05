// END TO END for a pass set by hand (5 Nov 2026): a real browser on Admin, on the
// built worker and real SQLite (login-harness.mjs). The question on all four screens,
// cancelling, the amount, when it must not ask, a phone-sized Admin, and then the
// people themselves opening the app on a phone.
// Needs login-harness.mjs (HARNESS_PORT, default 8794). Started by run-all.mjs.
const path = require('path');
const { pathToFileURL } = require('url');
const pw = require('./playwright.cjs');
const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8794);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const sql = (s, a = []) => post('/__sql', { sql: s, args: a });
const rowOf = async (id) => (await sql('SELECT * FROM attendees WHERE id = ?', [id]))[0] || {};
const seed = (id, name, over = {}) => sql('INSERT INTO attendees (id, event_id, name, email, mobile, badge_type, payment_status, payment_amount, company, job_title, city, main_event) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
  [id, name, 'p' + id + '@example.com', String(9820200000 + id), over.badge || 'Visitor Pass', over.status || 'paid', over.amount || null, 'Org ' + id, 'Head of Data', 'Mumbai']);
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const { sessionCookie } = await import(pathToFileURL(path.join(__dirname, 'pay-db.mjs')).href);

  await seed(501, 'Full Edit Complimentary');
  await seed(502, 'Inline Paid Elsewhere');
  await seed(503, 'Full Edit Not Paid');
  await seed(504, 'Bulk Mover One');
  await seed(505, 'Bulk Holder', { badge: 'Delegate Pass', amount: '5898.82' });
  await seed(506, 'To Exhibitor');
  await seed(507, 'Paid Between', { badge: 'Delegate Pass', amount: '5898.82' });
  await seed(508, 'Box Says Pending');
  await seed(509, 'Inline Cancel');
  await seed(510, 'Had An Amount', { amount: '5898.82' });
  await seed(511, 'Bulk Mover Two');
  await seed(512, 'Esc & <b>Cancel</b>');

  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    await ctx.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
    await ctx.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'smoke-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Check'); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.dismiss());
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof switchSection === 'function', null, { timeout: 30000 });
    const grid = async () => {
      await page.evaluate(() => { lastAttendees = null; switchSection('attendees'); });
      await page.waitForSelector('button[onclick="openEditAttendeeById(501)"]', { timeout: 20000 });
    };
    await grid();
    const asked = () => page.locator('#pass-answer').count().then(n => n > 0);
    const waitAsked = () => page.waitForSelector('#pass-answer', { timeout: 8000 }).then(() => true).catch(() => false);
    const gone = () => page.waitForSelector('#pass-answer', { state: 'detached', timeout: 8000 }).then(() => true).catch(() => false);
    const openEdit = async (id) => { await page.click('button[onclick="openEditAttendeeById(' + id + ')"]'); await page.waitForSelector('#edit-att-form', { timeout: 10000 }); };
    const saveEdit = () => page.click('#edit-att-form button[type="submit"]');
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; };

    // ---- Full Edit ----
    await openEdit(501);
    await page.selectOption('#ea-badge', 'Delegate Pass');
    await saveEdit();
    check('Full Edit: moving a Visitor to Delegate asks before saving', await waitAsked());
    const title = await page.textContent('#pa-title');
    check('it names the person and the pass', /Full Edit Complimentary/.test(title) && /Delegate Pass/.test(title), title);
    const opts = await page.textContent('#pass-answer');
    check('the three answers are plain', /Complimentary/.test(opts) && /Paid another way/.test(opts) && /Not paid yet/.test(opts), opts);
    check('nothing is chosen for the admin', await page.evaluate(() => !document.querySelector('input[name="pa-how"]:checked')));
    await page.click('#pa-save');
    check('Save with no choice says so and stays', /Choose one/.test(await page.textContent('#pa-msg')) && await asked());
    await page.click('#pa-cancel');
    check('Cancel closes the question', await gone());
    check('and Full Edit is still open with what was typed', await page.isVisible('#edit-att-form') && await page.inputValue('#ea-badge') === 'Delegate Pass');
    check('and nothing was saved', (await rowOf(501)).badge_type === 'Visitor Pass');
    await saveEdit();
    await waitAsked();
    await page.check('#pa-waived');
    await page.click('#pa-save');
    await until(async () => (await rowOf(501)).badge_type === 'Delegate Pass');
    let a = await rowOf(501);
    check('Complimentary from Full Edit is saved as complimentary', a.badge_type === 'Delegate Pass' && a.payment_status === 'waived', JSON.stringify([a.badge_type, a.payment_status]));
    const chip = () => page.evaluate(() => { const c = document.querySelector('td[onclick^="inlineSelect(this, 501,"]'); return c ? c.innerHTML : ''; });
    await until(async () => /title="Complimentary/.test(await chip()));
    check('and the grid marks the pass as given, free', /title="Complimentary/.test(await chip()) && /free/.test(await chip()), await chip());

    await openEdit(503);
    await page.selectOption('#ea-badge', 'VIP Pass');
    await saveEdit();
    await waitAsked();
    await page.check('#pa-pending');
    await page.click('#pa-save');
    await until(async () => (await rowOf(503)).badge_type === 'VIP Pass');
    a = await rowOf(503);
    check('Not paid yet from Full Edit is saved as not paid', a.badge_type === 'VIP Pass' && a.payment_status === 'pending', JSON.stringify([a.badge_type, a.payment_status]));

    await openEdit(508);
    await page.selectOption('#ea-badge', 'Delegate Pass');
    await page.selectOption('#ea-payment-status', 'pending');
    await saveEdit();
    await until(async () => (await rowOf(508)).badge_type === 'Delegate Pass');
    a = await rowOf(508);
    check('Payment box already set to pending: that is the answer, no question', a.payment_status === 'pending' && !(await asked()), JSON.stringify([a.payment_status]));

    await openEdit(506);
    await page.selectOption('#ea-badge', 'Exhibitor');
    await saveEdit();
    await until(async () => (await rowOf(506)).badge_type === 'Exhibitor');
    a = await rowOf(506);
    check('Visitor to Exhibitor: not a paid pass, no question, left alone', a.badge_type === 'Exhibitor' && a.payment_status === 'paid' && !(await asked()), JSON.stringify([a.badge_type, a.payment_status]));

    await openEdit(510);
    await page.selectOption('#ea-badge', 'Delegate Pass');
    await saveEdit();
    await waitAsked();
    const pre = await page.evaluate(() => ({ on: (document.querySelector('input[name="pa-how"]:checked') || {}).value, amt: document.getElementById('pa-amount').value }));
    check('someone with an amount on record starts on Paid another way, with it filled in', pre.on === 'paid' && pre.amt === '5898.82', JSON.stringify(pre));
    await page.click('#pa-save');
    await until(async () => (await rowOf(510)).badge_type === 'Delegate Pass');
    a = await rowOf(510);
    check('and it saves as paid with that amount', a.payment_status === 'paid' && String(a.payment_amount) === '5898.82', JSON.stringify([a.payment_status, a.payment_amount]));

    // ---- Names are shown, not run ----
    await grid();
    await openEdit(512);
    await page.selectOption('#ea-badge', 'VIP Pass');
    await saveEdit();
    await waitAsked();
    check('a name with tags in it is shown as text in the question', /Esc & <b>Cancel<\/b>/.test(await page.textContent('#pa-title')) && await page.locator('#pa-title b').count() === 0);
    await page.keyboard.press('Escape');
    check('Esc cancels the question', await gone());
    check('and leaves the row as it was', (await rowOf(512)).badge_type === 'Visitor Pass');
    await page.click('#edit-att-form button[type="button"]:has-text("Cancel")');

    // ---- The inline cell ----
    const cell = (id) => page.locator('td.ie-cell[onclick^="inlineSelect(this, ' + id + ', \'badge_type\'"]');
    await grid();
    await cell(509).click();
    await cell(509).locator('select').selectOption('VIP Pass');
    check('inline cell: asks', await waitAsked());
    await sleep(500);
    check('and only once, though the box lost focus', await page.locator('#pass-answer').count() === 1);
    await page.click('#pa-cancel');
    await gone();
    check('inline cell, Cancel: the cell comes back, nothing saved', (await rowOf(509)).badge_type === 'Visitor Pass' && await cell(509).locator('select').count() === 0);

    await cell(502).click();
    await cell(502).locator('select').selectOption('Delegate Pass');
    await waitAsked();
    await page.check('#pa-paid');
    check('choosing Paid another way shows the amount box', await page.isVisible('#pa-amount'));
    await page.click('#pa-save');
    check('no amount: says so and stays', /Enter the amount/.test(await page.textContent('#pa-msg')) && await asked());
    await page.fill('#pa-amount', 'abc');
    await page.click('#pa-save');
    check('words instead of an amount: says so and stays', await asked() && (await rowOf(502)).badge_type === 'Visitor Pass');
    await page.fill('#pa-amount', '5,898.82');
    await page.click('#pa-save');
    await until(async () => (await rowOf(502)).badge_type === 'Delegate Pass');
    a = await rowOf(502);
    check('inline cell, Paid another way: paid, with the amount as a number', a.badge_type === 'Delegate Pass' && a.payment_status === 'paid' && String(a.payment_amount) === '5898.82', JSON.stringify([a.badge_type, a.payment_status, a.payment_amount]));

    await grid();
    await cell(507).click();
    await cell(507).locator('select').selectOption('VIP Pass');
    await until(async () => (await rowOf(507)).badge_type === 'VIP Pass');
    a = await rowOf(507);
    check('inline cell, a paid Delegate to VIP: no question, what they paid stays', a.badge_type === 'VIP Pass' && a.payment_status === 'paid' && String(a.payment_amount) === '5898.82' && !(await asked()), JSON.stringify([a.badge_type, a.payment_status]));

    // ---- Set pass on a selection ----
    await grid();
    const tick = async (id) => page.locator('input[onchange="attToggleRow(' + id + ', this.checked)"]').check();
    await tick(504); await tick(505); await tick(511);
    await page.click('button[onclick="bulkSetField(\'badge_type\')"]');
    await page.selectOption('#bulk-val', 'VIP Pass');
    await page.click('button[onclick^="bulkSetFieldGo"]');
    check('Set pass: asks', await waitAsked());
    const bt = await page.textContent('#pa-title');
    check('it counts only those moving onto a paid pass (two of the three selected)', /these 2 people/.test(bt), bt);
    await page.check('#pa-paid');
    check('and the amount is per person', /each person/.test(await page.textContent('#pa-amount-box')));
    await page.click('#pa-cancel');
    await gone();
    check('Set pass, Cancel: nothing changed, including the one already holding a pass', (await rowOf(504)).badge_type === 'Visitor Pass' && (await rowOf(505)).badge_type === 'Delegate Pass' && await page.isVisible('#bulk-val'));
    await page.click('button[onclick^="bulkSetFieldGo"]');
    await waitAsked();
    await page.check('#pa-waived');
    await page.click('#pa-save');
    await until(async () => (await rowOf(504)).badge_type === 'VIP Pass' && (await rowOf(505)).badge_type === 'VIP Pass' && (await rowOf(511)).badge_type === 'VIP Pass');
    const [m1, h, m2] = [await rowOf(504), await rowOf(505), await rowOf(511)];
    check('Set pass, Complimentary: the two movers are given', m1.payment_status === 'waived' && m2.payment_status === 'waived', JSON.stringify([m1.payment_status, m2.payment_status]));
    check('and the Delegate who paid is still paid, with their amount', h.badge_type === 'VIP Pass' && h.payment_status === 'paid' && String(h.payment_amount) === '5898.82', JSON.stringify([h.badge_type, h.payment_status, h.payment_amount]));

    // ---- Add Attendee ----
    await page.evaluate(() => openAddAttendee());
    await page.waitForSelector('#add-att-form');
    await page.fill('#na-name', 'New Guest');
    await page.fill('#na-email', 'new.guest@example.com');
    await page.selectOption('#na-badge', 'VIP Pass');
    await page.click('#na-submit-btn');
    check('Add Attendee: a paid pass asks', await waitAsked());
    await page.click('#pa-cancel');
    await gone();
    check('Add Attendee, Cancel: the form stays, nobody added', await page.isVisible('#add-att-form') && (await sql("SELECT COUNT(*) n FROM attendees WHERE email = 'new.guest@example.com'"))[0].n === 0);
    await page.click('#na-submit-btn');
    await waitAsked();
    await page.check('#pa-waived');
    await page.click('#pa-save');
    await until(async () => (await sql("SELECT COUNT(*) n FROM attendees WHERE email = 'new.guest@example.com'"))[0].n === 1);
    a = (await sql("SELECT * FROM attendees WHERE email = 'new.guest@example.com'"))[0] || {};
    check('Add Attendee, Complimentary', a.badge_type === 'VIP Pass' && a.payment_status === 'waived', JSON.stringify([a.badge_type, a.payment_status]));
    await sleep(500);
    await page.evaluate(() => openAddAttendee());
    await page.waitForSelector('#add-att-form');
    await page.fill('#na-name', 'New Visitor');
    await page.fill('#na-email', 'new.visitor@example.com');
    await page.selectOption('#na-badge', 'Visitor Pass');
    await page.click('#na-submit-btn');
    await until(async () => (await sql("SELECT COUNT(*) n FROM attendees WHERE email = 'new.visitor@example.com'"))[0].n === 1);
    check('Add Attendee, a Visitor Pass: no question', (await sql("SELECT COUNT(*) n FROM attendees WHERE email = 'new.visitor@example.com'"))[0].n === 1 && !(await asked()));
    check('no script error across Admin', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();

    // ---- The question on a phone-sized Admin ----
    {
      const c = await browser.newContext({ viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: 'block' });
      await c.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
      await c.addInitScript(() => { sessionStorage.setItem('tc_admin_token', 'smoke-admin'); localStorage.setItem('tc_admin', '1'); localStorage.setItem('tc_admin_operator', 'Check'); });
      const p = await c.newPage();
      await p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForFunction(() => typeof askPassAnswer === 'function', null, { timeout: 30000 });
      await p.evaluate(() => { askPassAnswer({ name: 'A Rather Long Name Of Someone Important', pass: 'Premium Delegate Pass' }); });
      await p.waitForSelector('#pass-answer');
      await p.check('#pa-paid');
      const box = await p.evaluate(() => { const d = document.querySelector('#pass-answer > div'); const r = d.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, wide: document.documentElement.scrollWidth <= innerWidth + 1, scrolls: d.scrollHeight > d.clientHeight, save: document.getElementById('pa-save').getBoundingClientRect().height, input: document.getElementById('pa-amount').getBoundingClientRect().height }; });
      check('on a small phone the question stays on screen, scrolls inside itself, and its buttons are big enough', box.top >= 0 && box.bottom <= box.h + 1 && box.wide && box.save >= 44 && box.input >= 44, JSON.stringify(box));
      await p.locator('#pa-save').scrollIntoViewIfNeeded();
      check('and Save can be reached', await p.isVisible('#pa-save'));
      await c.close();
    }

    // ---- The people themselves, on a phone ----
    const phone = async (row) => {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: 'block' });
      await c.route((u) => !String(u).startsWith(BASE), (r) => r.abort());
      const [name, value] = sessionCookie('smoke-session', row.id).split('=');
      await c.addCookies([{ name, value, url: BASE }]);
      await c.addInitScript((u) => { if (!localStorage.getItem('agba_user')) localStorage.setItem('agba_user', JSON.stringify(u)); }, row);
      const p = await c.newPage();
      await p.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForFunction(() => { const n = document.getElementById('pcc-pass-name'); return n && n.textContent !== 'Your pass' && typeof _ppPrices !== 'undefined' && _ppPrices; }, null, { timeout: 30000 }).catch(() => {});
      await sleep(400);
      const st = await p.evaluate(() => { const v = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && e.offsetParent !== null; }; return { up: v('pcc-upgrade-btn'), pay: v('pcc-pay-btn'), line: (document.getElementById('pcc-upgrade') || {}).textContent || '', state: (document.getElementById('pcc-pass-state') || {}).textContent || '' }; });
      await c.close();
      return st;
    };
    const given = await phone(await rowOf(501));
    check('the complimentary person: pass ready, no upgrade, nothing to pay', /is ready/.test(given.state) && !given.up && !given.pay, JSON.stringify(given));
    const elsewhere = await phone(await rowOf(502));
    check('the person who paid another way: pass ready, and an upgrade for the difference', /is ready/.test(elsewhere.state) && elsewhere.up && !elsewhere.pay && /difference/.test(elsewhere.line), JSON.stringify(elsewhere));
    const unpaid = await phone(await rowOf(503));
    check('the person who has not paid: told so, with Pay now', /waiting for payment/.test(unpaid.state) && unpaid.pay && !unpaid.up, JSON.stringify(unpaid));
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(2); });
