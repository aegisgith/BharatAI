// SYSTEM level for the redesigned /register and /inquiry (6 Nov 2026): whole journeys across the parts of
// the platform that must agree. Everything real except the two outside companies: the built worker on real
// SQLite with the production schema (login-harness.mjs), a real browser on an emulated phone, the real
// emails read back. Elastic Email is played by the harness and CCAvenue here.
//   A buyer: /passes, a pass's button, the paid form, the order, the gateway, paid, in the app, and Admin.
//   A visitor: the free form, the success screen, moving up to VIP for the difference it costs.
//   An exhibitor: /exhibition's Book a Booth, a size, the enquiry, the team's email, Admin Enquiries.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('./playwright.cjs');

const BASE = 'http://localhost:' + (process.env.HARNESS_PORT || 8842);
const ADMIN = { Authorization: 'Bearer smoke-admin' };
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0.0 Android';
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const sql = (s, args = []) => post('/__sql', { sql: s, args });
const mail = async () => (await fetch(BASE + '/__mail')).json();
const toOf = (m) => (m?.Recipients?.To || [])[0] || '';
const bodyOf = (m) => m?.Content?.Body?.[0]?.Content || '';

(async () => {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/api/events/1')).ok; } catch {} if (!up) await sleep(500); }
  if (!up) { console.log('FAIL the harness never came up'); process.exit(1); }
  const cfg = await (await fetch(BASE + '/api/payments/config')).json();
  if (!cfg.late) { console.log('FAIL this suite needs the clock past 5 Nov 2026'); process.exit(1); }

  const { kitEncrypt, kitDecrypt, gatewayAnswer } = await import(pathToFileURL(path.join(__dirname, 'pay-db.mjs')).href);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  const gw = { seen: [] };
  const phone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA, serviceWorkers: 'block' });
    await ctx.route('https://secure.ccavenue.com/**', async (route) => {
      const form = new URLSearchParams(route.request().postData() || '');
      const sent = Object.fromEntries(new URLSearchParams(kitDecrypt(form.get('encRequest') || '')));
      gw.seen.push(sent);
      const order = { order_id: sent.order_id, amount_paise: Math.round(Number(sent.amount) * 100), pass_type: sent.merchant_param2 };
      const encResp = kitEncrypt(gatewayAnswer('smoke-session', order, { merchant_param1: sent.merchant_param1 }));
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><form method="post" action="' + sent.redirect_url + '"><input type="hidden" name="encResp" value="' + encResp + '"></form><script>document.forms[0].submit()</script></body></html>' });
    });
    await ctx.route((u) => { const s = String(u); return !s.startsWith(BASE) && !s.startsWith('https://secure.ccavenue.com'); }, (r) => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    return { ctx, page };
  };
  const fillPaid = async (page, email, mobile) => {
    await page.fill('#rpp-name', 'Meera Nair');
    await page.fill('#rpp-email', email);
    await page.fill('#rpp-phone', mobile);
    await page.fill('#rpp-company', 'Nair Analytics');
    await page.selectOption('#rpp-industry', 'Software & SaaS');
    await page.fill('#rpp-designation', 'CTO');
    await page.fill('#rpp-city', 'Pune');
  };

  // ======== a buyer, from /passes to Admin ========
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/passes', { waitUntil: 'load' });
    await sleep(700);
    await page.locator('#premium .ps-buy').scrollIntoViewIfNeeded();
    await page.locator('#premium .ps-buy').tap();
    await page.waitForURL(/\/register\?source=passes-card#premium/, { timeout: 20000 }).catch(() => {});
    await sleep(900);
    check('buyer: the button on /passes reaches the paid form, on that pass', (await page.inputValue('#rpp-pass-type')) === 'Premium Delegate Pass' && await page.isVisible('#rpp-submit-btn'), page.url());
    await page.waitForFunction(() => /17,698\.82/.test(document.getElementById('rpp-total').textContent || ''), null, { timeout: 10000 }).catch(() => {});
    check('buyer: the whole amount is on the screen before anything is typed', /You pay ₹17,698\.82 in total \(₹14,999 \+ 18% GST\)/.test(await page.textContent('#rpp-total') || ''), await page.textContent('#rpp-total'));
    // Change of mind in the form: the amount follows.
    await page.click('input[name="rpp-pass"][value="Delegate Pass"] + div');
    await page.waitForFunction(() => /10,618\.82/.test(document.getElementById('rpp-total').textContent || ''), null, { timeout: 5000 }).catch(() => {});
    check('buyer: choosing Delegate instead, the amount follows', /₹10,618\.82/.test(await page.textContent('#rpp-total') || ''), await page.textContent('#rpp-total'));
    await fillPaid(page, 'meera.buyer@example.com', '9820011001');
    await page.click('#rpp-gst summary');
    await page.fill('#rpp-gst-name', 'Nair Analytics Pvt Ltd');
    await sleep(1000);
    const lead = (await sql("SELECT * FROM checkout_leads WHERE email = 'meera.buyer@example.com'"))[0];
    check('buyer: what is typed is kept as it is typed, as the form says, for the reminder', lead && lead.pass_type === 'Delegate Pass' && lead.name === 'Meera Nair', JSON.stringify(lead));
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
    const a = (await sql("SELECT * FROM attendees WHERE email = 'meera.buyer@example.com'"))[0] || {};
    const o = (await sql('SELECT * FROM payment_orders WHERE attendee_id = ?', [a.id]))[0] || {};
    check('buyer: through the gateway at our price, including GST', gw.seen.length === 1 && Number(gw.seen[0].amount) === 10618.82 && o.pass_type === 'Delegate Pass', JSON.stringify(gw.seen[0]));
    check('buyer: paid, on one registration, on the Delegate Pass', a.badge_type === 'Delegate Pass' && a.payment_status === 'paid' && a.main_event === 1 && o.status === 'paid', JSON.stringify({ a, o }));
    check('buyer: the page says so', /Payment received/.test(await page.textContent('body')), page.url());
    check('buyer: the source of the sale is kept, the button that sold it', a.registration_source === 'passes-card', a.registration_source);
    const billing = (await sql('SELECT value FROM app_settings WHERE key = ?', ['billing:' + a.id]))[0];
    check('buyer: the company name for the GST invoice reached the accounts team\'s record', /Nair Analytics Pvt Ltd/.test(billing?.value || ''), JSON.stringify(billing));
    await sleep(300);
    const ms = (await mail()).filter((m) => toOf(m) === 'meera.buyer@example.com');
    check('buyer: the email says the payment landed and names the pass', ms.some((m) => /Payment received: your Delegate Pass is confirmed/.test(m.Content.Subject)), JSON.stringify(ms.map((m) => m.Content.Subject)));
    const adm = await (await fetch(BASE + '/api/events/1/attendees?search=Meera', { headers: ADMIN })).json();
    const shown = (Array.isArray(adm) ? adm : adm.attendees || []).find((x) => x.email === 'meera.buyer@example.com');
    check('buyer: the organiser sees a paid Delegate', !!shown && shown.payment_status === 'paid' && shown.badge_type === 'Delegate Pass', JSON.stringify(adm).slice(0, 200));
    await ctx.close();
  }

  // ======== a visitor who moves up ========
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/passes', { waitUntil: 'load' });
    await sleep(600);
    await page.locator('#visitor .ps-ghost').scrollIntoViewIfNeeded();
    await page.locator('#visitor .ps-ghost').tap();
    await page.waitForURL(/\/register\?source=passes-visitor/, { timeout: 20000 }).catch(() => {});
    await sleep(900);
    check('visitor: the free button on /passes reaches the free form, in view', await page.isVisible('#rf-name') && (await page.locator('#rf-name').boundingBox()).y < 800);
    await page.fill('#rf-name', 'Ravi Kumar');
    await page.fill('#rf-email', 'ravi.visitor@example.com');
    await page.fill('#rf-phone', '9820011002');
    await page.fill('#rf-company', 'Kumar Co');
    await page.fill('#rf-title', 'Analyst');
    await page.fill('#rf-city', 'Mumbai');
    await page.selectOption('#rf-industry', 'Telecom');
    await page.tap('#rf-submit');
    await page.waitForFunction(() => !document.getElementById('reg-success').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    const a = (await sql("SELECT * FROM attendees WHERE email = 'ravi.visitor@example.com'"))[0] || {};
    check('visitor: a free Visitor Pass, counted to the right button', a.badge_type === 'Visitor Pass' && a.registration_source === 'passes-visitor', JSON.stringify(a));
    check('visitor: the screen says what to do next, and the pass held', /Free Visitor Pass/.test(await page.textContent('#reg-success')) && /Add your photo/.test(await page.textContent('#reg-success')) && (await page.getAttribute('.rs-hero', 'href')) === '/app?action=social-card');
    await sleep(200);
    const m = (await mail()).filter((x) => toOf(x) === 'ravi.visitor@example.com');
    check('visitor: the welcome names the pass they hold, and is not a receipt', m.length >= 1 && m.some((x) => /Visitor Pass/.test(bodyOf(x))) && !m.some((x) => /Payment received/.test(x.Content.Subject)), JSON.stringify(m.map((x) => x.Content.Subject)));
    await page.locator('#reg-success a:has-text("Upgrade to VIP")').tap();
    await sleep(500);
    check('visitor: Upgrade to VIP opens the paid form filled in, on VIP', (await page.inputValue('#rpp-pass-type')) === 'VIP Pass' && (await page.inputValue('#rpp-email')) === 'ravi.visitor@example.com' && (await page.inputValue('#rpp-designation')) === 'Analyst');
    gw.seen.length = 0;
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForURL(/\/pay\/result\?o=/, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
    const b = (await sql("SELECT * FROM attendees WHERE email = 'ravi.visitor@example.com'"));
    check('visitor: the same registration, now a paid VIP, at today\'s price', b.length === 1 && b[0].badge_type === 'VIP Pass' && b[0].payment_status === 'paid' && Number(gw.seen[0]?.amount) === 29498.82, JSON.stringify({ b: b[0], seen: gw.seen[0] }));
    await ctx.close();
  }

  // ======== somebody already on the list ========
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/register#delegate', { waitUntil: 'load' });
    await sleep(700);
    await fillPaid(page, 'ravi.visitor@example.com', '9820011099');
    await page.evaluate(() => document.getElementById('rpp-submit-btn').scrollIntoView({ block: 'center' }));
    await page.click('#rpp-submit-btn');
    await page.waitForFunction(() => document.getElementById('rpp-notice').style.display !== 'none', null, { timeout: 15000 }).catch(() => {});
    const n = await page.evaluate(() => { const b = document.getElementById('rpp-notice'), r = b.getBoundingClientRect(), bar = document.querySelector('.rg-pay').getBoundingClientRect(); return { text: b.textContent, seen: r.top >= 0 && r.bottom <= bar.top + 1 }; });
    check('already registered: the notice stays, in plain words, above the button and not behind it', /already registered with us/.test(n.text) && n.seen, JSON.stringify(n));
    await ctx.close();
  }

  // ======== an exhibitor, from /exhibition to the team ========
  {
    const { ctx, page } = await phone();
    await page.goto(BASE + '/exhibition.html', { waitUntil: 'load' });
    await sleep(500);
    const href = await page.evaluate(() => [...document.querySelectorAll('a[href="/inquiry"]')].map((a) => a.textContent.trim())[0]);
    check('exhibitor: /exhibition has its Book a Booth button', /Book a Booth/.test(href || ''), href);
    await page.goto(BASE + '/inquiry', { waitUntil: 'load' });
    await sleep(700);
    await page.locator('.bk-pkg').nth(5).tap();
    await sleep(800);
    check('exhibitor: chooses the Flagship, and the form opens on it', /Flagship/.test(await page.textContent('#iq-summary-type')) && /₹3,87,000 \+ GST/.test(await page.textContent('#iq-summary-price')));
    await page.selectOption('#iq-zone', 'Cloud & Infra');
    await page.fill('#iq-name', 'Sana Shaikh');
    await page.fill('#iq-email', 'sana@cloudco.example');
    await page.fill('#iq-phone', '9820011003');
    await page.fill('#iq-company', 'CloudCo');
    await page.fill('#iq-products', 'A GPU cloud for Indian banks');
    await page.tap('#iq-submit');
    await page.waitForFunction(() => !document.getElementById('iq-success').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
    await sleep(400);
    check('exhibitor: a thank-you with a reference', /^BHAI-INQ-\d{5}$/.test(await page.textContent('#iq-ref')), await page.textContent('#iq-ref'));
    const team = (await mail()).filter((m) => /Booth Inquiry: Flagship Pavilion/.test(bodyOf(m)) && /CloudCo/.test(bodyOf(m)));
    check('exhibitor: the team is told, once, and a reply reaches them', team.length === 1 && String(team[0].Content.ReplyTo || '').includes('sana@cloudco.example'), JSON.stringify(team.map((m) => m.Content.Subject)));
    const r = await fetch(BASE + '/api/admin/inquiries?type=booth_inquiry', { headers: ADMIN });
    const j = await r.json();
    const row = (j.inquiries || []).find((i) => i.email === 'sana@cloudco.example');
    const meta = row ? JSON.parse(row.metadata) : {};
    check('exhibitor: the organiser finds it in Admin, Enquiries, under Booth Inquiry', r.status === 200 && !!row && row.status === 'new' && row.organization === 'CloudCo', String(r.status));
    check('exhibitor: with the booth, the zone, the estimate and what they will show', meta.booth_type === 'Flagship Pavilion - 6x2m - Rs.3,87,000' && meta.preferred_zone === 'Cloud & Infra' && meta.estimated_total === 387000 && meta.products_to_showcase === 'A GPU cloud for Indian banks', row && row.metadata);
    check('exhibitor: Admin\'s filter counts the type', (j.typeCounts || []).some((t) => t.inquiry_type === 'booth_inquiry' && t.count >= 1), JSON.stringify(j.typeCounts));
    const board = await (await fetch(BASE + '/api/admin/events/1/board', { headers: ADMIN })).json();
    check('exhibitor: the Overview board counts it as waiting on someone', (board?.todo?.inquiries || []).some((t) => t.type === 'booth_inquiry' && t.n >= 1), JSON.stringify(board?.todo?.inquiries));
    await ctx.close();
  }

  check('no page errors on any of the journeys', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall journeys passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed: ' + (e && e.stack || e)); process.exit(1); });
