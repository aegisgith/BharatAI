// Buying a pass on a phone, in a real browser, against pay-harness.mjs (:8776):
// the paid form on /register, the hand-off page, the gateway's answer, the result
// page, landing in the app signed in, paying a pending pass from the app, cancelling
// and trying again, what a buyer is told when checkout is off (nobody is sent to
// mUni Campus any more), and the invoice queues in /admin and
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
  const gw = { reply: 'Success', hold: false, seen: [], muniHits: 0 };
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
    await ctx.route('https://municampus.com/**', route => { gw.muniHits++; return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1 id="muni">MUNI STUB</h1>' }); });
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
    check('the paid form says where checkout happens', /CCAvenue/.test(await page.textContent('#rpp-next-copy') || ''), await page.textContent('#rpp-next-copy'));
    check('the Delegate tier is already chosen from the link', (await page.inputValue('#rpp-pass-type')) === 'Delegate Pass', await page.inputValue('#rpp-pass-type'));
    await page.waitForFunction(() => /5,898\.82/.test((document.getElementById('rpp-total') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    check('the total with GST is shown before checkout, not first on CCAvenue', /You pay ₹5,898\.82 in total \(₹4,999 \+ 18% GST\)/.test(await page.textContent('#rpp-total') || '') && await page.isVisible('#rpp-total'), await page.textContent('#rpp-total'));
    await page.click('input[name="rpp-pass"][value="VIP Pass"] + div');
    await page.waitForFunction(() => /23,598\.82/.test((document.getElementById('rpp-total') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    check('and follows the pass chosen', /23,598\.82/.test(await page.textContent('#rpp-total') || ''), await page.textContent('#rpp-total'));
    await page.click('input[name="rpp-pass"][value="Delegate Pass"] + div');
    await page.waitForFunction(() => /5,898\.82/.test((document.getElementById('rpp-total') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    await fillRegisterForm(page, 'meera@example.com');

    // The GST invoice section: optional, closed until opened, and a GSTIN that is
    // not one is caught on the phone before anything is saved or charged.
    check('the GST invoice section is offered, optional and closed', await page.isVisible('#rpp-gst summary') && (await page.getAttribute('#rpp-gst', 'open')) === null && /optional/.test(await page.textContent('#rpp-gst summary') || ''), await page.textContent('#rpp-gst summary'));
    await page.click('#rpp-gst summary');
    await page.fill('#rpp-gst-name', 'Nair Analytics Pvt Ltd');
    await page.fill('#rpp-gstin', '27abc');
    check('opened, it fits a phone', await page.isVisible('#rpp-gst-address') && await fits(page));
    const said = []; const onDialog = (d) => said.push(d.message());
    page.on('dialog', onDialog);
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForTimeout(600);
    page.off('dialog', onDialog);
    check('a GSTIN that is not one stops on the form with a plain sentence, before checkout', said.some(m => /GSTIN does not look right/.test(m)) && /\/register/.test(page.url()) && !(await page.$('#stub')), JSON.stringify(said) + ' ' + page.url());
    await page.fill('#rpp-gst-name', '');
    await page.fill('#rpp-gstin', '');

    gw.hold = true; gw.reply = 'Success'; gw.seen.length = 0;
    await page.click('#rpp-submit-btn');
    await page.waitForSelector('#stub', { timeout: 20000 });
    check('the buyer reaches the gateway in the same tab, no popup', popups === 0 && /secure\.ccavenue\.com/.test(page.url()), popups + ' popups, ' + page.url());
    const sent = (gw.seen[0] || {}).sent || {};
    check('the gateway is asked for 5,898.82 for a Delegate Pass', sent.amount === '5898.82' && sent.currency === 'INR' && sent.merchant_param2 === 'Delegate Pass' && (gw.seen[0] || {}).access_code === 'AVSM00KE00TE00ST00', JSON.stringify(sent).slice(0, 200));
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
    check('the app treats an unpaid VIP Pass as not yet a paid pass', await page.evaluate(() => isVisitorPass() && passAwaitingPayment()));
    await page.evaluate(() => showUpgradeModal('directory'));
    check('reaching for a locked feature asks them to finish paying, not to choose a pass again', /Finish paying for your VIP Pass/.test(await page.textContent('#upgrade-modal-title') || '') && /Pay now/.test(await page.textContent('#upgrade-modal-go') || ''), await page.textContent('#upgrade-modal-title'));
    await page.evaluate(() => { const m = document.getElementById('visitor-upgrade-modal'); m.classList.add('hidden'); m.classList.remove('flex'); });
    await page.evaluate(() => document.getElementById('pcc-pay-btn').scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(OUT, 'pay-app-pending.png') });

    gw.hold = false; gw.reply = 'Aborted'; gw.seen.length = 0;
    await page.click('#pcc-pay-btn');
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' });
    check('the gateway was asked for 23,598.82', ((gw.seen[0] || {}).sent || {}).amount === '23598.82', JSON.stringify((gw.seen[0] || {}).sent || {}).slice(0, 120));
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
    await page.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser, null, { timeout: 25000 }).catch(() => {});
    ctx.on('page', () => { popups++; });
    await page.evaluate(() => {
      openPaidPassForm();
      const r = document.querySelector('input[name="pp-pass"][value="VIP Pass"]');
      r.checked = true; r.dispatchEvent(new Event('change'));
    });
    check('the app\'s paid form says where checkout happens', /CCAvenue/.test(await page.textContent('#pp-next-copy') || ''), await page.textContent('#pp-next-copy'));
    await page.waitForFunction(() => /23,598\.82/.test((document.getElementById('pp-total') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    check('the app\'s paid form shows the VIP total with GST too', /You pay ₹23,598\.82 in total/.test(await page.textContent('#pp-total') || ''), await page.textContent('#pp-total'));
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

  // ---- 3b. A confirmed pass moves up: shown the difference, then asked (5 Nov 2026) ----
  // Until now the pass card's line sent a tap straight to the gateway, one pass
  // at a time, and "Get a Paid Pass" opened the full-price form for someone who
  // had already paid. The figures are read from the server's own config, so this
  // section holds on either side of a dated price change.
  await setState({ people: [
    { id: 9, name: 'Dev Mehta', email: 'dev@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82', main_event: 1 },
    { id: 10, name: 'Asha Iyer', email: 'asha@example.com', badge_type: 'Delegate Pass', payment_status: 'paid', payment_amount: '5898.82', main_event: 1 },
    { id: 11, name: 'Tara Student', email: 'tara@college.example', badge_type: 'Academic Pass', payment_status: 'paid', payment_amount: '1178.82', main_event: 1 },
    { id: 12, name: 'Vik Rao', email: 'vik@example.com', badge_type: 'VIP Pass', payment_status: 'paid', payment_amount: '23598.82', main_event: 1 },
  ] });
  {
    const cfg = await (await fetch(BASE + '/api/payments/config')).json();
    const base = (p) => Number(cfg.passes[p].base);
    const rs = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const withGst = (n) => Math.round(n * (100 + cfg.gst_rate)) / 100;
    const dPrem = base('Premium Delegate Pass') - base('Delegate Pass'), dVip = base('VIP Pass') - base('Delegate Pass');
    const cardReady = () => { const b = document.getElementById('pcc-upgrade-btn'); return !!b && !b.classList.contains('hidden') && b.offsetParent !== null && /GST/.test((document.getElementById('pcc-upgrade') || {}).textContent || ''); };
    const stepRows = (page) => page.$$eval('#upgrade-modal-steps button[data-pass]', els => els.map(e => ({ pass: e.getAttribute('data-pass'), on: e.getAttribute('aria-pressed'), text: e.textContent, h: e.getBoundingClientRect().height })));
    const st0 = await getState();

    // From the pass card.
    {
      const { ctx, page } = await phone({ person: st0.attendees[9] });
      gw.hold = false; gw.reply = 'Success'; gw.seen.length = 0;
      await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(cardReady, null, { timeout: 25000 }).catch(() => {});
      check('a paid Delegate sees "Upgrade my pass" on the pass card', await page.isVisible('#pcc-upgrade-btn') && /Upgrade my pass/.test(await page.textContent('#pcc-upgrade-btn') || ''));
      const line = await page.textContent('#pcc-upgrade') || '';
      check('with the difference for each pass above theirs', line.includes('Premium Delegate, ₹' + rs(dPrem) + ' + GST') && line.includes('VIP, ₹' + rs(dVip) + ' + GST'), line);
      check('and neither "Pay now" nor "Guarantee both days"', await page.evaluate(() => ['pcc-pay-btn', 'pcc-guarantee-btn'].every(id => document.getElementById(id).classList.contains('hidden'))));
      await page.evaluate(() => document.getElementById('pcc-upgrade-btn').scrollIntoView({ block: 'center' }));
      await page.click('#pcc-upgrade-btn');
      await page.waitForSelector('#upgrade-modal-sum', { timeout: 10000 }).catch(() => {});
      let rows = await stepRows(page);
      check('the sheet lists Premium Delegate and VIP, each a full-size tap target', rows.map(r => r.pass).join() === 'Premium Delegate Pass,VIP Pass' && rows.every(r => r.h >= 44), JSON.stringify(rows));
      check('each row says what it adds and the difference', rows.length === 2 && /one hands-on workshop/.test(rows[0].text) && rows[0].text.includes('+ ₹' + rs(dPrem)) && /Leaders/.test(rows[1].text) && rows[1].text.includes('+ ₹' + rs(dVip)), JSON.stringify(rows.map(r => r.text)));
      check('the next pass up is chosen to begin with', rows.length === 2 && rows[0].on === 'true' && rows[1].on === 'false', JSON.stringify(rows.map(r => r.on)));
      let sum = await page.textContent('#upgrade-modal-sum').catch(() => '') || '';
      check('the sum is spelled out: the new pass, less theirs, the difference, GST, what they pay',
        sum.includes('Premium Delegate Pass, today’s price₹' + rs(base('Premium Delegate Pass'))) && sum.includes('Less your Delegate Pass, today’s price− ₹' + rs(base('Delegate Pass'))) &&
        sum.includes('Difference₹' + rs(dPrem)) && sum.includes('GST ' + cfg.gst_rate + '%₹' + rs(withGst(dPrem) - dPrem)) && sum.includes('You pay now₹' + rs(withGst(dPrem))), sum);
      check('and the button carries the amount', (await page.textContent('#upgrade-modal-go') || '').includes('Pay ₹' + rs(withGst(dPrem)) + ' and move up'), await page.textContent('#upgrade-modal-go'));
      check('the full-price cards and the Premium line are not shown to someone who has paid', await page.evaluate(() => ['upgrade-modal-cards', 'upgrade-modal-premium', 'upgrade-modal-icon'].every(id => document.getElementById(id).classList.contains('hidden'))));
      await page.click('#upgrade-modal-steps button[data-pass="VIP Pass"]');
      sum = await page.textContent('#upgrade-modal-sum').catch(() => '') || '';
      check('choosing VIP changes the sum and the button', sum.includes('Difference₹' + rs(dVip)) && sum.includes('You pay now₹' + rs(withGst(dVip))) && (await page.textContent('#upgrade-modal-go') || '').includes('Pay ₹' + rs(withGst(dVip)) + ' and move up'), sum);
      check('the sheet fits a phone and stays inside the screen', await fits(page) && await page.evaluate(() => { const r = document.querySelector('#visitor-upgrade-modal > div').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1; }));
      await page.screenshot({ path: path.join(OUT, 'pay-app-move-up.png') });
      check('looking and choosing starts no order and sends nobody to the gateway', gw.seen.length === 0 && (await getState()).orders.filter(o => o.attendee_id === 9).length === 0);

      await page.click('#upgrade-modal-go');
      await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' });
      check('the gateway is asked for exactly the amount on the button', ((gw.seen[0] || {}).sent || {}).amount === withGst(dVip).toFixed(2), JSON.stringify((gw.seen[0] || {}).sent || {}).slice(0, 120));
      const st = await getState();
      const mine = st.orders.filter(o => o.attendee_id === 9);
      check('one order, for the difference, naming the pass it moved up from', mine.length === 1 && mine[0].status === 'paid' && mine[0].pass_type === 'VIP Pass' && mine[0].previous_badge === 'Delegate Pass' && mine[0].base_paise === dVip * 100, JSON.stringify(mine));
      check('the pass is now a VIP Pass, and what was paid in all adds up', st.attendees[9].badge_type === 'VIP Pass' && st.attendees[9].payment_status === 'paid' && st.attendees[9].payment_amount === (5898.82 + withGst(dVip)).toFixed(2), JSON.stringify(st.attendees[9]));
      await ctx.close();
    }

    // From a "Move up" link in an email, and from "Get a Paid Pass".
    {
      const { ctx, page } = await phone({ person: st0.attendees[10] });
      gw.seen.length = 0;
      await page.goto(BASE + '/app?email=' + encodeURIComponent('asha@example.com') + '&action=pay&pass=vip', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#upgrade-modal-sum', { timeout: 25000 }).catch(() => {});
      const on = (await stepRows(page)).filter(r => r.on === 'true').map(r => r.pass).join();
      await sleep(600);
      check('a "Move up" link from an email opens the sheet on the pass it named, and waits to be asked', on === 'VIP Pass' && gw.seen.length === 0 && /\/app/.test(page.url()), on + ' ' + page.url());
      await page.evaluate(() => { const m = document.getElementById('visitor-upgrade-modal'); m.classList.add('hidden'); m.classList.remove('flex'); openPaidPassForm(); });
      check('"Get a Paid Pass" opens the same sheet for someone who has paid, not the full-price form', await page.evaluate(() => !document.getElementById('visitor-upgrade-modal').classList.contains('hidden') && document.getElementById('paid-pass-modal').classList.contains('hidden')));
      await ctx.close();
    }

    // A student sees every pass above the Academic Pass; a VIP has nowhere to go.
    {
      const { ctx, page } = await phone({ person: st0.attendees[11] });
      await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(cardReady, null, { timeout: 25000 }).catch(() => {});
      await page.evaluate(() => showUpgradeModal('passcard'));
      await page.waitForSelector('#upgrade-modal-sum', { timeout: 10000 }).catch(() => {});
      const rows = await stepRows(page);
      const dDel = base('Delegate Pass') - base('Academic Pass');
      check('a paid Academic Pass may move up to Delegate, Premium Delegate or VIP, each for its own difference', rows.map(r => r.pass).join() === 'Delegate Pass,Premium Delegate Pass,VIP Pass' && rows[0].on === 'true' && rows[0].text.includes('+ ₹' + rs(dDel)) && (await page.textContent('#upgrade-modal-go') || '').includes('Pay ₹' + rs(withGst(dDel))), JSON.stringify(rows.map(r => r.text)));
      check('three steps still fit a phone', await fits(page) && await page.evaluate(() => { const r = document.querySelector('#visitor-upgrade-modal > div').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1; }));
      await ctx.close();
    }
    {
      const { ctx, page } = await phone({ person: st0.attendees[12] });
      await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof _ppPrices !== 'undefined' && !!_ppPrices && typeof currentUser !== 'undefined' && !!currentUser && !document.getElementById('pass-card-cta').classList.contains('hidden'), null, { timeout: 25000 }).catch(() => {});
      check('a paid VIP is offered nothing to move up to', await page.evaluate(() => document.getElementById('pcc-upgrade-btn').classList.contains('hidden') && document.getElementById('pcc-upgrade').classList.contains('hidden')));
      await ctx.close();
    }
  }

  // ---- 4. Switched off: the buyer is told so, and is sent nowhere else ----
  await setState({ settings: { payment_gateway: 'off' } });
  {
    const { ctx, page } = await phone();
    let popups = 0;
    ctx.on('page', () => { popups++; });
    popups = 0; gw.seen.length = 0; gw.muniHits = 0;
    await page.goto(BASE + '/register#delegate', { waitUntil: 'domcontentloaded' });
    await sleep(800);
    check('the form names CCAvenue and never mUni Campus', /CCAvenue/.test(await page.textContent('#rpp-next-copy') || '') && !/mUni/i.test(await page.content()), await page.textContent('#rpp-next-copy'));
    await fillRegisterForm(page, 'switched-off@example.com');
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForFunction(() => /not available just now/.test(document.body.textContent), null, { timeout: 15000 }).catch(() => {});
    check('with checkout off the buyer is told so, on the form', /not available just now/.test(await page.textContent('body')) && /\/register/.test(page.url()), page.url());
    await sleep(1200);
    check('and is sent nowhere: no popup, no gateway, no mUni Campus', popups === 0 && gw.seen.length === 0 && gw.muniHits === 0 && /\/register/.test(page.url()), popups + ' popups, ' + gw.seen.length + ' gateway, ' + gw.muniHits + ' muni');
    check('the button is ready to try again', !(await page.isDisabled('#rpp-submit-btn')));
    const st = await getState();
    const who = Object.values(st.attendees).find(a => a.email === 'switched-off@example.com') || {};
    check('their details are saved and no order is made', who.payment_status === 'pending' && !st.orders.some(o => o.attendee_id === who.id), JSON.stringify(who));
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
    check('someone who has not paid is still listed as waiting', /switched-off@example\.com/.test(text), 'missing');
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

  // ---- 6. Stopped part-way, reminded, came back and paid ----
  // Three ways to stop: close the /register form before Proceed (a lead), leave the
  // CCAvenue page without paying (a pending registration), and close the app's
  // upgrade form as a Visitor (a lead with a free pass).
  await setState({ people: [
    { id: 40, name: 'Pria Left', email: 'pria@example.com', badge_type: 'Delegate Pass', payment_status: 'pending', main_event: 1 },
    { id: 41, name: 'Vera Visitor', email: 'vera@example.com', badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, mobile: '9820088888', company: 'Vera Co', job_title: 'Lead', city: 'Thane', industry: 'Software & SaaS' },
  ] });
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/register#delegate', { waitUntil: 'domcontentloaded' });
    await sleep(800);
    check('the form says it keeps what is typed', /We keep what you type here/.test(await page.textContent('#reg-paid-pass-modal')), 'no notice');
    await page.fill('#rpp-name', 'Lena Leaver');
    await page.fill('#rpp-email', 'lena@example.com');
    await page.fill('#rpp-phone', '9820077777');
    await page.fill('#rpp-company', 'Leaver Labs');
    await page.fill('#rpp-city', 'Nagpur');
    await page.click('#reg-paid-pass-modal button[onclick="closeRegisterPaidPassModal()"]');
    await sleep(1000);
    const st = await getState();
    const kept = st.leads.find(l => l.email === 'lena@example.com') || {};
    check('closing the form before Proceed keeps what was typed', kept.name === 'Lena Leaver' && kept.mobile === '9820077777' && kept.city === 'Nagpur' && kept.pass_type === 'Delegate Pass' && kept.page === 'register', JSON.stringify(kept));
    check('and registers nobody', !Object.values(st.attendees).some(a => a.email === 'lena@example.com'), 'registered');
    await ctx.close();
  }
  {
    const st0 = await getState();
    const { ctx, page } = await phone({ person: st0.attendees[40] });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const b = document.getElementById('pcc-pay-btn'); return b && !b.classList.contains('hidden') && b.offsetParent !== null; }, null, { timeout: 25000 }).catch(() => {});
    gw.hold = true; gw.reply = 'Success';
    await page.click('#pcc-pay-btn');
    await page.waitForSelector('#stub', { timeout: 20000 });
    await ctx.close();   // left the CCAvenue page without paying
  }
  {
    const st0 = await getState();
    const { ctx, page } = await phone({ person: st0.attendees[41] });
    await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser, null, { timeout: 25000 }).catch(() => {});
    await page.evaluate(() => {
      openPaidPassForm();
      const r = document.querySelector('input[name="pp-pass"][value="VIP Pass"]');
      r.checked = true; r.dispatchEvent(new Event('change'));
    });
    await page.fill('#pp-name', 'Vera Visitor');
    await page.fill('#pp-email', 'vera@example.com');
    await page.evaluate(() => closePaidPassModal());
    await sleep(1000);
    const st = await getState();
    const kept = st.leads.find(l => l.email === 'vera@example.com') || {};
    check('a Visitor closing the upgrade form in the app is kept too', kept.pass_type === 'VIP Pass' && kept.page === 'app', JSON.stringify(kept));
    await ctx.close();
  }

  await setState({ ageLeads: true, ageOrders: true });   // an hour later
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
    await page.waitForFunction(() => /finish paying/.test((document.getElementById('abandoned-block') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    const text = await page.textContent('#abandoned-block');
    check('Admin, Payments lists who did not finish paying', /Lena Leaver/.test(text) && /Pria Left/.test(text) && /Vera Visitor/.test(text), text.slice(0, 200));
    check('each says where they stopped', /closed it before Proceed to Payment/.test(text) && /left the CCAvenue page without paying/.test(text) && /started an upgrade/.test(text), text.slice(0, 400));
    const label = await page.textContent('#pay-remind-all');
    check('the bulk button counts who can be reminded', /Remind [3-9] not yet reminded/.test(label || ''), label);
    // The harness has no scheduler, so the automatic reminder says it is not going out.
    const autoLine = await page.textContent('#pay-remind-auto-line').catch(() => '');
    check('the automatic reminder says honestly that no scheduler is knocking here', /Automatic reminders are on, but the scheduler \(bharatai-mail-cron\) has never knocked/.test(autoLine || ''), autoLine);
    check('rows that stopped long ago say the button is theirs', /stopped more than a day ago, so not reminded automatically/.test(text), text.slice(0, 300));
    await page.click('#pay-remind-auto');
    await page.waitForFunction(() => /Automatic reminders are off/.test((document.getElementById('pay-remind-auto-line') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    check('Turn off turns it off, on the server', /Automatic reminders are off/.test(await page.textContent('#pay-remind-auto-line').catch(() => '')) && (await getState()).settings.pay_remind_auto === 'off', (await getState()).settings.pay_remind_auto);
    await setState({ settings: { cron_last_tick: String(Date.now()) } });
    await page.click('#pay-remind-auto');
    await page.waitForFunction(() => /Automatic, day and night/.test((document.getElementById('pay-remind-auto-line') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const onLine = await page.textContent('#pay-remind-auto-line').catch(() => '');
    check('Turn on, with the scheduler knocking: it says nobody needs to press anything', /5 minutes after they stop \(10 minutes after opening the CCAvenue page/.test(onLine || '') && /Nobody needs to press anything/.test(onLine || '') && (await getState()).settings.pay_remind_auto === 'on', onLine);
    await page.screenshot({ path: path.join(OUT, 'pay-admin-auto.png') });
    const mailBefore = (await getState()).mail.length;
    const [preview] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null), page.click('#abandoned-block button:has-text("Preview")')]);
    await sleep(800);
    const previewText = preview ? await preview.textContent('body').catch(() => '') : '';
    check('Preview opens the email and sends nothing', /Finish/.test(previewText) && (await getState()).mail.length === mailBefore, (await getState()).mail.length + ' vs ' + mailBefore + ' ' + previewText.slice(0, 80));
    if (preview) await preview.close();
    await page.selectOption('#pay-remind-gap', '0');
    await page.click('#pay-remind-all');
    await page.waitForFunction(() => /Done:/.test((document.getElementById('pay-remind-progress') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
    const done = await page.textContent('#pay-remind-progress');
    const st = await getState();
    const to = st.mail.map(m => m.to);
    check('one press reminds them all, one email each', /Done: [3-9] sent/.test(done || '') && ['lena@example.com', 'pria@example.com', 'vera@example.com'].every(e => to.filter(x => x === e).length === 1), done + ' ' + JSON.stringify(to));
    await sleep(800);
    check('afterwards each row says when it was reminded', /reminded \d/.test(await page.textContent('#abandoned-block')) && /Remind 0 not yet reminded/.test(await page.textContent('#pay-remind-all')), (await page.textContent('#pay-remind-all')));
    await page.screenshot({ path: path.join(OUT, 'pay-admin-remind.png') });
    await ctx.close();
  }
  {
    const st = await getState();
    const lena = st.mail.find(m => m.to === 'lena@example.com') || {};
    const link = ((lena.html || '').match(/href="([^"]*\/register\?resume=[^"]+)"/) || [])[1] || '';
    const { ctx, page } = await phone();
    await page.goto(link.replace(/&amp;/g, '&'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (document.getElementById('rpp-email') || {}).value === 'lena@example.com', null, { timeout: 15000 }).catch(() => {});
    const f = await page.evaluate(() => ({ name: document.getElementById('rpp-name').value, phone: document.getElementById('rpp-phone').value, company: document.getElementById('rpp-company').value, city: document.getElementById('rpp-city').value, pass: document.getElementById('rpp-pass-type').value, url: location.href }));
    check('the reminder link opens the form filled in with what she typed', f.name === 'Lena Leaver' && f.phone === '9820077777' && f.company === 'Leaver Labs' && f.city === 'Nagpur' && f.pass === 'Delegate Pass', JSON.stringify(f));
    check('and takes the token out of the address bar', !/resume=/.test(f.url), f.url);
    await page.selectOption('#rpp-industry', 'Software & SaaS');
    await page.fill('#rpp-designation', 'Founder');
    gw.hold = false; gw.reply = 'Success';
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
    const after = await getState();
    const a = Object.values(after.attendees).find(x => x.email === 'lena@example.com') || {};
    check('she pays from there and her Delegate Pass is confirmed', /Payment received/.test(await page.textContent('body')) && a.badge_type === 'Delegate Pass' && a.payment_status === 'paid', JSON.stringify(a));
    await ctx.close();
  }
  {
    const st = await getState();
    const pria = st.mail.find(m => m.to === 'pria@example.com') || {};
    const link = (((pria.html || '').match(/href="([^"]*\/app\?email=[^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
    check('the reminder to someone registered signs them in and goes back to checkout', /action=pay&pass=delegate/.test(link), link);
    const { ctx, page } = await phone({ person: st.attendees[40] });
    gw.hold = false; gw.reply = 'Success';
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 40000, waitUntil: 'domcontentloaded' }).catch(() => {});
    const after = await getState();
    check('one tap from the email, and her pending pass is paid', /Payment received/.test(await page.textContent('body')) && after.attendees[40].payment_status === 'paid', page.url() + ' ' + after.attendees[40].payment_status);
    await ctx.close();
  }
  {
    const st = await getState();
    const vera = st.mail.find(m => m.to === 'vera@example.com') || {};
    const link = (((vera.html || '').match(/href="([^"]*\/app\?email=[^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
    const { ctx, page } = await phone({ person: st.attendees[41] });
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const m = document.getElementById('paid-pass-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 25000 }).catch(() => {});
    const f = await page.evaluate(() => ({ open: !document.getElementById('paid-pass-modal').classList.contains('hidden'), pass: document.getElementById('pp-pass-type').value, email: document.getElementById('pp-email').value, city: document.getElementById('pp-city').value }));
    check('a Visitor\'s reminder reopens the upgrade on the tier she chose, filled in from her profile', f.open && f.pass === 'VIP Pass' && f.email === 'vera@example.com' && f.city === 'Thane', JSON.stringify(f));
    await ctx.close();
  }

  // ---- 7. Register free, then upgrade from the success screen ----
  // The best moment to sell is the second after someone registers. Until 4 Oct
  // 2026 the success screen's Upgrade buttons only changed the address bar.
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/register', { waitUntil: 'domcontentloaded' });
    await sleep(800);
    await page.fill('#rf-name', 'Ravi Upsell');
    await page.fill('#rf-email', 'ravi.upsell@example.com');
    await page.fill('#rf-phone', '9820099999');
    await page.fill('#rf-company', 'Upsell Co');
    await page.fill('#rf-title', 'CTO');
    await page.fill('#rf-city', 'Mumbai');
    await page.selectOption('#rf-industry', 'Software & SaaS');
    // Typed the way the box's own hint shows it. Until 5 Nov 2026 the browser
    // stopped the form here with "Please enter a URL." (requestSubmit validates).
    await page.fill('#rf-linkedin', 'linkedin.com/in/ravi-upsell');
    const above = await page.evaluate(() => {
      const form = document.getElementById('reg-form');
      let text = '';
      for (const el of document.querySelectorAll('h1, h1 ~ p, #reg-intro')) text += ' ' + (el.offsetParent ? el.innerText : '');
      return { text: text.replace(/\s+/g, ' '), firstBox: Math.round(document.getElementById('rf-name').getBoundingClientRect().top + window.scrollY), form: !!form };
    });
    check('the free form is not opened with a warning: entry by slot is said once, plainly, and the first box is on the first screen', !/not guaranteed|or none/i.test(above.text) && /entry by time slot on 20 and 21 Nov, as available, confirmed by email/.test(above.text) && above.firstBox < 844, JSON.stringify(above));
    await page.evaluate(() => { const f = document.getElementById('reg-form'); f.requestSubmit ? f.requestSubmit() : f.submit(); });
    await page.waitForFunction(() => { const s = document.getElementById('reg-success'); return s && !s.classList.contains('hidden'); }, null, { timeout: 15000 }).catch(() => {});
    check('a free registration reaches the success screen', await page.isVisible('#reg-success'));
    check('with a LinkedIn address typed the way the hint shows it, saved as a working link', ((Object.values((await getState()).attendees).find(x => x.email === 'ravi.upsell@example.com') || {}).linkedin_url) === 'https://linkedin.com/in/ravi-upsell', JSON.stringify(Object.values((await getState()).attendees).find(x => x.email === 'ravi.upsell@example.com') || {}));
    await page.click('#reg-success a:has-text("Upgrade to Delegate")');
    await sleep(800);
    const f = await page.evaluate(() => ({ open: !document.getElementById('reg-paid-pass-modal').classList.contains('hidden'), pass: document.getElementById('rpp-pass-type').value, name: document.getElementById('rpp-name').value, email: document.getElementById('rpp-email').value, phone: document.getElementById('rpp-phone').value, company: document.getElementById('rpp-company').value, title: document.getElementById('rpp-designation').value, city: document.getElementById('rpp-city').value, industry: document.getElementById('rpp-industry').value }));
    check('"Upgrade to Delegate" on the success screen opens the paid form on Delegate', f.open && f.pass === 'Delegate Pass', JSON.stringify(f));
    check('filled in with what they typed a moment ago', f.name === 'Ravi Upsell' && f.email === 'ravi.upsell@example.com' && f.phone === '9820099999' && f.company === 'Upsell Co' && f.title === 'CTO' && f.city === 'Mumbai' && f.industry === 'Software & SaaS', JSON.stringify(f));
    check('and with the total shown', /5,898\.82/.test(await page.textContent('#rpp-total') || ''), await page.textContent('#rpp-total'));
    gw.hold = false; gw.reply = 'Success';
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
    const st = await getState();
    const a = Object.values(st.attendees).find(x => x.email === 'ravi.upsell@example.com') || {};
    check('one press later the free Visitor is a paid Delegate, on the same registration', /Payment received/.test(await page.textContent('body')) && a.badge_type === 'Delegate Pass' && a.payment_status === 'paid' && Object.values(st.attendees).filter(x => x.email === 'ravi.upsell@example.com').length === 1, JSON.stringify(a));
    await ctx.close();
  }

  // ---- 7b. Already registered, buying from /register in a browser not signed in ----
  // The people every email reaches. Until 5 Nov 2026 Proceed to Payment answered
  // them with a red message that left after four seconds, and nothing else.
  await setState({ people: [{ id: 70, name: 'Tara Returning', email: 'tara@example.com', badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, mobile: '9820070707', company: 'Tara Co', job_title: 'CEO', city: 'Mumbai', industry: 'Software & SaaS' }] });
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/register#delegate', { waitUntil: 'domcontentloaded' });
    await sleep(800);
    await fillRegisterForm(page, 'tara@example.com');
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForFunction(() => { const n = document.getElementById('rpp-notice'); return n && n.style.display !== 'none'; }, null, { timeout: 10000 }).catch(() => {});
    await sleep(5000);   // the old message had gone by now
    const n = await page.evaluate(() => {
      const b = document.getElementById('rpp-notice'), a = document.getElementById('rpp-notice-link'), r = b.getBoundingClientRect();
      return { shown: b.style.display !== 'none' && r.height > 0, inView: r.top >= 0 && r.bottom <= window.innerHeight, text: b.textContent, href: a ? a.getAttribute('href') : '',
        linkH: a ? Math.round(a.getBoundingClientRect().height) : 0, ready: !document.getElementById('rpp-submit-btn').disabled, url: location.pathname };
    });
    check('an address that already holds a pass gets a notice that stays on screen, under the button', n.shown && n.inView && n.ready && n.url === '/register' && /tara@example\.com is already registered with us/.test(n.text) && /payment for your Delegate Pass opens next/.test(n.text), JSON.stringify(n));
    check('with a button into the app for the code, big enough for a thumb', n.href === '/app?signin=tara%40example.com&action=pay&pass=delegate' && n.linkH >= 44, JSON.stringify(n));
    check('the notice fits a phone', await fits(page));
    await page.screenshot({ path: path.join(OUT, 'pay-already-registered.png') });
    await page.click('#rpp-submit-btn');
    await sleep(1200);
    let st = await getState();
    const asks = st.signin.filter(x => x.email === 'tara@example.com');
    check('a sign-in email that carries on to payment for that pass is asked for, once however often she presses', asks.length === 1 && asks[0].next_action === 'pay' && asks[0].pass === 'delegate', JSON.stringify(st.signin));
    check('she is not registered twice and no order is made', Object.values(st.attendees).filter(x => x.email === 'tara@example.com').length === 1 && !st.orders.some(o => o.attendee_id === 70), JSON.stringify(st.orders.filter(o => o.attendee_id === 70)));
    await page.fill('#rpp-city', 'Thane');
    check('typing again clears the notice', await page.evaluate(() => document.getElementById('rpp-notice').style.display === 'none'));
    await page.click('#rpp-submit-btn');
    await page.waitForFunction(() => { const b = document.getElementById('rpp-notice'); return b && b.style.display !== 'none'; }, null, { timeout: 10000 }).catch(() => {});
    await page.click('#rpp-notice-link');
    await page.waitForFunction(() => { const m = document.getElementById('registration-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 25000 }).catch(() => {});
    const box = await page.evaluate(() => ({
      email: document.getElementById('signin-email').value, code: !document.getElementById('signin-code-field').classList.contains('hidden'),
      note: document.getElementById('signin-note').textContent, noteShown: !document.getElementById('signin-note').classList.contains('hidden'),
      btn: document.querySelector('#signin-form button[type=submit]').textContent.trim(), url: location.pathname + location.search }));
    check('the button opens the app on the sign-in box, her address filled in, ready for the code', box.email === 'tara@example.com' && box.code && box.noteShown && /already registered/.test(box.note) && /Payment for your pass opens next/.test(box.note) && box.btn === 'Verify code', JSON.stringify(box));
    check('and the address is taken out of the address bar', box.url === '/app', box.url);
    check('the sign-in box fits a phone', await fits(page));
    await page.fill('#signin-code', '123456');
    await page.click('#signin-form button[type=submit]');
    await page.waitForFunction(() => { const m = document.getElementById('paid-pass-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 25000 }).catch(() => {});
    const f = await page.evaluate(() => ({ open: !document.getElementById('paid-pass-modal').classList.contains('hidden'), pass: document.getElementById('pp-pass-type').value, name: document.getElementById('pp-name').value, email: document.getElementById('pp-email').value, city: document.getElementById('pp-city').value }));
    check('after the code, the paid form opens on Delegate, filled in from her registration', f.open && f.pass === 'Delegate Pass' && f.name === 'Tara Returning' && f.email === 'tara@example.com' && f.city === 'Mumbai', JSON.stringify(f));
    st = await getState();
    check('no second sign-in email was asked for on the way', st.signin.filter(x => x.email === 'tara@example.com').length === 1, JSON.stringify(st.signin));
    gw.hold = false; gw.reply = 'Success';
    await page.evaluate(() => document.getElementById('pp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#pp-submit-btn');
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
    st = await getState();
    check('she pays, and her free pass is a paid Delegate Pass on the same registration', /Payment received/.test(await page.textContent('body')) && st.attendees[70].badge_type === 'Delegate Pass' && st.attendees[70].payment_status === 'paid' && Object.values(st.attendees).filter(x => x.email === 'tara@example.com').length === 1, page.url() + ' ' + JSON.stringify(st.attendees[70]));
    await ctx.close();
  }
  // The same wall for a mobile that is already on the list under another email.
  {
    const { ctx, page } = await phone();
    await ctx.route('**/api/events/1/attendees/register', route => route.fulfill({ status: 409, contentType: 'application/json',
      body: JSON.stringify({ error: 'This mobile number is already registered with ta•••@example.com. Please sign in with that email instead, or use your own mobile number.', message: 'This mobile number is already registered with ta•••@example.com. Please sign in with that email instead, or use your own mobile number.', code: 'mobile_registered' }) }));
    await page.goto(BASE + '/register#vip', { waitUntil: 'domcontentloaded' });
    await sleep(800);
    await fillRegisterForm(page, 'tara.other@example.com');
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForFunction(() => { const b = document.getElementById('rpp-notice'); return b && b.style.display !== 'none'; }, null, { timeout: 10000 }).catch(() => {});
    await sleep(5000);
    const n = await page.evaluate(() => { const b = document.getElementById('rpp-notice'), a = document.getElementById('rpp-notice-link'); return { shown: b.style.display !== 'none', text: b.textContent, href: a ? a.getAttribute('href') : '' }; });
    const asked = (await getState()).signin.filter(x => x.email === 'tara.other@example.com').length;
    check('a mobile already on the list gets the same lasting notice, with the way in', n.shown && /mobile number is already registered with ta•••@example\.com/.test(n.text) && /Sign in and pay for my VIP Pass/.test(n.text) && n.href === '/app?action=pay&pass=vip#login', JSON.stringify(n));
    check('and no sign-in email goes to the address just typed (it is not the registered one)', asked === 0, String(asked));
    await ctx.close();
  }

  // ---- 8. The upgrade campaign, from Admin, Payments ----
  await setState({ people: [
    { id: 80, name: 'Neha Founder', email: 'neha@startup.example', badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, job_title: 'Founder & CEO' },
    { id: 81, name: 'Omar Director', email: 'omar@corp.example', badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, job_title: 'Director, AI' },
    { id: 82, name: 'Riya Student', email: 'riya@college.example', badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 1, job_title: 'MBA Student' },
  ] });
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
    await page.waitForFunction(() => /Upgrade campaign/.test((document.getElementById('upgrade-campaign-block') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    const text = await page.textContent('#upgrade-campaign-block');
    check('Admin, Payments shows the upgrade campaign with who each offer reaches', /Upgrade campaign/.test(text) && /Senior Visitors/.test(text) && /Delegate Pass/.test(text) && /Students, interns and scholars/.test(text) && /Academic Pass/.test(text), text.slice(0, 200));
    check('with the counts and how long a run takes', /Send to [1-9]/.test(await page.textContent('#upgrade-send-senior')) && /Send to 1\b/.test(await page.textContent('#upgrade-send-students')) && /of sending/.test(text), (await page.textContent('#upgrade-send-senior')) + ' / ' + (await page.textContent('#upgrade-send-students')));
    const before = (await getState()).mail.length;
    const [pv] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null), page.click('#upgrade-campaign-block button:has-text("Preview")')]);
    await sleep(800);
    const pvText = pv ? await pv.textContent('body').catch(() => '') : '';
    check('Preview opens the Delegate offer and sends nothing', /Secure my Delegate Pass/.test(pvText) && /5,898\.82/.test(pvText) && (await getState()).mail.length === before, pvText.slice(0, 100));
    if (pv) await pv.close();
    await page.click('#upgrade-send-students');
    await page.waitForFunction(() => /Upgrade offer: Academic Pass to students/.test(document.body.textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const st = await getState();
    const k = st.campaigns.find(x => x.kind === 'upgrade' && x.audience === 'students');
    check('Send starts a durable campaign of exactly the students, and opens its progress', !!k && k.total === 1 && st.recipients.filter(x => x.campaign_id === k.id).map(x => x.attendee_id).join() === '82' && /Upgrade offer: Academic Pass to students/.test(await page.textContent('body')), JSON.stringify(k));
    await page.evaluate(() => { try { stopCampaignPump(); } catch (e) {} });
    await page.screenshot({ path: path.join(OUT, 'pay-admin-upgrade.png') });
    await ctx.close();
  }

  check('no page threw a script error', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall checkout browser checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
