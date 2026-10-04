// Buying a pass on a phone, in a real browser, against pay-harness.mjs (:8776):
// the paid form on /register, the hand-off page, the gateway's answer, the result
// page, landing in the app signed in, paying a pending pass from the app, cancelling
// and trying again, the mUni Campus fallback, and the invoice queues in /admin and
// /finance. The gateway is played here: secure.ccavenue.com is intercepted, its
// request is decrypted the way CCAvenue's kits do it, and an answer is posted back.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { chromium } = require('./playwright.cjs');

const BASE = 'http://localhost:8776';
const SESSION = 'h-secret';
const OUT = path.join(__dirname, '.out');
let fails = 0;
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   ' + detail)); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getState = async () => (await fetch(BASE + '/api/__state')).json();
const setState = (body) => fetch(BASE + '/api/__state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' };

(async () => {
  const { kitEncrypt, kitDecrypt, gatewayAnswer, sessionCookie, staffCookie } = await import(pathToFileURL(path.join(__dirname, 'pay-db.mjs')).href);
  try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];

  // What the gateway does next: answer at once, or wait on its page for a tap.
  const gw = { reply: 'Success', hold: false, seen: [] };
  const playGateway = async (ctx) => {
    await ctx.route('https://secure.ccavenue.com/**', async (route) => {
      const form = new URLSearchParams(route.request().postData() || '');
      let sent = {};
      try { sent = Object.fromEntries(new URLSearchParams(kitDecrypt(form.get('encRequest') || ''))); } catch (e) { sent = { error: String(e.message) }; }
      gw.seen.push({ sent, access_code: form.get('access_code') });
      const order = { order_id: sent.order_id, amount_paise: Math.round(Number(sent.amount) * 100), pass_type: sent.merchant_param2 };
      const over = gw.reply === 'Success' ? {} : { order_status: gw.reply, tracking_id: 'null', status_message: 'N' };
      const encResp = kitEncrypt(gatewayAnswer(SESSION, order, { merchant_param1: sent.merchant_param1, ...over }));
      await route.fulfill({ status: 200, contentType: 'text/html', body:
        '<!doctype html><html><body><h1 id="stub">STUB GATEWAY</h1><form method="post" action="' + sent.redirect_url + '">' +
        '<input type="hidden" name="encResp" value="' + encResp + '"><input type="hidden" name="orderNo" value="' + sent.order_id + '">' +
        '<button id="pay" type="submit">Answer</button></form>' + (gw.hold ? '' : '<script>document.forms[0].submit()</script>') + '</body></html>' });
    });
    await ctx.route('https://municampus.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1 id="muni">MUNI STUB</h1>' }));
  };
  const phone = async (opts = {}) => {
    const ctx = await browser.newContext(PHONE);
    await playGateway(ctx);
    if (opts.person) {
      const [name, value] = sessionCookie(SESSION, opts.person.id).split('=');
      await ctx.addCookies([{ name, value, url: BASE }]);
      await ctx.addInitScript((u) => { if (!localStorage.getItem('agba_user')) localStorage.setItem('agba_user', JSON.stringify(u)); }, opts.person);
    }
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    return { ctx, page };
  };
  const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const fillRegisterForm = async (page, email) => {
    await page.fill('#rpp-name', 'Meera Nair');
    await page.fill('#rpp-email', email);
    await page.fill('#rpp-phone', '+91 98200 55555');
    await page.fill('#rpp-company', 'Nair Analytics');
    await page.selectOption('#rpp-industry', 'Software & SaaS');
    await page.fill('#rpp-designation', 'Founder');
    await page.fill('#rpp-city', 'Pune');
  };

  // ---- 1. A new buyer on /register, on a phone ----
  await setState({ reset: true });
  {
    const { ctx, page } = await phone();
    let popups = 0;
    ctx.on('page', () => { popups++; });
    popups = 0;
    await page.goto(BASE + '/register#delegate', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.PAY_GATEWAY === 'ccavenue', null, { timeout: 15000 });
    check('/register learns that checkout is on this site', true);
    check('the paid form says where checkout happens', /CCAvenue/.test(await page.textContent('#rpp-next-copy') || ''), await page.textContent('#rpp-next-copy'));
    check('the Delegate tier is already chosen from the link', (await page.inputValue('#rpp-pass-type')) === 'Delegate Pass', await page.inputValue('#rpp-pass-type'));
    await fillRegisterForm(page, 'meera@example.com');

    gw.hold = true; gw.reply = 'Success'; gw.seen.length = 0;
    await page.click('#rpp-submit-btn');
    await page.waitForSelector('#stub', { timeout: 20000 });
    check('the buyer reaches the gateway in the same tab, no popup', popups === 0 && /secure\.ccavenue\.com/.test(page.url()), popups + ' popups, ' + page.url());
    const sent = (gw.seen[0] || {}).sent || {};
    check('the gateway is asked for 5,898.82 for a Delegate Pass', sent.amount === '5898.82' && sent.currency === 'INR' && sent.merchant_param2 === 'Delegate Pass' && (gw.seen[0] || {}).access_code === 'AVSMOKE00TEST', JSON.stringify(sent).slice(0, 200));
    check('with the buyer\'s name, phone and email already filled in', sent.billing_name === 'Meera Nair' && sent.billing_tel === '9820055555' && sent.billing_email === 'meera@example.com', JSON.stringify(sent).slice(0, 300));

    // Back from the gateway must never throw the buyer forward again. Chromium
    // drops the self-posting hand-off page from history, so Back lands on the
    // form; a browser that keeps it gets the page at rest (checked just below).
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1500);
    check('Back from the gateway does not bounce forward again', !/secure\.ccavenue\.com/.test(page.url()), page.url());
    const oid = (await getState()).orders[0].order_id;
    await page.goto(BASE + '/pay/ccavenue/' + oid + '.' + crypto.createHmac('sha256', SESSION).update('pay-link:' + oid).digest('hex').slice(0, 24), { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    check('opened a second time, the hand-off page waits instead of posting again', /\/pay\/ccavenue\//.test(page.url()), page.url());
    check('it shows the amount and a button, and fits a phone', /5,898\.82/.test(await page.textContent('body')) && await page.isVisible('button[type=submit]') && await fits(page), page.url());
    await page.screenshot({ path: path.join(OUT, 'pay-handoff.png') });
    await page.click('button[type=submit]');
    await page.waitForSelector('#stub', { timeout: 20000 });
    await page.click('#pay');
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' });
    const body = await page.textContent('body');
    check('after paying, the result page says so', /Payment received/.test(body) && /5,898\.82/.test(body) && /115023456789/.test(body), body.slice(0, 200));
    check('the result page fits a phone', await fits(page));
    await page.screenshot({ path: path.join(OUT, 'pay-result-paid.png') });
    let st = await getState();
    const meera = Object.values(st.attendees).find(a => a.email === 'meera@example.com') || {};
    check('the pass is unlocked: Delegate, paid', meera.badge_type === 'Delegate Pass' && meera.payment_status === 'paid' && meera.payment_amount === '5898.82', JSON.stringify(meera));
    check('one order, paid', st.orders.length === 1 && st.orders[0].status === 'paid', JSON.stringify(st.orders.map(o => o.status)));
    const note = await page.evaluate(() => localStorage.getItem('agba_user'));
    check('the session came back with the buyer, so the app knows who they are', /meera@example\.com/.test(note || ''), String(note).slice(0, 80));

    await page.click('text=Open the app');
    await page.waitForURL(/\/app/, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser && currentUser.email === 'meera@example.com', null, { timeout: 20000 }).catch(() => {});
    const inApp = await page.evaluate(() => (typeof currentUser !== 'undefined' && currentUser) ? { email: currentUser.email, badge: currentUser.badge_type, pay: currentUser.payment_status } : null);
    check('"Open the app" lands signed in, as a paid Delegate', !!inApp && inApp.badge === 'Delegate Pass' && inApp.pay === 'paid', JSON.stringify(inApp));
    await sleep(800);
    check('and nobody is asked to pay again', await page.evaluate(() => { const b = document.getElementById('pcc-pay-btn'); return !!b && b.classList.contains('hidden'); }));
    await ctx.close();
  }

  // ---- 2. A pending VIP finishes from the app: cancels once, then pays ----
  await setState({ people: [{ id: 7, name: 'Vikram Shah', email: 'vikram@example.com', badge_type: 'VIP Pass', payment_status: 'pending', main_event: 1 }] });
  {
    const st0 = await getState();
    const { ctx, page } = await phone({ person: st0.attendees[7] });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const b = document.getElementById('pcc-pay-btn'); return b && !b.classList.contains('hidden') && b.offsetParent !== null; }, null, { timeout: 25000 }).catch(() => {});
    check('a pending VIP sees "Pay now" on the pass card', await page.isVisible('#pcc-pay-btn'));
    check('and is told the pass is issued the moment they pay', /Pay now to finish/.test(await page.textContent('#pcc-pass-note') || ''), await page.textContent('#pcc-pass-note'));
    check('and the card does not call an unpaid pass ready', /waiting for payment/.test(await page.textContent('#pcc-pass-state') || ''), await page.textContent('#pcc-pass-state'));
    await page.evaluate(() => document.getElementById('pcc-pay-btn').scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(OUT, 'pay-app-pending.png') });

    gw.hold = false; gw.reply = 'Aborted'; gw.seen.length = 0;
    await page.click('#pcc-pay-btn');
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' });
    check('the gateway was asked for 17,698.82', ((gw.seen[0] || {}).sent || {}).amount === '17698.82', JSON.stringify((gw.seen[0] || {}).sent || {}).slice(0, 120));
    check('cancelling says so, and that nothing was charged', /You cancelled the payment/.test(await page.textContent('body')) && /Nothing was charged/.test(await page.textContent('body')));
    check('the cancelled page fits a phone', await fits(page));
    await page.screenshot({ path: path.join(OUT, 'pay-result-cancelled.png') });
    let st = await getState();
    check('the pass is still pending', st.attendees[7].payment_status === 'pending' && st.orders.filter(o => o.attendee_id === 7).map(o => o.status).join() === 'aborted', JSON.stringify(st.orders.filter(o => o.attendee_id === 7).map(o => o.status)));

    gw.reply = 'Success';
    await page.click('#again');
    await page.waitForFunction(() => /Payment received/.test(document.body.textContent), null, { timeout: 20000 }).catch(() => {});
    st = await getState();
    check('"Try again" starts a fresh order and this time it is paid', /Payment received/.test(await page.textContent('body')) && st.attendees[7].payment_status === 'paid' && st.orders.filter(o => o.attendee_id === 7).map(o => o.status).join() === 'aborted,paid', JSON.stringify(st.orders.filter(o => o.attendee_id === 7).map(o => o.status)));
    await ctx.close();
  }

  // ---- 3. A Visitor upgrades from inside the app ----
  await setState({ people: [{ id: 8, name: 'Kiran Rao', email: 'kiran@example.com', badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1 }] });
  {
    const st0 = await getState();
    const { ctx, page } = await phone({ person: st0.attendees[8] });
    let popups = 0;
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser && window.PAY_GATEWAY === 'ccavenue', null, { timeout: 25000 }).catch(() => {});
    ctx.on('page', () => { popups++; });
    await page.evaluate(() => {
      openPaidPassForm();
      const r = document.querySelector('input[name="pp-pass"][value="VIP Pass"]');
      r.checked = true; r.dispatchEvent(new Event('change'));
    });
    check('the app\'s paid form says where checkout happens', /CCAvenue/.test(await page.textContent('#pp-next-copy') || ''), await page.textContent('#pp-next-copy'));
    await page.fill('#pp-name', 'Kiran Rao');
    await page.fill('#pp-email', 'kiran@example.com');
    await page.fill('#pp-phone', '9820066666');
    await page.fill('#pp-company', 'Rao Labs');
    await page.fill('#pp-designation', 'Director');
    await page.fill('#pp-city', 'Mumbai');
    await page.selectOption('#pp-industry', 'Software & SaaS');
    gw.hold = false; gw.reply = 'Success'; gw.seen.length = 0;
    await page.click('#pp-submit-btn');
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' });
    const st = await getState();
    check('the Visitor becomes a paid VIP by paying, with no one changing the badge by hand', st.attendees[8].badge_type === 'VIP Pass' && st.attendees[8].payment_status === 'paid', JSON.stringify(st.attendees[8]));
    check('no popup, and no "change their badge" enquiry for the team', popups === 0 && st.inquiries.length === 0, popups + ' popups, ' + st.inquiries.length + ' enquiries');
    await ctx.close();
  }

  // ---- 4. Switched off: the mUni Campus path is exactly as it was ----
  await setState({ settings: { payment_gateway: 'muni' } });
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/register#delegate', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    check('with the gateway off the form still names mUni Campus', (await page.evaluate(() => window.PAY_GATEWAY)) === 'muni' && /mUni Campus/.test(await page.textContent('#rpp-next-copy') || ''), await page.textContent('#rpp-next-copy'));
    await fillRegisterForm(page, 'old-path@example.com');
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null), page.click('#rpp-submit-btn')]);
    if (popup) await popup.waitForURL(/municampus\.com/, { timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
    check('and checkout opens on mUni Campus with the pass pre-selected', !!popup && /municampus\.com\/event\/event_registration\.php\?id=425&category=3/.test(popup.url()), popup ? popup.url() : 'no popup');
    const st = await getState();
    const who = Object.values(st.attendees).find(a => a.email === 'old-path@example.com') || {};
    check('no order is made here for it', !st.orders.some(o => o.attendee_id === who.id) && who.payment_status === 'pending', JSON.stringify(who));
    await ctx.close();
  }
  await setState({ unset: ['payment_gateway'] });

  // ---- 5. The invoice queues ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(() => {
      sessionStorage.setItem('tc_admin_token', 'h-admin');
      localStorage.setItem('tc_admin', '1');
      localStorage.setItem('tc_admin_operator', 'Harness');
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await page.evaluate(() => switchSection('payments'));
    await page.waitForFunction(() => /Paid online: invoice to raise/.test((document.getElementById('section-payments') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    const text = await page.textContent('#section-payments');
    check('/admin Payments lists what was paid online', /Paid online: invoice to raise/.test(text) && /Meera Nair/.test(text) && /Vikram Shah/.test(text) && /CCAvenue 115023456789/.test(text), text.slice(0, 200));
    check('and explains that payments now confirm themselves', /unlocks the pass at once/.test(text), text.slice(0, 200));
    check('the old-path buyer is still waiting, as before', /old-path@example\.com/.test(text), 'missing');
    await page.click('#section-payments button:has-text("Raise invoice")');
    const st = await getState();
    const filled = await page.evaluate(() => ({ order: document.getElementById('iv-order').value, ref: document.getElementById('iv-payref').value, amount: document.getElementById('iv-amount').value, email: document.getElementById('iv-email').value, item: document.getElementById('iv-item').value, att: document.getElementById('iv-attendee').value }));
    const match = st.orders.find(o => o.order_id === filled.order) || {};
    check('"Raise invoice" opens the form with order, reference and amount filled in', match.status === 'paid' && filled.ref === 'CCAvenue 115023456789' && Number(filled.amount) === match.amount_paise / 100 && String(filled.att) === String(match.attendee_id) && filled.item.startsWith(match.pass_type), JSON.stringify(filled));
    await page.screenshot({ path: path.join(OUT, 'pay-admin-invoice.png') });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const [name, value] = staffCookie(SESSION, 3).split('=');
    await ctx.addCookies([{ name, value, url: BASE }]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE + '/finance', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /Raise invoice/.test(document.getElementById('online').textContent || ''), null, { timeout: 20000 }).catch(() => {});
    check('/finance shows the same list', await page.isVisible('#online-card') && /Meera Nair/.test(await page.textContent('#online')), (await page.textContent('#online')).slice(0, 120));
    await page.click('#online button');
    const filled = await page.evaluate(() => ({ order: document.getElementById('f-order').value, ref: document.getElementById('f-payref').value, amount: document.getElementById('f-amount').value }));
    check('and its form is filled in the same way', /^BAI\d+-/.test(filled.order) && filled.ref === 'CCAvenue 115023456789' && Number(filled.amount) > 0, JSON.stringify(filled));
    await ctx.close();
  }

  check('no page threw a script error', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall checkout browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
